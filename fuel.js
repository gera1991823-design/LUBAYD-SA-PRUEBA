/* Lubayd SA V21.0.0 - parte único de combustible con consumo diario y modo offline */
(function () {
  'use strict';

  const VERSION = '21.0.0';
  const MAX_PHOTO_DATA_LENGTH = 620000;
  let loads = [];
  let movements = [];
  let cloudUnsubscribe = null;
  let syncPromise = null;
  let refreshTimer = null;
  let loadPhoto = '';
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
    return loads.find(item => item.status === 'active' && item.syncStatus === 'synced') || loads.find(item => item.status === 'active') || null;
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
        const percent = current.initialLiters > 0 ? Math.max(0, Math.min(100, (num(current.remainingLiters) / num(current.initialLiters)) * 100)) : 0;
        summary.innerHTML = `
          <div class="fuel-summary-head">
            <div><span>PARTE ${escapeHtml(current.id.slice(-8).toUpperCase())}</span><h3>Carga iniciada ${escapeHtml(formatDateTime(current.dateTime || current.createdAt))}</h3><p>Registrada por ${escapeHtml(current.createdByName || current.createdByEmail || 'Operador')}</p></div>
            ${syncBadge(current.syncStatus, current.syncError)}
          </div>
          <div class="fuel-kpi-grid">
            <article><span>Carga total</span><strong>${escapeHtml(liters(current.initialLiters))}</strong></article>
            <article><span>Utilizados</span><strong>${escapeHtml(liters(current.usedLiters))}</strong></article>
            <article class="remaining"><span>Disponibles</span><strong>${escapeHtml(liters(current.remainingLiters))}</strong></article>
          </div>
          <div class="fuel-level"><div><span style="width:${percent.toFixed(2)}%"></span></div><small>${percent.toFixed(1).replace('.', ',')}% disponible</small></div>
          <div class="fuel-summary-actions">
            ${current.proofDataUrl ? '<button type="button" class="btn btn-soft" data-fuel-photo="load"><svg><use href="#i-camera"></use></svg> Ver comprobante inicial</button>' : ''}
            <span>${escapeHtml(current.notes || 'Sin observaciones en la carga inicial.')}</span>
          </div>`;
      }
    }

    const movementRoot = $('#fuelMovementsList');
    if (movementRoot) {
      const list = current ? movementsFor(current.id) : movements.slice(0, 40);
      movementRoot.innerHTML = list.length ? list.map(item => `
        <article class="fuel-movement-row">
          <div class="fuel-movement-date"><strong>${escapeHtml(item.dateKey || '')}</strong><span>${escapeHtml(item.timeKey || '')}</span></div>
          <div class="fuel-movement-main"><strong>${escapeHtml(item.createdByName || item.createdByEmail || 'Operador')}</strong><span>${escapeHtml(item.notes || 'Consumo diario')}</span></div>
          <div class="fuel-movement-liters"><span>Usados</span><strong>−${escapeHtml(liters(item.litersUsed))}</strong></div>
          <div class="fuel-movement-liters remaining"><span>Quedan</span><strong>${escapeHtml(liters(item.remainingAfter))}</strong></div>
          <div class="fuel-movement-actions">${syncBadge(item.syncStatus, item.syncError)}<button type="button" class="icon-button" data-fuel-photo-id="${escapeHtml(item.id)}" aria-label="Ver comprobante"><svg><use href="#i-camera"></use></svg></button></div>
        </article>`).join('') : '<div class="fuel-empty compact"><strong>Todavía no hay consumos registrados</strong><span>Cada uso diario aparecerá con litros, saldo, hora y comprobante.</span></div>';
    }

    const historyRoot = $('#fuelLoadsHistory');
    if (historyRoot) {
      const closed = loads.filter(item => item.status !== 'active');
      historyRoot.innerHTML = closed.length ? closed.map(item => `
        <article class="fuel-history-card">
          <div><span>${escapeHtml(formatDateTime(item.dateTime || item.createdAt))}</span><strong>${escapeHtml(liters(item.initialLiters))}</strong><small>${escapeHtml(item.createdByName || item.createdByEmail || 'Operador')}</small></div>
          <div><span>Utilizados</span><strong>${escapeHtml(liters(item.usedLiters))}</strong></div>
          <div><span>Saldo final</span><strong>${escapeHtml(liters(item.remainingLiters))}</strong></div>
          <button type="button" class="btn btn-soft btn-sm" data-fuel-load-history="${escapeHtml(item.id)}">Ver movimientos</button>
        </article>`).join('') : '<div class="fuel-empty compact"><strong>No hay partes cerrados</strong><span>Cuando el saldo llegue a cero, el parte pasará al historial.</span></div>';
    }

    const currentRemaining = current ? num(current.remainingLiters) : 0;
    if ($('#fuelUsageRemainingPreview')) $('#fuelUsageRemainingPreview').textContent = liters(currentRemaining);
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
    const preview = kind === 'load' ? $('#fuelLoadPhotoPreview') : $('#fuelUsagePhotoPreview');
    if (!preview) return;
    preview.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="Comprobante seleccionado"><span><svg><use href="#i-check"></use></svg> Comprobante listo</span>` : '<svg><use href="#i-camera"></use></svg><strong>Adjuntar comprobante</strong><span>Toma una foto o selecciona una imagen</span>';
    preview.classList.toggle('has-photo', Boolean(dataUrl));
  }

  async function handlePhotoInput(kind, input) {
    try {
      const dataUrl = await fileToCompressedDataUrl(input.files?.[0]);
      if (kind === 'load') loadPhoto = dataUrl;
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
    if (activeLoad()) return notify('Ya existe un parte activo', 'Registra el consumo dentro del parte actual.', 'error');
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
      usedLiters: Math.round((num(current.usedLiters) + litersUsed) * 100) / 100,
      remainingLiters: remainingAfter,
      status: remainingAfter <= 0 ? 'closed' : 'active',
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
          if (item.record?.kind === 'fuel_usage') await window.LubaydOffline.saveFuelMovement({ ...item.record, syncStatus: 'error', syncError: error.message || String(error) });
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
      <h2>Carga de ${escapeHtml(liters(selected.initialLiters))}</h2>
      <p>${escapeHtml(formatDateTime(selected.dateTime || selected.createdAt))} · ${escapeHtml(selected.createdByName || selected.createdByEmail || '')}</p>
      <div class="fuel-kpi-grid modal-kpis"><article><span>Total</span><strong>${escapeHtml(liters(selected.initialLiters))}</strong></article><article><span>Usado</span><strong>${escapeHtml(liters(selected.usedLiters))}</strong></article><article><span>Saldo</span><strong>${escapeHtml(liters(selected.remainingLiters))}</strong></article></div>
      <div class="fuel-modal-list">${list.length ? list.map(item => `<div><span>${escapeHtml(item.dateKey)} ${escapeHtml(item.timeKey)}</span><strong>−${escapeHtml(liters(item.litersUsed))}</strong><small>Quedaron ${escapeHtml(liters(item.remainingAfter))}</small></div>`).join('') : '<p>Sin movimientos.</p>'}</div>`;
    $('#detailModal')?.classList.remove('hidden');
  }

  function bindEvents() {
    $('#fuelLoadForm')?.addEventListener('submit', saveNewLoad);
    $('#fuelUsageForm')?.addEventListener('submit', saveUsage);
    $('#fuelLoadPhotoInput')?.addEventListener('change', event => handlePhotoInput('load', event.target));
    $('#fuelUsagePhotoInput')?.addEventListener('change', event => handlePhotoInput('usage', event.target));
    $('#fuelSyncBtn')?.addEventListener('click', () => syncFuelQueue({ silent: false }));
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
