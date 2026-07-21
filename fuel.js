/* Lubayd SA V20.9.1 - control de combustible con lecturas reales y modo offline */
(function () {
  'use strict';

  const VERSION = '20.9.1';
  const MAX_PHOTO_DATA_LENGTH = 620000;
  let loads = [];
  let movements = [];
  let cloudUnsubscribe = null;
  let syncPromise = null;
  let refreshTimer = null;
  let loadPhoto = '';
  let refillPhoto = '';
  let usagePhoto = '';

  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const now = () => new Date();
  const dateKey = (date = now()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const timeKey = (date = now()) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const uid = () => window.LubaydCurrentUser?.uid || '';
  const role = () => window.LubaydCurrentProfile?.role || 'operador';
  const isOperator = () => role() === 'operador';
  const isOffline = () => Boolean(window.LubaydOfflineSession);
  const onlineUser = () => window.firebase?.auth?.().currentUser || null;
  const randomId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const liters = value => `${new Intl.NumberFormat('es-UY', { maximumFractionDigits: 2 }).format(num(value))} L`;
  const formatDateTime = value => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value).replace('T', ' ');
    return new Intl.DateTimeFormat('es-UY', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
  };

  function notify(title, text, type = 'success') {
    if (typeof window.showToast === 'function') return window.showToast(title, text, type);
    const toast = $('#toast');
    if (!toast) return;
    $('#toastTitle').textContent = title;
    $('#toastText').textContent = text;
    toast.classList.remove('hidden');
    window.setTimeout(() => toast.classList.add('hidden'), 4200);
  }

  function activeLoad() {
    // V20.9.1 mantiene un único control continuo. Si una versión anterior lo cerró al llegar a cero,
    // el registro más reciente se reutiliza y se reactiva con la próxima carga.
    return loads.find(item => item.status === 'active' && item.syncStatus === 'synced')
      || loads.find(item => item.status === 'active')
      || loads[0]
      || null;
  }

  function movementsFor(loadId) {
    return movements
      .filter(item => item.loadId === loadId)
      .sort((a, b) => String(b.dateTime || b.createdAt || '').localeCompare(String(a.dateTime || a.createdAt || '')));
  }

  function timelineFor(load) {
    if (!load) return [];
    const initial = {
      id: `${load.id}__initial`,
      kind: 'fuel_load',
      loadId: load.id,
      dateKey: load.dateKey || String(load.dateTime || load.createdAt || '').slice(0, 10),
      timeKey: load.timeKey || String(load.dateTime || load.createdAt || '').slice(11, 16),
      dateTime: load.dateTime || load.createdAt || '',
      litersAdded: num(load.initialLiters),
      litersUsed: 0,
      remainingBefore: 0,
      remainingAfter: num(load.initialLiters),
      proofDataUrl: load.proofDataUrl || '',
      notes: load.notes || 'Carga inicial',
      createdByUid: load.createdByUid || '',
      createdByEmail: load.createdByEmail || '',
      createdByName: load.createdByName || '',
      syncStatus: load.syncStatus || 'pending',
      syncError: load.syncError || ''
    };
    return [initial, ...movements.filter(item => item.loadId === load.id)]
      .sort((a, b) => String(a.dateTime || a.createdAt || '').localeCompare(String(b.dateTime || b.createdAt || '')));
  }

  function dailyBalances(load) {
    const events = timelineFor(load);
    const days = new Map();
    events.forEach(event => {
      const key = event.dateKey || String(event.dateTime || event.createdAt || '').slice(0, 10) || 'Sin fecha';
      if (!days.has(key)) days.set(key, { dateKey: key, opening: num(event.remainingBefore), added: 0, used: 0, closing: num(event.remainingAfter), photos: 0, events: 0 });
      const day = days.get(key);
      if (day.events === 0) day.opening = num(event.remainingBefore);
      if (event.kind === 'fuel_load' || event.kind === 'fuel_refill') day.added += num(event.litersAdded || event.initialLiters);
      if (event.kind === 'fuel_check' || event.kind === 'fuel_usage') day.used += num(event.litersUsed);
      day.closing = num(event.remainingAfter);
      day.photos += event.proofDataUrl ? 1 : 0;
      day.events += 1;
    });
    return Array.from(days.values()).sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));
  }

  async function refreshLocal() {
    if (!window.LubaydOffline?.listFuelLoads) return;
    [loads, movements] = await Promise.all([
      window.LubaydOffline.listFuelLoads(),
      window.LubaydOffline.listFuelMovements()
    ]);
    render();
  }

  function setDefaults() {
    if ($('#fuelLoadDate') && !$('#fuelLoadDate').value) $('#fuelLoadDate').value = dateKey();
    if ($('#fuelLoadTime') && !$('#fuelLoadTime').value) $('#fuelLoadTime').value = timeKey();
    if ($('#fuelRefillDate') && !$('#fuelRefillDate').value) $('#fuelRefillDate').value = dateKey();
    if ($('#fuelRefillTime') && !$('#fuelRefillTime').value) $('#fuelRefillTime').value = timeKey();
    if ($('#fuelUsageDate') && !$('#fuelUsageDate').value) $('#fuelUsageDate').value = dateKey();
    if ($('#fuelUsageTime') && !$('#fuelUsageTime').value) $('#fuelUsageTime').value = timeKey();
  }

  function syncBadge(status, error = '') {
    const value = status || 'pending';
    const label = value === 'synced' ? 'Sincronizado' : value === 'error' ? 'Error al sincronizar' : value === 'syncing' ? 'Sincronizando' : 'Pendiente';
    const title = error ? ` title="${escapeHtml(error)}"` : '';
    return `<span class="fuel-sync-badge ${escapeHtml(value)}"${title}>${label}</span>`;
  }

  function render() {
    const root = $('#fuelViewContent');
    if (!root) return;
    setDefaults();

    const current = activeLoad();
    const operator = isOperator();
    $('#fuelLoadFormWrap')?.classList.toggle('hidden', Boolean(current) || !operator);
    $('#fuelRefillFormWrap')?.classList.toggle('hidden', !current || !operator);
    $('#fuelUsageFormWrap')?.classList.toggle('hidden', !current || !operator);
    $('#fuelReadOnlyNotice')?.classList.toggle('hidden', operator);
    if ($('#fuelCheckPreviousPreview')) $('#fuelCheckPreviousPreview').textContent = liters(current?.remainingLiters || 0);
    if ($('#fuelUsageRemainingPreview') && !$('#fuelRemainingLiters')?.value) $('#fuelUsageRemainingPreview').textContent = liters(current?.remainingLiters || 0);

    const status = $('#fuelActiveStatus');
    if (status) {
      status.textContent = current ? 'PARTE ACTIVO' : 'SIN CARGA ACTIVA';
      status.className = `fuel-status-pill ${current ? 'active' : 'empty'}`;
    }

    const summary = $('#fuelSummary');
    if (summary) {
      if (!current) {
        summary.innerHTML = '<div class="fuel-empty"><svg><use href="#i-fuel"></use></svg><strong>No hay un parte de combustible activo</strong><span>El próximo operador puede registrar una nueva carga total y adjuntar su comprobante.</span></div>';
      } else {
        const initial = num(current.initialLiters);
        const totalLoaded = num(current.totalLoadedLiters || initial);
        const refills = Math.max(0, Math.round((totalLoaded - initial) * 100) / 100);
        const remaining = Math.max(0, num(current.remainingLiters));
        const percent = totalLoaded > 0 ? Math.max(0, Math.min(100, (remaining / totalLoaded) * 100)) : 0;
        const latestEvent = timelineFor(current).slice(-1)[0];
        summary.innerHTML = `
          <div class="fuel-summary-head">
            <div><span>CONTROL ${escapeHtml(current.id.slice(-8).toUpperCase())}</span><h3>Saldo real de combustible</h3><p>La cantidad disponible se actualiza con cada foto de nivel y con cada nueva carga.</p></div>
            ${syncBadge(current.syncStatus, current.syncError)}
          </div>
          <div class="fuel-kpi-grid fuel-kpi-grid-four">
            <article><span>Carga inicial</span><strong>${escapeHtml(liters(initial))}</strong></article>
            <article><span>Cargas posteriores</span><strong>+${escapeHtml(liters(refills))}</strong></article>
            <article><span>Consumo calculado</span><strong>${escapeHtml(liters(current.usedLiters))}</strong></article>
            <article class="remaining"><span>Litros que quedan</span><strong>${escapeHtml(liters(remaining))}</strong><small>Último control: ${escapeHtml(formatDateTime(latestEvent?.dateTime || current.dateTime || current.createdAt))}</small></article>
          </div>
          <div class="fuel-level"><div><span style="width:${percent.toFixed(2)}%"></span></div><small>Saldo registrado: ${escapeHtml(liters(remaining))} de ${escapeHtml(liters(totalLoaded))} cargados en total</small></div>
          <div class="fuel-summary-actions">
            ${current.proofDataUrl ? '<button type="button" class="btn btn-soft" data-fuel-photo="load"><svg><use href="#i-camera"></use></svg> Ver foto inicial</button>' : ''}
            <span>${escapeHtml(current.notes || 'Sin observaciones en la carga inicial.')}</span>
          </div>`;
      }
    }

    const movementRoot = $('#fuelMovementsList');
    if (movementRoot) {
      const list = current ? timelineFor(current).reverse() : movements.slice(0, 40);
      movementRoot.innerHTML = list.length ? list.map(item => {
        const isLoad = item.kind === 'fuel_load';
        const isRefill = item.kind === 'fuel_refill';
        const isCheck = item.kind === 'fuel_check';
        const added = isLoad ? num(item.litersAdded || item.initialLiters) : isRefill ? num(item.litersAdded) : 0;
        const used = (isCheck || item.kind === 'fuel_usage') ? num(item.litersUsed) : 0;
        const typeLabel = isLoad ? 'INICIAL' : isRefill ? 'CARGA' : isCheck ? 'LECTURA' : 'CONSUMO';
        const defaultNote = isLoad ? 'Carga inicial' : isRefill ? 'Nueva carga' : isCheck ? 'Control fotográfico del nivel' : 'Consumo registrado';
        return `
        <article class="fuel-movement-row ${isLoad || isRefill ? 'refill' : 'usage'}">
          <div class="fuel-movement-date"><strong>${escapeHtml(item.dateKey || '')}</strong><span>${escapeHtml(item.timeKey || '')}</span></div>
          <div class="fuel-movement-main"><strong>${escapeHtml(item.createdByName || item.createdByEmail || 'Operador')}</strong><span><b class="fuel-movement-type ${isLoad || isRefill ? 'refill' : 'usage'}">${typeLabel}</b> ${escapeHtml(item.notes || defaultNote)}</span></div>
          <div class="fuel-movement-liters ${isLoad || isRefill ? 'added' : ''}"><span>${isLoad || isRefill ? 'Cargados' : 'Usados desde el control anterior'}</span><strong>${isLoad || isRefill ? '+' : '−'}${escapeHtml(liters(isLoad || isRefill ? added : used))}</strong></div>
          <div class="fuel-movement-liters remaining"><span>Quedan</span><strong>${escapeHtml(liters(item.remainingAfter))}</strong></div>
          <div class="fuel-movement-actions">${syncBadge(item.syncStatus, item.syncError)}<button type="button" class="icon-button" ${isLoad ? 'data-fuel-photo="load"' : `data-fuel-photo-id="${escapeHtml(item.id)}"`} aria-label="Ver fotografía"><svg><use href="#i-camera"></use></svg></button></div>
        </article>`;
      }).join('') : '<div class="fuel-empty compact"><strong>Todavía no hay controles registrados</strong><span>Cada foto mostrará cuánto combustible quedaba y cuánto se utilizó desde el control anterior.</span></div>';
    }

    const dailyRoot = $('#fuelDailyBalance');
    if (dailyRoot) {
      const rows = current ? dailyBalances(current) : [];
      dailyRoot.innerHTML = rows.length ? `<div class="fuel-daily-table"><div class="fuel-daily-header"><span>Fecha</span><span>Saldo inicial</span><span>Cargas</span><span>Consumo</span><span>Saldo final</span><span>Fotos</span></div>${rows.map(day => `<div class="fuel-daily-row"><strong>${escapeHtml(day.dateKey)}</strong><span>${escapeHtml(liters(day.opening))}</span><span class="added">+${escapeHtml(liters(day.added))}</span><span class="used">−${escapeHtml(liters(day.used))}</span><span class="remaining">${escapeHtml(liters(day.closing))}</span><span>${day.photos}</span></div>`).join('')}</div>` : '<div class="fuel-empty compact"><strong>No hay datos diarios</strong><span>El cuadro se completa con la carga inicial y cada foto de control.</span></div>';
    }

    const historyRoot = $('#fuelLoadsHistory');
    if (historyRoot) {
      const closed = loads.filter(item => item.id !== current?.id && item.status !== 'active');
      historyRoot.innerHTML = closed.length ? closed.map(item => `
        <article class="fuel-history-card">
          <div><span>${escapeHtml(formatDateTime(item.dateTime || item.createdAt))}</span><strong>${escapeHtml(liters(item.totalLoadedLiters || item.initialLiters))}</strong><small>${escapeHtml(item.createdByName || item.createdByEmail || 'Operador')}</small></div>
          <div><span>Utilizados</span><strong>${escapeHtml(liters(item.usedLiters))}</strong></div>
          <div><span>Saldo final</span><strong>${escapeHtml(liters(item.remainingLiters))}</strong></div>
          <button type="button" class="btn btn-soft btn-sm" data-fuel-load-history="${escapeHtml(item.id)}">Ver movimientos</button>
        </article>`).join('') : '<div class="fuel-empty compact"><strong>No hay registros históricos</strong><span>El control actual permanece activo aunque el saldo llegue a cero.</span></div>';
    }

    const currentRemaining = current ? num(current.remainingLiters) : 0;
    if ($('#fuelRefillRemainingPreview')) $('#fuelRefillRemainingPreview').textContent = liters(currentRemaining + num($('#fuelAddedLiters')?.value));
    const observedPreview = $('#fuelRemainingLiters')?.value === '' ? currentRemaining : Math.max(0, num($('#fuelRemainingLiters')?.value));
    if ($('#fuelCheckPreviousPreview')) $('#fuelCheckPreviousPreview').textContent = liters(currentRemaining);
    if ($('#fuelUsageCalculatedPreview')) $('#fuelUsageCalculatedPreview').textContent = liters(Math.max(0, currentRemaining - observedPreview));
    if ($('#fuelUsageRemainingPreview')) $('#fuelUsageRemainingPreview').textContent = liters(observedPreview);
    const pending = movements.filter(item => item.syncStatus !== 'synced').length + loads.filter(item => item.syncStatus !== 'synced').length;
    if ($('#fuelPendingCount')) $('#fuelPendingCount').textContent = String(pending);
  }

  async function fileToCompressedDataUrl(file) {
    if (!file) throw new Error('Adjunta una foto del comprobante.');
    if (!String(file.type || '').startsWith('image/')) throw new Error('El comprobante debe ser una imagen.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo leer la fotografía.'));
        img.src = objectUrl;
      });
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.78;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > MAX_PHOTO_DATA_LENGTH && quality > 0.38) {
        quality -= 0.08;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > MAX_PHOTO_DATA_LENGTH) throw new Error('La foto es demasiado pesada. Toma la foto con menor resolución.');
      return dataUrl;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function setPhotoPreview(kind, dataUrl) {
    const previews = {
      load: $('#fuelLoadPhotoPreview'),
      refill: $('#fuelRefillPhotoPreview'),
      usage: $('#fuelUsagePhotoPreview')
    };
    const preview = previews[kind];
    if (!preview) return;
    const label = kind === 'refill' ? 'Comprobante de carga listo' : kind === 'usage' ? 'Foto del nivel lista' : 'Foto inicial lista';
    preview.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="Comprobante seleccionado"><span><svg><use href="#i-check"></use></svg> ${label}</span>` : '<svg><use href="#i-camera"></use></svg><strong>Adjuntar comprobante</strong><span>Toma una foto o selecciona una imagen</span>';
    preview.classList.toggle('has-photo', Boolean(dataUrl));
  }

  async function handlePhotoInput(kind, input) {
    try {
      const dataUrl = await fileToCompressedDataUrl(input.files?.[0]);
      if (kind === 'load') loadPhoto = dataUrl;
      else if (kind === 'refill') refillPhoto = dataUrl;
      else usagePhoto = dataUrl;
      setPhotoPreview(kind, dataUrl);
    } catch (error) {
      input.value = '';
      notify('No se pudo adjuntar', error.message || String(error), 'error');
    }
  }

  async function saveNewLoad(event) {
    event.preventDefault();
    if (!isOperator()) return notify('Solo lectura', 'La carga de combustible debe registrarla un operador.', 'error');
    if (activeLoad()) return notify('Ya existe un control activo', 'Agrega una nueva carga o registra un consumo dentro del control actual.', 'error');
    const initialLiters = num($('#fuelInitialLiters')?.value);
    if (!(initialLiters > 0)) return notify('Faltan litros', 'Ingresa los litros totales cargados.', 'error');
    if (!loadPhoto) return notify('Falta el comprobante', 'Adjunta una foto de la carga inicial.', 'error');
    const user = window.LubaydCurrentUser;
    const profile = window.LubaydCurrentProfile || {};
    if (!user?.uid) return notify('Sesión no disponible', 'Vuelve a ingresar con el operador.', 'error');
    const record = {
      id: randomId('fuel_load'),
      kind: 'fuel_load',
      status: 'active',
      dateKey: $('#fuelLoadDate').value || dateKey(),
      timeKey: $('#fuelLoadTime').value || timeKey(),
      dateTime: `${$('#fuelLoadDate').value || dateKey()}T${$('#fuelLoadTime').value || timeKey()}:00`,
      initialLiters,
      totalLoadedLiters: initialLiters,
      lastLoadLiters: initialLiters,
      lastLoadAt: `${$('#fuelLoadDate').value || dateKey()}T${$('#fuelLoadTime').value || timeKey()}:00`,
      usedLiters: 0,
      remainingLiters: initialLiters,
      proofDataUrl: loadPhoto,
      notes: $('#fuelLoadNotes')?.value?.trim() || '',
      createdByUid: user.uid,
      createdByEmail: user.email || profile.email || '',
      createdByName: profile.nombre || user.displayName || user.email || 'Operador',
      createdAt: new Date().toISOString(),
      syncStatus: 'pending',
      syncError: '',
      offlineCaptured: isOffline()
    };
    await window.LubaydOffline.saveFuelLoad(record);
    await window.LubaydOffline.enqueueFuelOperation({ recordId: record.id, userId: user.uid, record });
    loadPhoto = '';
    $('#fuelLoadForm')?.reset();
    setPhotoPreview('load', '');
    setDefaults();
    await refreshLocal();
    notify('Carga guardada', isOffline() ? 'Quedó guardada en este teléfono y se sincronizará al volver internet.' : 'La carga se está enviando al administrador.');
    syncFuelQueue({ silent: true }).catch(() => {});
  }

  async function saveRefill(event) {
    event.preventDefault();
    const current = activeLoad();
    if (!isOperator()) return notify('Solo lectura', 'La carga de combustible debe registrarla un operador.', 'error');
    if (!current) return notify('No hay control activo', 'Primero registra el saldo inicial de combustible.', 'error');
    const litersAdded = num($('#fuelAddedLiters')?.value);
    if (!(litersAdded > 0)) return notify('Faltan litros', 'Ingresa los litros que se agregaron.', 'error');
    if (!refillPhoto) return notify('Falta el comprobante', 'Cada nueva carga debe incluir una foto.', 'error');
    const user = window.LubaydCurrentUser;
    const profile = window.LubaydCurrentProfile || {};
    if (!user?.uid) return notify('Sesión no disponible', 'Vuelve a ingresar con el operador.', 'error');
    const remainingBefore = Math.max(0, num(current.remainingLiters));
    const remainingAfter = Math.round((remainingBefore + litersAdded) * 100) / 100;
    const refillDate = $('#fuelRefillDate').value || dateKey();
    const refillTime = $('#fuelRefillTime').value || timeKey();
    const record = {
      id: randomId('fuel_refill'),
      kind: 'fuel_refill',
      loadId: current.id,
      dateKey: refillDate,
      timeKey: refillTime,
      dateTime: `${refillDate}T${refillTime}:00`,
      litersAdded,
      remainingBefore,
      remainingAfter,
      proofDataUrl: refillPhoto,
      notes: $('#fuelRefillNotes')?.value?.trim() || '',
      createdByUid: user.uid,
      createdByEmail: user.email || profile.email || '',
      createdByName: profile.nombre || user.displayName || user.email || 'Operador',
      createdAt: new Date().toISOString(),
      syncStatus: 'pending',
      syncError: '',
      offlineCaptured: isOffline()
    };
    await window.LubaydOffline.saveFuelMovement(record);
    await window.LubaydOffline.saveFuelLoad({
      ...current,
      totalLoadedLiters: Math.round((num(current.totalLoadedLiters || current.initialLiters) + litersAdded) * 100) / 100,
      lastLoadLiters: litersAdded,
      lastLoadAt: record.dateTime,
      remainingLiters: remainingAfter,
      status: 'active',
      syncStatus: current.syncStatus || 'pending'
    });
    await window.LubaydOffline.enqueueFuelOperation({ recordId: record.id, userId: user.uid, record });
    refillPhoto = '';
    $('#fuelRefillForm')?.reset();
    setPhotoPreview('refill', '');
    setDefaults();
    await refreshLocal();
    notify('Carga agregada', isOffline() ? `Se guardaron ${liters(litersAdded)} en este teléfono. Saldo estimado: ${liters(remainingAfter)}.` : `El saldo estimado ahora es ${liters(remainingAfter)}.`);
    syncFuelQueue({ silent: true }).catch(() => {});
  }

  async function saveUsage(event) {
    event.preventDefault();
    const current = activeLoad();
    if (!isOperator()) return notify('Solo lectura', 'El control de nivel debe registrarlo un operador.', 'error');
    if (!current) return notify('No hay carga activa', 'Primero registra la carga inicial de combustible.', 'error');
    const observedLiters = num($('#fuelRemainingLiters')?.value);
    const previousRemaining = Math.max(0, num(current.remainingLiters));
    if (!(observedLiters >= 0)) return notify('Falta el saldo', 'Ingresa cuántos litros quedan según la foto.', 'error');
    if (observedLiters > previousRemaining + 0.0001) return notify('Saldo mayor al anterior', `El control anterior indica ${liters(previousRemaining)}. Si llegó combustible, usa “Agregar combustible” antes de registrar la nueva lectura.`, 'error');
    if (!usagePhoto) return notify('Falta la foto', 'Cada control debe incluir una foto de cómo viene el combustible.', 'error');
    const user = window.LubaydCurrentUser;
    const profile = window.LubaydCurrentProfile || {};
    if (!user?.uid) return notify('Sesión no disponible', 'Vuelve a ingresar con el operador.', 'error');
    const remainingAfter = Math.round(observedLiters * 100) / 100;
    const litersUsed = Math.max(0, Math.round((previousRemaining - remainingAfter) * 100) / 100);
    const checkDate = $('#fuelUsageDate').value || dateKey();
    const checkTime = $('#fuelUsageTime').value || timeKey();
    const record = {
      id: randomId('fuel_check'),
      kind: 'fuel_check',
      loadId: current.id,
      dateKey: checkDate,
      timeKey: checkTime,
      dateTime: `${checkDate}T${checkTime}:00`,
      observedLiters: remainingAfter,
      litersUsed,
      remainingBefore: previousRemaining,
      remainingAfter,
      proofDataUrl: usagePhoto,
      notes: $('#fuelUsageNotes')?.value?.trim() || '',
      createdByUid: user.uid,
      createdByEmail: user.email || profile.email || '',
      createdByName: profile.nombre || user.displayName || user.email || 'Operador',
      createdAt: new Date().toISOString(),
      syncStatus: 'pending',
      syncError: '',
      offlineCaptured: isOffline()
    };
    await window.LubaydOffline.saveFuelMovement(record);
    await window.LubaydOffline.saveFuelLoad({
      ...current,
      totalLoadedLiters: num(current.totalLoadedLiters || current.initialLiters),
      usedLiters: Math.round((num(current.usedLiters) + litersUsed) * 100) / 100,
      remainingLiters: remainingAfter,
      lastCheckAt: record.dateTime,
      status: 'active',
      syncStatus: current.syncStatus || 'pending'
    });
    await window.LubaydOffline.enqueueFuelOperation({ recordId: record.id, userId: user.uid, record });
    usagePhoto = '';
    $('#fuelUsageForm')?.reset();
    setPhotoPreview('usage', '');
    setDefaults();
    await refreshLocal();
    notify('Lectura guardada', isOffline() ? `Quedó guardada la foto. Saldo: ${liters(remainingAfter)}; consumo calculado: ${liters(litersUsed)}.` : `Se registraron ${liters(remainingAfter)} disponibles y ${liters(litersUsed)} utilizados desde el control anterior.`);
    syncFuelQueue({ silent: true }).catch(() => {});
  }

  async function syncFuelQueue(options = {}) {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      if (!window.LubaydOffline?.listFuelQueue) return { synced: 0, errors: 0 };

      const identity = await window.LubaydOffline.getDeviceIdentity?.().catch(() => null);
      const firebaseUser = onlineUser();
      const hasOnlineOperator = Boolean(!isOffline() && firebaseUser?.uid);
      const deviceReady = Boolean(identity?.enrolled && identity.deviceId && identity.deviceToken);
      if (!hasOnlineOperator && !deviceReady) return { synced: 0, errors: 0 };

      // El combustible es un control compartido. Se procesan todas las operaciones guardadas
      // en este teléfono, aunque hayan sido creadas por otro operador que usó la misma PWA.
      const priority = { fuel_load: 0, fuel_refill: 1, fuel_check: 2, fuel_usage: 2 };
      const items = (await window.LubaydOffline.listFuelQueue({ statuses: ['pending', 'error', 'syncing'] }))
        .sort((a, b) => {
          const pa = priority[a.record?.kind] ?? 9;
          const pb = priority[b.record?.kind] ?? 9;
          if (pa !== pb) return pa - pb;
          const da = String(a.record?.dateTime || a.record?.createdAt || a.createdAt || '');
          const db = String(b.record?.dateTime || b.record?.createdAt || b.createdAt || '');
          return da.localeCompare(db) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        });

      let synced = 0;
      let errors = 0;
      const idToken = hasOnlineOperator ? await firebaseUser.getIdToken(false) : '';

      for (const item of items) {
        try {
          await window.LubaydOffline.updateFuelQueue(item.recordId, { status: 'syncing', lastError: '' });
          const parentLoad = item.record?.kind === 'fuel_load'
            ? null
            : await window.LubaydOffline.getFuelLoad?.(item.record?.loadId).catch(() => null);
          const result = await window.LubaydOffline.syncFuelQueueItem(item, identity, { idToken, parentLoad });
          if (result.load) await window.LubaydOffline.saveFuelLoad({ ...result.load, syncStatus: 'synced', syncError: '' });
          if (result.movement) await window.LubaydOffline.saveFuelMovement({ ...result.movement, syncStatus: 'synced', syncError: '' });
          await window.LubaydOffline.markFuelSynced(item.recordId);
          synced += 1;
        } catch (error) {
          errors += 1;
          await window.LubaydOffline.markFuelError(item.recordId, error);
          if (item.record?.kind === 'fuel_load') await window.LubaydOffline.saveFuelLoad({ ...item.record, syncStatus: 'error', syncError: error.message || String(error) });
          if (['fuel_usage', 'fuel_check', 'fuel_refill'].includes(item.record?.kind)) await window.LubaydOffline.saveFuelMovement({ ...item.record, syncStatus: 'error', syncError: error.message || String(error) });
        }
      }
      await refreshLocal();
      if (!options.silent && (synced || errors)) notify(errors ? 'Sincronización incompleta' : 'Combustible sincronizado', errors ? `${synced} enviados y ${errors} con error.` : `${synced} registro(s) enviados al administrador.`, errors ? 'error' : 'success');
      return { synced, errors };
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function startCloudSubscription() {
    cloudUnsubscribe?.();
    cloudUnsubscribe = null;
    if (isOffline() || !window.LubaydFuelCloud?.available || !onlineUser()) return;
    try {
      cloudUnsubscribe = window.LubaydFuelCloud.subscribe(async data => {
        await window.LubaydOffline.mergeFuelCloudData(data.loads || [], data.movements || []);
        await refreshLocal();
      }, error => console.warn('Combustible cloud:', error));
    } catch (error) {
      console.warn('No se pudo iniciar combustible cloud:', error);
    }
  }

  function openPhoto(dataUrl, title = 'Comprobante') {
    if (!dataUrl) return notify('Sin fotografía', 'Este registro no tiene comprobante disponible.', 'error');
    const modal = $('#fuelPhotoModal');
    if (!modal) return;
    $('#fuelPhotoTitle').textContent = title;
    $('#fuelPhotoImage').src = dataUrl;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closePhoto() {
    $('#fuelPhotoModal')?.classList.add('hidden');
    if ($('#fuelPhotoImage')) $('#fuelPhotoImage').src = '';
    document.body.classList.remove('modal-open');
  }

  async function showHistoryLoad(loadId) {
    const selected = loads.find(item => item.id === loadId);
    if (!selected) return;
    const list = movementsFor(loadId);
    const content = $('#detailContent');
    if (!content) return;
    content.innerHTML = `
      <span class="detail-eyebrow">PARTE DE COMBUSTIBLE</span>
      <h2>Control de ${escapeHtml(liters(selected.totalLoadedLiters || selected.initialLiters))}</h2>
      <p>${escapeHtml(formatDateTime(selected.dateTime || selected.createdAt))} · ${escapeHtml(selected.createdByName || selected.createdByEmail || '')}</p>
      <div class="fuel-kpi-grid modal-kpis"><article><span>Total cargado</span><strong>${escapeHtml(liters(selected.totalLoadedLiters || selected.initialLiters))}</strong></article><article><span>Usado</span><strong>${escapeHtml(liters(selected.usedLiters))}</strong></article><article><span>Saldo</span><strong>${escapeHtml(liters(selected.remainingLiters))}</strong></article></div>
      <div class="fuel-modal-list">${list.length ? list.map(item => { const refill = item.kind === 'fuel_refill'; const check = item.kind === 'fuel_check'; return `<div><span>${escapeHtml(item.dateKey)} ${escapeHtml(item.timeKey)} · ${refill ? 'Carga' : check ? 'Lectura' : 'Consumo'}</span><strong>${refill ? '+' : '−'}${escapeHtml(liters(refill ? item.litersAdded : item.litersUsed))}</strong><small>Quedan ${escapeHtml(liters(item.remainingAfter))}</small></div>`; }).join('') : '<p>Sin movimientos.</p>'}</div>`;
    $('#detailModal')?.classList.remove('hidden');
  }

  function bindEvents() {
    $('#fuelLoadForm')?.addEventListener('submit', saveNewLoad);
    $('#fuelRefillForm')?.addEventListener('submit', saveRefill);
    $('#fuelUsageForm')?.addEventListener('submit', saveUsage);
    $('#fuelLoadPhotoInput')?.addEventListener('change', event => handlePhotoInput('load', event.target));
    $('#fuelRefillPhotoInput')?.addEventListener('change', event => handlePhotoInput('refill', event.target));
    $('#fuelUsagePhotoInput')?.addEventListener('change', event => handlePhotoInput('usage', event.target));
    $('#fuelSyncBtn')?.addEventListener('click', () => syncFuelQueue({ silent: false }));
    $('#fuelAddedLiters')?.addEventListener('input', () => {
      const current = activeLoad();
      const preview = Math.max(0, num(current?.remainingLiters)) + Math.max(0, num($('#fuelAddedLiters')?.value));
      if ($('#fuelRefillRemainingPreview')) $('#fuelRefillRemainingPreview').textContent = liters(preview);
    });
    $('#fuelRemainingLiters')?.addEventListener('input', () => {
      const current = activeLoad();
      const previous = Math.max(0, num(current?.remainingLiters));
      const observed = Math.max(0, num($('#fuelRemainingLiters')?.value));
      const used = Math.max(0, previous - observed);
      if ($('#fuelCheckPreviousPreview')) $('#fuelCheckPreviousPreview').textContent = liters(previous);
      if ($('#fuelUsageCalculatedPreview')) $('#fuelUsageCalculatedPreview').textContent = liters(used);
      if ($('#fuelUsageRemainingPreview')) $('#fuelUsageRemainingPreview').textContent = liters(observed);
    });
    $('#combustibleControl')?.addEventListener('click', event => {
      const photoButton = event.target.closest('[data-fuel-photo]');
      if (photoButton) openPhoto(activeLoad()?.proofDataUrl, 'Comprobante de la carga inicial');
      const movementButton = event.target.closest('[data-fuel-photo-id]');
      if (movementButton) {
        const movement = movements.find(item => item.id === movementButton.dataset.fuelPhotoId);
        openPhoto(movement?.proofDataUrl, `Comprobante ${movement?.dateKey || ''} ${movement?.timeKey || ''}`);
      }
      const historyButton = event.target.closest('[data-fuel-load-history]');
      if (historyButton) showHistoryLoad(historyButton.dataset.fuelLoadHistory);
    });
    $('#fuelPhotoClose')?.addEventListener('click', closePhoto);
    $('#fuelPhotoModal .fuel-photo-backdrop')?.addEventListener('click', closePhoto);
  }

  async function initialize() {
    setDefaults();
    await refreshLocal().catch(error => console.warn('Combustible local:', error));
    startCloudSubscription();
    if (!isOffline()) syncFuelQueue({ silent: true }).catch(() => {});
  }

  bindEvents();
  window.LubaydFuelUI = { show: initialize, refresh: refreshLocal };
  window.LubaydSyncFuel = syncFuelQueue;

  window.addEventListener('lubayd-profile-ready', () => initialize());
  window.addEventListener('lubayd-offline-profile-ready', () => initialize());
  window.addEventListener('lubayd-offline-signed-out', () => { cloudUnsubscribe?.(); cloudUnsubscribe = null; });
  window.addEventListener('lubayd-offline-state-changed', () => refreshLocal().catch(() => {}));
  window.addEventListener('online', () => syncFuelQueue({ silent: true }).catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncFuelQueue({ silent: true }).catch(() => {});
  });
  refreshTimer = window.setInterval(() => {
    if (uid()) syncFuelQueue({ silent: true }).catch(() => {});
  }, 20000);

  if (window.LubaydCurrentUser) initialize();
})();
