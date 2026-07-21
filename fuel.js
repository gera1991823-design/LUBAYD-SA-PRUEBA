/* Lubayd SA V20.8.9 - parte único de combustible con consumo diario y modo offline */
(function () {
  'use strict';

  const VERSION = '20.8.9';
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
    // V20.8.9 mantiene un único control continuo. Si una versión anterior lo cerró al llegar a cero,
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
        const totalLoaded = num(current.totalLoadedLiters || current.initialLiters);
        const remaining = Math.max(0, num(current.remainingLiters));
        const percent = totalLoaded > 0 ? Math.max(0, Math.min(100, (remaining / totalLoaded) * 100)) : 0;
        const lastLoad = num(current.lastLoadLiters || current.initialLiters);
        summary.innerHTML = `
          <div class="fuel-summary-head">
            <div><span>CONTROL ${escapeHtml(current.id.slice(-8).toUpperCase())}</span><h3>Saldo acumulado de combustible</h3><p>Iniciado ${escapeHtml(formatDateTime(current.dateTime || current.createdAt))} por ${escapeHtml(current.createdByName || current.createdByEmail || 'Operador')}</p></div>
            ${syncBadge(current.syncStatus, current.syncError)}
          </div>
          <div class="fuel-kpi-grid fuel-kpi-grid-four">
            <article><span>Total cargado</span><strong>${escapeHtml(liters(totalLoaded))}</strong></article>
            <article><span>Última carga</span><strong>+${escapeHtml(liters(lastLoad))}</strong><small>${escapeHtml(formatDateTime(current.lastLoadAt || current.dateTime || current.createdAt))}</small></article>
            <article><span>Total utilizado</span><strong>${escapeHtml(liters(current.usedLiters))}</strong></article>
            <article class="remaining"><span>Saldo actual</span><strong>${escapeHtml(liters(remaining))}</strong></article>
          </div>
          <div class="fuel-level"><div><span style="width:${percent.toFixed(2)}%"></span></div><small>${percent.toFixed(1).replace('.', ',')}% del total ingresado continúa disponible</small></div>
          <div class="fuel-summary-actions">
            ${current.proofDataUrl ? '<button type="button" class="btn btn-soft" data-fuel-photo="load"><svg><use href="#i-camera"></use></svg> Ver comprobante inicial</button>' : ''}
            <span>${escapeHtml(current.notes || 'Sin observaciones en el saldo inicial.')}</span>
          </div>`;
      }
    }

    const movementRoot = $('#fuelMovementsList');
    if (movementRoot) {
      const list = current ? movementsFor(current.id) : movements.slice(0, 40);
      movementRoot.innerHTML = list.length ? list.map(item => {
        const isRefill = item.kind === 'fuel_refill';
        const movementLiters = isRefill ? num(item.litersAdded) : num(item.litersUsed);
        const defaultNote = isRefill ? 'Carga de combustible' : 'Consumo diario';
        return `
        <article class="fuel-movement-row ${isRefill ? 'refill' : 'usage'}">
          <div class="fuel-movement-date"><strong>${escapeHtml(item.dateKey || '')}</strong><span>${escapeHtml(item.timeKey || '')}</span></div>
          <div class="fuel-movement-main"><strong>${escapeHtml(item.createdByName || item.createdByEmail || 'Operador')}</strong><span><b class="fuel-movement-type ${isRefill ? 'refill' : 'usage'}">${isRefill ? 'CARGA' : 'CONSUMO'}</b> ${escapeHtml(item.notes || defaultNote)}</span></div>
          <div class="fuel-movement-liters ${isRefill ? 'added' : ''}"><span>${isRefill ? 'Agregados' : 'Utilizados'}</span><strong>${isRefill ? '+' : '−'}${escapeHtml(liters(movementLiters))}</strong></div>
          <div class="fuel-movement-liters remaining"><span>Saldo</span><strong>${escapeHtml(liters(item.remainingAfter))}</strong></div>
          <div class="fuel-movement-actions">${syncBadge(item.syncStatus, item.syncError)}<button type="button" class="icon-button" data-fuel-photo-id="${escapeHtml(item.id)}" aria-label="Ver comprobante"><svg><use href="#i-camera"></use></svg></button></div>
        </article>`;
      }).join('') : '<div class="fuel-empty compact"><strong>Todavía no hay movimientos registrados</strong><span>Cada carga o consumo aparecerá con litros, saldo, hora y comprobante.</span></div>';
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
    if ($('#fuelUsageRemainingPreview')) $('#fuelUsageRemainingPreview').textContent = liters(Math.max(0, currentRemaining - num($('#fuelUsedLiters')?.value)));
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
    const label = kind === 'refill' ? 'Comprobante de carga listo' : kind === 'usage' ? 'Foto del consumo lista' : 'Comprobante inicial listo';
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
    if (!isOperator()) return notify('Solo lectura', 'El consumo diario debe registrarlo un operador.', 'error');
    if (!current) return notify('No hay carga activa', 'Primero registra la carga total de combustible.', 'error');
    const litersUsed = num($('#fuelUsedLiters')?.value);
    if (!(litersUsed > 0)) return notify('Faltan litros', 'Ingresa los litros utilizados en el día.', 'error');
    if (litersUsed > num(current.remainingLiters)) return notify('Saldo insuficiente', `Solo quedan ${liters(current.remainingLiters)}.`, 'error');
    if (!usagePhoto) return notify('Falta el comprobante', 'Cada consumo diario debe incluir una foto.', 'error');
    const user = window.LubaydCurrentUser;
    const profile = window.LubaydCurrentProfile || {};
    if (!user?.uid) return notify('Sesión no disponible', 'Vuelve a ingresar con el operador.', 'error');
    const remainingAfter = Math.max(0, Math.round((num(current.remainingLiters) - litersUsed) * 100) / 100);
    const record = {
      id: randomId('fuel_usage'),
      kind: 'fuel_usage',
      loadId: current.id,
      dateKey: $('#fuelUsageDate').value || dateKey(),
      timeKey: $('#fuelUsageTime').value || timeKey(),
      dateTime: `${$('#fuelUsageDate').value || dateKey()}T${$('#fuelUsageTime').value || timeKey()}:00`,
      litersUsed,
      remainingBefore: num(current.remainingLiters),
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
      status: 'active',
      syncStatus: current.syncStatus || 'pending'
    });
    await window.LubaydOffline.enqueueFuelOperation({ recordId: record.id, userId: user.uid, record });
    usagePhoto = '';
    $('#fuelUsageForm')?.reset();
    setPhotoPreview('usage', '');
    setDefaults();
    await refreshLocal();
    notify('Consumo guardado', isOffline() ? 'La foto y los litros quedaron guardados en este teléfono.' : 'El movimiento se está sincronizando.');
    syncFuelQueue({ silent: true }).catch(() => {});
  }

  async function syncFuelQueue(options = {}) {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const userId = uid();
      if (!userId || !window.LubaydOffline?.listFuelQueue) return { synced: 0, errors: 0 };
      const identity = await window.LubaydOffline.getDeviceIdentity?.().catch(() => null);
      const firebaseUser = onlineUser();
      const sameOnlineUser = Boolean(!isOffline() && firebaseUser?.uid === userId);
      const deviceReady = Boolean(identity?.enrolled && identity.deviceId && identity.deviceToken);
      if (!sameOnlineUser && !deviceReady) return { synced: 0, errors: 0 };
      const items = await window.LubaydOffline.listFuelQueue({ userId, statuses: ['pending', 'error', 'syncing'] });
      let synced = 0;
      let errors = 0;
      for (const item of items) {
        try {
          await window.LubaydOffline.updateFuelQueue(item.recordId, { status: 'syncing', lastError: '' });
          const idToken = sameOnlineUser ? await firebaseUser.getIdToken(false) : '';
          const result = await window.LubaydOffline.syncFuelQueueItem(item, identity, { idToken });
          if (result.load) await window.LubaydOffline.saveFuelLoad({ ...result.load, syncStatus: 'synced', syncError: '' });
          if (result.movement) await window.LubaydOffline.saveFuelMovement({ ...result.movement, syncStatus: 'synced', syncError: '' });
          await window.LubaydOffline.markFuelSynced(item.recordId);
          synced += 1;
        } catch (error) {
          errors += 1;
          await window.LubaydOffline.markFuelError(item.recordId, error);
          if (item.record?.kind === 'fuel_load') await window.LubaydOffline.saveFuelLoad({ ...item.record, syncStatus: 'error', syncError: error.message || String(error) });
          if (['fuel_usage', 'fuel_refill'].includes(item.record?.kind)) await window.LubaydOffline.saveFuelMovement({ ...item.record, syncStatus: 'error', syncError: error.message || String(error) });
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
      <div class="fuel-modal-list">${list.length ? list.map(item => { const refill = item.kind === 'fuel_refill'; return `<div><span>${escapeHtml(item.dateKey)} ${escapeHtml(item.timeKey)} · ${refill ? 'Carga' : 'Consumo'}</span><strong>${refill ? '+' : '−'}${escapeHtml(liters(refill ? item.litersAdded : item.litersUsed))}</strong><small>Saldo ${escapeHtml(liters(item.remainingAfter))}</small></div>`; }).join('') : '<p>Sin movimientos.</p>'}</div>`;
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
    $('#fuelUsedLiters')?.addEventListener('input', () => {
      const current = activeLoad();
      const preview = Math.max(0, num(current?.remainingLiters) - num($('#fuelUsedLiters')?.value));
      if ($('#fuelUsageRemainingPreview')) $('#fuelUsageRemainingPreview').textContent = liters(preview);
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
