/* Lubayd SA V17 - Asistencia con gestión administrativa, foto, GPS y hora de servidor */
(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const escapeHtml = window.escapeHtml || (value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])));

  const state = {
    user: null,
    profile: null,
    records: [],
    metadata: {},
    unsubscribe: null,
    stream: null,
    cameraMode: 'entry',
    photoBlob: null,
    gps: null,
    timer: null,
    busy: false,
    editingRecordId: null,
    offlineSession: false,
    syncing: false
  };

  function dateKeyUruguay(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return String(value);
    return new Intl.DateTimeFormat('es-UY', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTime(value) {
    const date = toDate(value);
    return date ? new Intl.DateTimeFormat('es-UY', { timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date) : '—';
  }

  function minutesBetween(start, end) {
    const from = toDate(start);
    const to = toDate(end);
    if (!from || !to) return 0;
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  }

  function formatDuration(minutes) {
    const safe = Math.max(0, Number(minutes || 0));
    const hours = Math.floor(safe / 60);
    const mins = Math.round(safe % 60);
    return `${hours} h ${String(mins).padStart(2, '0')} min`;
  }

  function initials(name) {
    return String(name || 'US').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'US';
  }

  function notify(title, text, type = 'success') {
    const toast = $('#toast');
    if (!toast) return;
    const titleNode = $('#toastTitle');
    const textNode = $('#toastText');
    if (titleNode) titleNode.textContent = title;
    if (textNode) textNode.textContent = text;
    toast.dataset.type = type;
    toast.classList.remove('hidden');
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => toast.classList.add('hidden'), 4200);
  }


  function canRegister() {
    return state.profile?.role === 'operador';
  }

  function hasOnlineFirebaseSession() {
    return Boolean(
      navigator.onLine &&
      !state.offlineSession &&
      window.firebase?.auth?.().currentUser?.uid &&
      window.firebase.auth().currentUser.uid === state.user?.uid
    );
  }

  function markSyncStatus(record, kind) {
    const prefix = kind === 'exit' ? 'exit' : 'entry';
    return record?.[`${prefix}SyncStatus`] || (record?.[`${prefix}At`] ? 'synced' : '');
  }

  function syncChip(record, kind) {
    const status = markSyncStatus(record, kind);
    if (!status || status === 'synced') return status === 'synced' ? '<span class="attendance-sync-chip synced">Sincronizada</span>' : '';
    if (status === 'error') return '<span class="attendance-sync-chip error">Error de sincronización</span>';
    return '<span class="attendance-sync-chip">Pendiente de sincronización</span>';
  }

  async function loadLocalRecords() {
    if (!window.LubaydOffline?.available) return;
    const options = state.profile?.role === 'admin' || state.profile?.role === 'supervisor'
      ? {}
      : { userId: state.user?.uid };
    const local = await window.LubaydOffline.listAttendance(options).catch(() => []);
    state.records = local;
    render();
  }

  async function deviceSyncIdentity() {
    const identity = await window.LubaydOffline?.getDeviceIdentity?.().catch(() => null);
    return identity?.enrolled && identity.deviceId && identity.deviceToken ? identity : null;
  }

  async function updateOfflineState() {
    if (!window.LubaydOffline?.available) return;
    const userId = state.user?.uid || null;
    const items = await window.LubaydOffline.listQueue({ userId, statuses: ['pending', 'syncing', 'error'] }).catch(() => []);
    const partItems = await window.LubaydOffline.listPartQueue?.({ userId, statuses: ['pending', 'syncing', 'error'] }).catch(() => []) || [];
    const errors = [...items, ...partItems].filter(item => item.status === 'error');
    const totalPending = items.length + partItems.length;
    const identity = await deviceSyncIdentity();
    const canSync = hasOnlineFirebaseSession() || Boolean(identity);
    const box = $('#attendanceQueueState');
    if (box) {
      box.className = `attendance-queue-state ${errors.length ? 'error' : totalPending ? 'pending' : ''}`;
      box.innerHTML = errors.length
        ? `<i></i><span><strong>${errors.length} registro(s) con error</strong><small>Conéctate e intenta sincronizar nuevamente.</small></span>`
        : totalPending
          ? `<i></i><span><strong>${totalPending} registro(s) pendiente(s)</strong><small>${items.length} marca(s) y ${partItems.length} parte(s) guardados en este teléfono.</small></span>`
          : '<i></i><span><strong>Todo sincronizado</strong><small>Las marcas y los partes ya están disponibles para administración.</small></span>';
    }
    const button = $('#attendanceSyncBtn');
    if (button) {
      button.disabled = state.syncing || !totalPending || !canSync;
      button.innerHTML = state.syncing
        ? '<span class="button-spinner"></span> Sincronizando...'
        : `<svg><use href="#i-refresh"></use></svg> Sincronizar ahora${totalPending ? ` (${totalPending})` : ''}`;
    }
  }

  async function syncPending(options = {}) {
    if (state.syncing || !window.LubaydOffline?.available) {
      await updateOfflineState();
      return;
    }
    const identity = await deviceSyncIdentity();
    const onlineUid = window.firebase?.auth?.().currentUser?.uid || '';
    const userId = options.allUsers ? null : (state.user?.uid || null);
    if (!identity && !onlineUid) {
      await updateOfflineState();
      return;
    }
    state.syncing = true;
    if (userId) await window.LubaydOffline.retryErrors(userId).catch(() => {});
    else {
      const failed = await window.LubaydOffline.listQueue({ statuses: ['error'] }).catch(() => []);
      for (const item of failed) await window.LubaydOffline.updateQueue(item.id, { status: 'pending', lastError: '' }).catch(() => {});
    }
    await updateOfflineState();
    let synced = 0;
    try {
      const items = await window.LubaydOffline.listQueue({ userId, statuses: ['pending', 'error', 'syncing'] });
      for (const item of items) {
        try {
          await window.LubaydOffline.updateQueue(item.id, { status: 'syncing', lastError: '' });
          let remote;
          const canUseFirebaseUser = Boolean(item.gps) && onlineUid === item.userId && window.LubaydCurrentProfile?.role === 'operador' && window.LubaydAttendanceData?.available;
          if (canUseFirebaseUser) {
            remote = await window.LubaydAttendanceData.registerQueued(item);
          } else {
            const transport = window.LubaydOffline?.syncQueueItemWithDevice || window.LubaydOfflineDeviceCloud?.syncQueueItem;
            if (!identity || !transport) throw new Error('Este dispositivo no fue habilitado por un administrador para sincronizar sin sesión de Firebase.');
            remote = await transport(item, identity);
          }
          await window.LubaydOffline.markSynced(item.id, remote);
          synced += 1;
        } catch (error) {
          await window.LubaydOffline.markError(item.id, error);
          if (/network|conexi|offline|fetch|failed to fetch|load failed/i.test(String(error?.message || error))) break;
        }
      }
      if (state.user?.uid) await loadLocalRecords();
      if (!options.silent && synced) notify('Sincronización completada', `${synced} marca(s) enviada(s) a Firebase.`);
    } finally {
      state.syncing = false;
      await updateOfflineState();
    }
  }

  window.LubaydSyncOfflineAttendance = options => syncPending({ ...(options || {}), allUsers: true });

  function currentTodayRecord() {
    if (!state.user) return null;
    const key = dateKeyUruguay();
    return state.records.find(record => record.userId === state.user.uid && record.dateKey === key) || null;
  }

  function statusOf(record) {
    if (!record) return 'pendiente';
    if (record.exitAt || record.exitPhotoId) return 'finalizado';
    return 'trabajando';
  }

  function statusLabel(status) {
    return ({ pendiente: 'Sin registrar', trabajando: 'En descanso', finalizado: 'Completado' })[status] || status;
  }

  function gpsQuality(accuracy) {
    const value = Number(accuracy || 0);
    if (value <= 15) return { label: 'Excelente', className: 'excellent' };
    if (value <= 50) return { label: 'Aceptable', className: 'acceptable' };
    return { label: 'Baja precisión', className: 'low' };
  }

  function mapUrl(gps) {
    if (!gps || !Number.isFinite(Number(gps.latitude)) || !Number.isFinite(Number(gps.longitude))) return '#';
    return `https://www.google.com/maps?q=${encodeURIComponent(`${gps.latitude},${gps.longitude}`)}`;
  }

  function renderPersonal() {
    const manager = state.profile?.role === 'admin' || state.profile?.role === 'supervisor';
    $('#attendancePersonalArea')?.classList.toggle('hidden', manager);
    $('#attendanceActionBar')?.classList.toggle('hidden', manager);
    $('#attendancePersonalHistoryCard')?.classList.toggle('hidden', manager);
    $('#attendanceManagerNotice')?.classList.toggle('hidden', !manager);
    $('#attendanceOfflineCard')?.classList.toggle('hidden', manager);

    const record = currentTodayRecord();
    const status = statusOf(record);
    const name = state.profile?.nombre || state.user?.displayName || state.user?.email || 'Usuario';
    const entryMinutes = record?.entryAt ? minutesBetween(record.entryAt, record.exitAt || new Date()) : 0;

    const avatar = $('#attendanceUserAvatar');
    const userName = $('#attendanceUserName');
    const todayDate = $('#attendanceTodayDate');
    const statusPill = $('#attendanceStatusPill');
    const duration = $('#attendanceLiveDuration');
    if (avatar) avatar.textContent = initials(name);
    if (userName) userName.textContent = name;
    if (todayDate) todayDate.textContent = formatDate(dateKeyUruguay());
    if (statusPill) {
      statusPill.className = `attendance-status ${status}`;
      statusPill.innerHTML = `<i></i>${statusLabel(status)}`;
    }
    if (duration) duration.textContent = record ? formatDuration(entryMinutes) : '0 h 00 min';

    if (!manager) {
      renderMarkCard('entry', record);
      renderMarkCard('exit', record);
      renderPersonalHistory();
    }

    const entryButton = $('#attendanceEntryBtn');
    const exitButton = $('#attendanceExitBtn');
    if (entryButton) {
      entryButton.disabled = !canRegister() || Boolean(record?.entryAt) || state.busy;
      entryButton.innerHTML = record?.entryAt
        ? '<svg><use href="#i-check"></use></svg> Inicio registrado'
        : '<svg><use href="#i-camera"></use></svg> Iniciar descanso';
    }
    if (exitButton) {
      exitButton.disabled = !canRegister() || !record?.entryAt || Boolean(record?.exitAt || record?.exitPhotoId) || state.busy;
      exitButton.innerHTML = record?.exitAt || record?.exitPhotoId
        ? '<svg><use href="#i-check"></use></svg> Fin registrado'
        : '<svg><use href="#i-camera"></use></svg> Finalizar descanso';
    }

    const onlineNotice = $('#attendanceOnlineNotice');
    if (onlineNotice) {
      const pending = record && [markSyncStatus(record, 'entry'), markSyncStatus(record, 'exit')].some(value => value && value !== 'synced');
      onlineNotice.classList.toggle('offline', !navigator.onLine || state.offlineSession);
      onlineNotice.classList.toggle('pending', pending);
      onlineNotice.innerHTML = !navigator.onLine || state.offlineSession
        ? '<i></i><span><strong>Modo sin conexión</strong><small>Las marcas se guardan en este teléfono y se enviarán después.</small></span>'
        : pending
          ? '<i></i><span><strong>Sincronización pendiente</strong><small>Pulsa “Sincronizar ahora” para enviarlas a Firebase.</small></span>'
          : '<i></i><span><strong>Conexión disponible</strong><small>Las marcas nuevas se sincronizarán automáticamente.</small></span>';
    }
    updateOfflineState();
  }

  function renderMarkCard(kind, record) {
    const isEntry = kind === 'entry';
    const prefix = isEntry ? 'entry' : 'exit';
    const hasMark = isEntry ? Boolean(record?.entryAt || record?.entryPhotoId) : Boolean(record?.exitAt || record?.exitPhotoId);
    const time = isEntry ? record?.entryAt : record?.exitAt;
    const photoId = isEntry ? record?.entryPhotoId : record?.exitPhotoId;
    const gps = isEntry ? record?.entryGps : record?.exitGps;
    const card = $(`#attendance-${prefix}-card`);
    if (!card) return;
    card.classList.toggle('completed', hasMark);
    const quality = gps ? gpsQuality(gps.accuracy) : null;
    const status = markSyncStatus(record, kind);
    card.innerHTML = `
      <div class="attendance-mark-icon ${hasMark ? 'done' : ''}"><svg><use href="#${isEntry ? 'i-log-in' : 'i-log-out'}"></use></svg></div>
      <div class="attendance-mark-content">
        <span>${isEntry ? 'INICIO' : 'FIN'}</span>
        <strong>${hasMark ? formatTime(time) : 'Pendiente'}</strong>
        <small>${hasMark ? (status === 'synced' ? 'Hora sincronizada con Firebase' : 'Hora guardada en este teléfono') : isEntry ? 'Inicia tu descanso con fotografía y ubicación' : 'Finaliza tu descanso con fotografía y ubicación'}</small>
        ${gps ? `<div class="attendance-gps-chip ${quality.className}"><svg><use href="#i-pin"></use></svg>${quality.label} · ±${Math.round(Number(gps.accuracy || 0))} m</div>` : ''}
        ${hasMark ? syncChip(record, kind) : ''}
      </div>
      ${hasMark ? `<div class="attendance-mark-actions"><button type="button" data-attendance-photo="${escapeHtml(photoId)}" aria-label="Ver foto"><svg><use href="#i-camera"></use></svg></button><a href="${mapUrl(gps)}" target="_blank" rel="noopener" aria-label="Ver ubicación"><svg><use href="#i-map"></use></svg></a></div>` : ''}
    `;
  }

  function renderPersonalHistory() {
    const root = $('#attendancePersonalHistory');
    if (!root || !state.user) return;
    const records = state.records.filter(record => record.userId === state.user.uid).slice(0, 10);
    if (!records.length) {
      root.innerHTML = '<div class="attendance-empty"><svg><use href="#i-clock"></use></svg><strong>Todavía no hay registros</strong><span>Tu historial de descansos aparecerá aquí.</span></div>';
      return;
    }
    root.innerHTML = records.map(record => {
      const total = record.entryAt && record.exitAt ? formatDuration(minutesBetween(record.entryAt, record.exitAt)) : 'En curso';
      const status = statusOf(record);
      const pending = [markSyncStatus(record, 'entry'), markSyncStatus(record, 'exit')].some(value => value && value !== 'synced');
      return `<article class="attendance-history-row">
        <div class="attendance-history-date"><strong>${escapeHtml(formatDate(record.dateKey))}</strong><span class="attendance-status ${status}"><i></i>${escapeHtml(statusLabel(status))}</span>${pending ? '<span class="attendance-sync-chip">Pendiente</span>' : ''}</div>
        <div><span>Inicio</span><strong>${escapeHtml(formatTime(record.entryAt))}</strong></div>
        <div><span>Fin</span><strong>${escapeHtml(formatTime(record.exitAt))}</strong></div>
        <div><span>Total</span><strong>${escapeHtml(total)}</strong></div>
        <div class="attendance-history-actions">
          ${record.entryPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.entryPhotoId)}" title="Foto de inicio"><svg><use href="#i-camera"></use></svg></button>` : ''}
          ${record.exitPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.exitPhotoId)}" title="Foto de fin"><svg><use href="#i-camera"></use></svg></button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  function inputTimeValue(value) {
    const date = toDate(value);
    if (!date) return '';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${values.hour}:${values.minute}`;
  }

  function renderTeam() {
    const adminPanel = $('#attendanceAdminPanel');
    const canSeeTeam = state.profile?.role === 'admin' || state.profile?.role === 'supervisor';
    const isAdmin = state.profile?.role === 'admin' && !state.offlineSession;
    if (!adminPanel) return;
    adminPanel.classList.toggle('hidden', !canSeeTeam);
    adminPanel.classList.toggle('can-manage-attendance', isAdmin);
    $$('.attendance-admin-only-column').forEach(node => node.classList.toggle('hidden', !isAdmin));
    if (!canSeeTeam) return;

    const selectedDate = $('#attendanceAdminDate')?.value || dateKeyUruguay();
    const search = String($('#attendanceAdminSearch')?.value || '').trim().toLowerCase();
    const records = state.records.filter(record => record.dateKey === selectedDate).filter(record => !search || `${record.userName || ''} ${record.userEmail || ''}`.toLowerCase().includes(search));
    const working = records.filter(record => statusOf(record) === 'trabajando').length;
    const completed = records.filter(record => statusOf(record) === 'finalizado').length;
    const durations = records.filter(record => record.entryAt && record.exitAt).map(record => minutesBetween(record.entryAt, record.exitAt));
    const average = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;

    const summary = {
      attendanceTeamTotal: records.length,
      attendanceTeamWorking: working,
      attendanceTeamCompleted: completed,
      attendanceTeamAverage: formatDuration(average)
    };
    Object.entries(summary).forEach(([id, value]) => { const node = document.getElementById(id); if (node) node.textContent = value; });

    const body = $('#attendanceAdminBody');
    const empty = $('#attendanceAdminEmpty');
    if (!body) return;
    if (!records.length) {
      body.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    body.innerHTML = records.sort((a, b) => String(a.userName || '').localeCompare(String(b.userName || ''), 'es')).map(record => {
      const status = statusOf(record);
      const total = record.entryAt && record.exitAt ? formatDuration(minutesBetween(record.entryAt, record.exitAt)) : 'En curso';
      const corrected = record.correctedAt ? '<span class="attendance-corrected-chip"><svg><use href="#i-edit"></use></svg> Corregido</span>' : '';
      const capturedOffline = record.entryOfflineCaptured || record.exitOfflineCaptured ? '<span class="attendance-offline-chip"><svg><use href="#i-cloud"></use></svg> Capturada sin conexión</span>' : '';
      return `<tr>
        <td data-label="Usuario"><div class="attendance-person-cell"><span>${initials(record.userName)}</span><div><strong>${escapeHtml(record.userName || 'Usuario')}</strong><small>${escapeHtml(record.userEmail || '')}</small>${corrected}${capturedOffline}</div></div></td>
        <td data-label="Inicio">${escapeHtml(formatTime(record.entryAt))}</td>
        <td data-label="Fin">${escapeHtml(formatTime(record.exitAt))}</td>
        <td data-label="Total">${escapeHtml(total)}</td>
        <td data-label="Estado"><span class="attendance-status ${status}"><i></i>${escapeHtml(statusLabel(status))}</span></td>
        <td data-label="Ubicación"><div class="attendance-table-actions">${record.entryGps ? `<a href="${mapUrl(record.entryGps)}" target="_blank" rel="noopener" title="Ver ubicación"><svg><use href="#i-pin"></use></svg></a>` : '<span>—</span>'}</div></td>
        <td data-label="Evidencia"><div class="attendance-table-actions">
          ${record.entryPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.entryPhotoId)}" title="Foto de inicio"><svg><use href="#i-camera"></use></svg></button>` : ''}
          ${record.exitPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.exitPhotoId)}" title="Foto de fin"><svg><use href="#i-camera"></use></svg></button>` : ''}
        </div></td>
        <td data-label="Administración" class="attendance-admin-actions-cell ${isAdmin ? '' : 'hidden'}"><div class="attendance-admin-row-actions">
          <button type="button" data-attendance-edit="${escapeHtml(record.id)}" title="Modificar horario"><svg><use href="#i-edit"></use></svg><span>Editar</span></button>
          <button type="button" class="danger" data-attendance-delete="${escapeHtml(record.id)}" title="Eliminar registro"><svg><use href="#i-trash"></use></svg><span>Eliminar</span></button>
        </div></td>
      </tr>`;
    }).join('');
  }

  function selectedAdminRecord() {
    return state.records.find(record => record.id === state.editingRecordId) || null;
  }

  function openAdminEditor(recordId, deleteMode = false) {
    if (state.profile?.role !== 'admin' || state.offlineSession) return notify('Conexión requerida', 'Para modificar o eliminar horarios debes iniciar sesión con internet.', 'error');
    const record = state.records.find(item => item.id === recordId);
    if (!record) return notify('Registro no encontrado', 'Actualiza la lista e intenta nuevamente.', 'error');
    state.editingRecordId = recordId;
    const modal = $('#attendanceAdminEditModal');
    const entry = $('#attendanceAdminEntryTime');
    const exit = $('#attendanceAdminExitTime');
    const reason = $('#attendanceAdminEditReason');
    if (entry) entry.value = inputTimeValue(record.entryAt);
    if (exit) exit.value = inputTimeValue(record.exitAt);
    if (reason) reason.value = '';
    const user = $('#attendanceAdminEditUser');
    if (user) user.textContent = `${record.userName || record.userEmail || 'Usuario'} · ${formatDate(record.dateKey)}`;
    modal?.classList.remove('hidden');
    document.body.classList.add('attendance-admin-modal-open');
    window.setTimeout(() => (deleteMode ? reason : entry)?.focus(), 50);
  }

  function closeAdminEditor() {
    state.editingRecordId = null;
    $('#attendanceAdminEditModal')?.classList.add('hidden');
    document.body.classList.remove('attendance-admin-modal-open');
    const form = $('#attendanceAdminEditForm');
    if (form) form.reset();
  }

  async function saveAdminAttendance(event) {
    event?.preventDefault();
    if (state.profile?.role !== 'admin' || state.offlineSession) return;
    const record = selectedAdminRecord();
    if (!record) return closeAdminEditor();
    const entryTime = String($('#attendanceAdminEntryTime')?.value || '').trim();
    const exitTime = String($('#attendanceAdminExitTime')?.value || '').trim();
    const reason = String($('#attendanceAdminEditReason')?.value || '').trim();
    if (!entryTime) return notify('Falta la llegada', 'Indica una hora de llegada válida.', 'error');
    if (!reason) return notify('Falta el motivo', 'Escribe por qué se modifica el horario.', 'error');
    if (record.exitAt && !exitTime) return notify('Falta la salida', 'Indica una hora de salida o elimina el registro completo.', 'error');
    if (exitTime && exitTime <= entryTime) return notify('Horario inválido', 'La salida debe ser posterior a la llegada.', 'error');
    const button = $('#attendanceAdminEditSave');
    if (button) { button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Guardando...'; }
    try {
      await window.LubaydAttendanceData.updateByAdmin(record.id, { entryTime, exitTime, reason });
      notify('Horario actualizado', `Se corrigió la asistencia de ${record.userName || 'usuario'} y quedó registrada en la auditoría.`);
      closeAdminEditor();
    } catch (error) {
      console.error('Modificar asistencia:', error);
      notify('No se pudo modificar', error.message || 'Revisa las reglas de Firestore.', 'error');
    } finally {
      if (button) { button.disabled = false; button.innerHTML = '<svg><use href="#i-check"></use></svg> Guardar cambios'; }
    }
  }

  async function deleteAdminAttendance(recordId) {
    if (state.profile?.role !== 'admin' || state.offlineSession) return;
    if (recordId && state.editingRecordId !== recordId) openAdminEditor(recordId, true);
    const record = state.records.find(item => item.id === (recordId || state.editingRecordId));
    if (!record) return;
    const reason = String($('#attendanceAdminEditReason')?.value || '').trim();
    if (!reason) return notify('Falta el motivo', 'Escribe el motivo antes de eliminar el registro.', 'error');
    const accepted = window.confirm(`¿Eliminar completamente el horario de ${record.userName || record.userEmail || 'este usuario'} del ${formatDate(record.dateKey)}?

La acción quedará registrada y no se puede deshacer.`);
    if (!accepted) return;
    const button = $('#attendanceAdminDeleteBtn');
    if (button) { button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Eliminando...'; }
    try {
      await window.LubaydAttendanceData.deleteByAdmin(record.id, reason);
      notify('Horario eliminado', 'El registro fue eliminado por el administrador y la acción quedó auditada.');
      closeAdminEditor();
    } catch (error) {
      console.error('Eliminar asistencia:', error);
      notify('No se pudo eliminar', error.message || 'Revisa las reglas de Firestore.', 'error');
    } finally {
      if (button) { button.disabled = false; button.innerHTML = '<svg><use href="#i-trash"></use></svg> Eliminar registro'; }
    }
  }

  function render() {
    renderPersonal();
    renderTeam();
  }

  async function subscribe() {
    state.unsubscribe?.();
    state.unsubscribe = null;
    if (!state.user) return;
    await loadLocalRecords();
    if (state.offlineSession || !window.LubaydAttendanceData?.available || !hasOnlineFirebaseSession()) {
      state.metadata = { fromCache: true, hasPendingWrites: true, offlineSession: state.offlineSession };
      render();
      return;
    }
    state.unsubscribe = window.LubaydAttendanceData.subscribe(state.profile, async function (records, metadata) {
      const remote = records || [];
      const localScope = state.profile?.role === 'admin' || state.profile?.role === 'supervisor' ? {} : { userId: state.user.uid };
      await window.LubaydOffline?.mergeRemoteRecords?.(remote).catch(error => console.warn('Guardar asistencia local:', error));
      await window.LubaydOffline?.pruneSyncedAttendance?.(remote.map(record => record.id), localScope).catch(error => console.warn('Limpiar asistencia local:', error));
      const local = await window.LubaydOffline?.listAttendance?.(localScope).catch(() => []);
      const remoteIds = new Set(remote.map(record => record.id));
      const pendingLocal = (local || []).filter(record =>
        !remoteIds.has(record.id) &&
        [record.entrySyncStatus, record.exitSyncStatus].some(value => value && value !== 'synced')
      );
      state.records = [...remote, ...pendingLocal].sort((a, b) => String(b.dateKey || '').localeCompare(String(a.dateKey || '')));
      state.metadata = metadata || {};
      render();
      await syncPending({ silent: true });
    }, async function (error) {
      console.error('Asistencia:', error);
      await loadLocalRecords();
      notify('Sin conexión con Firebase', 'Se muestran las marcas disponibles en este dispositivo.', 'error');
    });
  }

  function updateCameraState(kind, title, text, className) {
    const node = $('#attendanceCameraState');
    if (!node) return;
    node.className = `camera-state ${className || ''}`;
    node.innerHTML = `<span class="camera-state-icon"><svg><use href="#${kind}"></use></svg></span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`;
  }

  function getPosition(options) {
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
  }

  async function obtainGps() {
    if (!navigator.geolocation) throw new Error('Este dispositivo no permite obtener la ubicación.');
    updateCameraState('i-pin', 'Buscando ubicación', 'La cámara puede utilizarse mientras se obtiene el GPS.', 'loading');
    try {
      const cached = await getPosition({ enableHighAccuracy: false, timeout: 7000, maximumAge: 10 * 60 * 1000 });
      return {
        latitude: cached.coords.latitude,
        longitude: cached.coords.longitude,
        accuracy: cached.coords.accuracy,
        capturedAtClient: new Date(cached.timestamp || Date.now()).toISOString(),
        source: 'cached-or-network'
      };
    } catch (_) {
      const precise = await getPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      return {
        latitude: precise.coords.latitude,
        longitude: precise.coords.longitude,
        accuracy: precise.coords.accuracy,
        capturedAtClient: new Date(precise.timestamp || Date.now()).toISOString(),
        source: 'gps'
      };
    }
  }

  function waitForVideo(video, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (video?.readyState >= 2 && video.videoWidth > 0) return resolve();
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('La cámara no entregó imagen. Revisa el permiso y vuelve a abrir la aplicación.'));
      }, timeoutMs);
      const ready = () => {
        if (video.videoWidth <= 0) return;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        video?.removeEventListener('loadedmetadata', ready);
        video?.removeEventListener('canplay', ready);
      };
      video?.addEventListener('loadedmetadata', ready);
      video?.addEventListener('canplay', ready);
    });
  }

  async function getCameraStream() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara no está disponible en este navegador.');
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 1280 } }
      });
    } catch (firstError) {
      console.warn('Cámara frontal no disponible, usando cámara predeterminada:', firstError);
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
  }

  async function openCamera(mode) {
    if (state.busy) return;
    if (!canRegister()) {
      notify('Acción no disponible', 'El administrador y el supervisor no realizan marcas.', 'error');
      return;
    }
    const record = currentTodayRecord();
    if (mode === 'entry' && record?.entryAt) return notify('Inicio ya registrado', 'Solo se permite un inicio de descanso por día.', 'error');
    if (mode === 'exit' && !record?.entryAt) return notify('Falta la llegada', 'Primero debes registrar la llegada.', 'error');
    if (mode === 'exit' && (record.exitAt || record.exitPhotoId)) return notify('Fin ya registrado', 'Solo se permite un fin de descanso por día.', 'error');

    stopStream();
    state.cameraMode = mode;
    state.photoBlob = null;
    state.gps = null;
    const modal = $('#attendanceCameraModal');
    const video = $('#attendanceCameraVideo');
    const preview = $('#attendanceCameraPreview');
    const captureBtn = $('#attendanceCaptureBtn');
    const confirmBtn = $('#attendanceConfirmBtn');
    const retakeBtn = $('#attendanceRetakeBtn');
    $('#attendanceCameraTitle').textContent = mode === 'entry' ? 'Iniciar descanso' : 'Finalizar descanso';
    $('#attendanceCameraSubtitle').textContent = navigator.onLine && !state.offlineSession
      ? 'Foto, GPS y hora de Uruguay'
      : 'La marca quedará guardada en este teléfono';
    preview?.classList.add('hidden');
    video?.classList.remove('hidden');
    captureBtn?.classList.remove('hidden');
    confirmBtn?.classList.add('hidden');
    retakeBtn?.classList.add('hidden');
    if (captureBtn) captureBtn.disabled = true;
    if (modal) modal.classList.remove('hidden');
    document.body.classList.add('camera-open');
    updateCameraState('i-camera', 'Preparando cámara', 'Permite el acceso a la cámara del teléfono.', 'loading');

    const gpsPromise = obtainGps()
      .then(gps => {
        state.gps = gps;
        const quality = gpsQuality(gps.accuracy);
        updateCameraState('i-check', 'Cámara y GPS listos', `${quality.label} · precisión aproximada ±${Math.round(gps.accuracy)} m`, 'success');
        return gps;
      })
      .catch(error => {
        state.gps = null;
        updateCameraState('i-alert', 'Cámara lista · GPS no disponible', `${error.message || 'No se obtuvo ubicación.'} Puedes tomar la foto y la marca quedará identificada como “Sin GPS”.`, 'warning');
        return null;
      });

    try {
      state.stream = await getCameraStream();
      if (!video) throw new Error('No se encontró el visor de la cámara.');
      video.srcObject = state.stream;
      await video.play();
      await waitForVideo(video);
      if (captureBtn) captureBtn.disabled = false;
      if (!state.gps) updateCameraState('i-pin', 'Cámara lista · buscando GPS', 'Ya puedes tomar la foto. La ubicación continuará intentando en segundo plano.', 'loading');
      gpsPromise.catch(() => {});
    } catch (error) {
      stopStream();
      updateCameraState('i-alert', 'No se pudo iniciar la cámara', error.message || 'Revisa el permiso de cámara del dispositivo.', 'error');
      if (captureBtn) captureBtn.disabled = true;
    }
  }

  function stopStream() {
    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
    const video = $('#attendanceCameraVideo');
    if (video) video.srcObject = null;
  }

  function closeCamera() {
    stopStream();
    state.photoBlob = null;
    state.gps = null;
    state.busy = false;
    $('#attendanceCameraModal')?.classList.add('hidden');
    document.body.classList.remove('camera-open');
    renderPersonal();
  }

  async function capturePhoto() {
    const video = $('#attendanceCameraVideo');
    const canvas = $('#attendanceCameraCanvas');
    const preview = $('#attendanceCameraPreview');
    if (!video || !canvas || video.readyState < 2) return notify('Cámara no preparada', 'Espera un momento y vuelve a intentar.', 'error');
    const sourceWidth = video.videoWidth || 720;
    const sourceHeight = video.videoHeight || 720;
    const side = Math.min(sourceWidth, sourceHeight);
    const sx = Math.max(0, (sourceWidth - side) / 2);
    const sy = Math.max(0, (sourceHeight - side) / 2);
    canvas.width = 600;
    canvas.height = 600;
    const context = canvas.getContext('2d', { alpha: false });
    context.save();
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    context.restore();
    state.photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.76));
    if (state.photoBlob && state.photoBlob.size > 430000) {
      state.photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.58));
    }
    if (!state.photoBlob) return notify('No se pudo capturar', 'Intenta tomar la fotografía nuevamente.', 'error');
    if (preview) {
      preview.src = URL.createObjectURL(state.photoBlob);
      preview.classList.remove('hidden');
    }
    video.classList.add('hidden');
    $('#attendanceCaptureBtn')?.classList.add('hidden');
    $('#attendanceConfirmBtn')?.classList.remove('hidden');
    $('#attendanceRetakeBtn')?.classList.remove('hidden');
    updateCameraState('i-check', 'Fotografía capturada', 'Verifica la imagen antes de confirmar la marcación.', 'success');
  }

  async function retakePhoto() {
    state.photoBlob = null;
    const preview = $('#attendanceCameraPreview');
    const video = $('#attendanceCameraVideo');
    preview?.classList.add('hidden');
    video?.classList.remove('hidden');
    $('#attendanceCaptureBtn')?.classList.remove('hidden');
    $('#attendanceConfirmBtn')?.classList.add('hidden');
    $('#attendanceRetakeBtn')?.classList.add('hidden');
    updateCameraState('i-camera', 'Cámara lista', 'Coloca tu rostro dentro del recuadro y toma la foto.', 'success');
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo procesar la fotografía.'));
      reader.readAsDataURL(blob);
    });
  }

  async function confirmMark() {
    if (state.busy || !state.photoBlob || !canRegister()) return;
    if (!window.LubaydOffline?.available) return notify('Modo offline no disponible', 'Este navegador no permite guardar la marca en el teléfono.', 'error');
    state.busy = true;
    const button = $('#attendanceConfirmBtn');
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="button-spinner"></span> Guardando...';
    }
    updateCameraState('i-cloud', 'Guardando en el teléfono', 'La foto, el GPS y la hora quedarán guardados hasta sincronizar.', 'loading');
    try {
      const capturedAt = new Date().toISOString();
      const dateKey = dateKeyUruguay(new Date(capturedAt));
      const type = state.cameraMode === 'exit' ? 'exit' : 'entry';
      const attendanceId = `${state.user.uid}_${dateKey}`;
      const photoId = `${attendanceId}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const imageData = await blobToDataUrl(state.photoBlob);
      if (imageData.length > 700000) throw new Error('La fotografía supera el tamaño permitido. Tómala nuevamente.');
      await window.LubaydOffline.enqueueMark({
        attendanceId,
        userId: state.user.uid,
        userName: state.profile?.nombre || state.user.displayName || state.user.email || 'Usuario',
        userEmail: state.user.email || state.profile?.email || '',
        dateKey,
        type,
        photoId,
        imageData,
        capturedAt,
        gps: state.gps || null,
        gpsUnavailable: !state.gps,
        offlineCaptured: !hasOnlineFirebaseSession()
      });
      await loadLocalRecords();
      notify(type === 'entry' ? 'Inicio guardado' : 'Fin guardado', hasOnlineFirebaseSession()
        ? 'La marca se guardó y comenzará a sincronizarse.'
        : 'La marca quedó protegida en este teléfono hasta recuperar internet.');
      closeCamera();
      if (hasOnlineFirebaseSession()) syncPending({ silent: true });
    } catch (error) {
      console.error('Registro de asistencia:', error);
      state.busy = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = '<svg><use href="#i-check"></use></svg> Confirmar registro';
      }
      updateCameraState('i-alert', 'No se pudo guardar', error.message || 'Intenta nuevamente.', 'error');
    }
  }

  function withPhotoTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
  }

  function resetPhotoLoading() {
    const loading = $('#attendancePhotoLoading');
    if (!loading) return;
    loading.innerHTML = '<span class="button-spinner"></span><strong>Cargando fotografía</strong><span>Verificando permisos…</span>';
    loading.classList.remove('hidden');
  }

  function waitForPhotoImage(image, source) {
    return withPhotoTimeout(new Promise((resolve, reject) => {
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
      };
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(new Error('La fotografía está dañada o tiene un formato no compatible.'));
      };
      image.src = source;
      if (image.complete && image.naturalWidth > 0) {
        cleanup();
        resolve();
      }
    }), 12000, 'La imagen demoró demasiado en abrirse.');
  }

  async function openPhoto(path) {
    if (!path) return;
    const modal = $('#attendancePhotoModal');
    const image = $('#attendancePhotoImage');
    const loading = $('#attendancePhotoLoading');
    modal?.classList.remove('hidden');
    document.body.classList.add('camera-open');
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      image.classList.add('hidden');
    }
    resetPhotoLoading();

    try {
      const local = await withPhotoTimeout(
        Promise.resolve(window.LubaydOffline?.getPhoto?.(path)).catch(() => null),
        2500,
        'No se pudo consultar el almacenamiento local.'
      ).catch(() => null);

      const source = local?.imageData || await withPhotoTimeout(
        window.LubaydAttendanceData.getPhotoUrl(path),
        15000,
        'Firebase no respondió al solicitar la fotografía.'
      );

      if (typeof source !== 'string' || !source.startsWith('data:image/')) {
        throw new Error('La fotografía guardada no contiene una imagen válida.');
      }
      if (!image) throw new Error('No se encontró el visor de fotografías.');

      await waitForPhotoImage(image, source);
      image.classList.remove('hidden');
      loading?.classList.add('hidden');
    } catch (error) {
      if (image) {
        image.removeAttribute('src');
        image.classList.add('hidden');
      }
      if (loading) {
        loading.classList.remove('hidden');
        loading.innerHTML = `<svg><use href="#i-alert"></use></svg><strong>No se pudo abrir la fotografía</strong><span>${escapeHtml(error.message || 'La foto no está disponible en este dispositivo.')}</span>`;
      }
      console.error('Abrir fotografía de asistencia:', error);
    }
  }

  function closePhoto() {
    $('#attendancePhotoModal')?.classList.add('hidden');
    $('#attendancePhotoImage')?.removeAttribute('src');
    document.body.classList.remove('camera-open');
  }

  function bindEvents() {
    $('#attendanceEntryBtn')?.addEventListener('click', () => openCamera('entry'));
    $('#attendanceExitBtn')?.addEventListener('click', () => openCamera('exit'));
    $('#attendanceCloseCamera')?.addEventListener('click', closeCamera);
    $('#attendanceCancelCamera')?.addEventListener('click', closeCamera);
    $('.attendance-camera-backdrop')?.addEventListener('click', closeCamera);
    $('#attendanceCaptureBtn')?.addEventListener('click', capturePhoto);
    $('#attendanceRetakeBtn')?.addEventListener('click', retakePhoto);
    $('#attendanceConfirmBtn')?.addEventListener('click', confirmMark);
    $('#attendanceAdminDate')?.addEventListener('change', renderTeam);
    $('#attendanceAdminRefresh')?.addEventListener('click', () => subscribe());
    $('#attendanceAdminSearch')?.addEventListener('input', renderTeam);
    $('#attendanceClosePhoto')?.addEventListener('click', closePhoto);
    $('.attendance-photo-backdrop')?.addEventListener('click', closePhoto);
    $('#attendanceAdminEditForm')?.addEventListener('submit', saveAdminAttendance);
    $('#attendanceAdminEditClose')?.addEventListener('click', closeAdminEditor);
    $('#attendanceAdminEditCancel')?.addEventListener('click', closeAdminEditor);
    $('.attendance-admin-edit-backdrop')?.addEventListener('click', closeAdminEditor);
    $('#attendanceAdminDeleteBtn')?.addEventListener('click', () => deleteAdminAttendance());
    $('#attendanceSyncBtn')?.addEventListener('click', async () => { await Promise.all([syncPending(), window.LubaydSyncOfflineParts?.({ silent: false })]); await updateOfflineState(); });
    document.addEventListener('click', event => {
      const photoButton = event.target.closest('[data-attendance-photo]');
      if (photoButton) return openPhoto(photoButton.dataset.attendancePhoto);
      const editButton = event.target.closest('[data-attendance-edit]');
      if (editButton) return openAdminEditor(editButton.dataset.attendanceEdit);
      const deleteButton = event.target.closest('[data-attendance-delete]');
      if (deleteButton) return openAdminEditor(deleteButton.dataset.attendanceDelete, true);
    });
    const resumeSync = (delay = 300) => window.setTimeout(() => syncPending({ silent: true, allUsers: true }), delay);
    window.addEventListener('online', () => { renderPersonal(); if (!state.offlineSession) subscribe(); resumeSync(100); });
    window.addEventListener('load', () => resumeSync(1800));
    window.addEventListener('pageshow', () => resumeSync(450));
    window.addEventListener('focus', () => resumeSync(300));
    window.addEventListener('resume', () => resumeSync(250));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeSync(250); });
    window.addEventListener('offline', renderPersonal);
    window.addEventListener('lubayd-offline-state-changed', () => { loadLocalRecords(); updateOfflineState(); });
    window.addEventListener('beforeunload', stopStream);
  }

  function initialize(user, profile, options = {}) {
    state.user = user;
    state.profile = profile;
    state.offlineSession = Boolean(options.offline || window.LubaydOfflineSession || user?.isOffline);
    const dateInput = $('#attendanceAdminDate');
    if (dateInput && !dateInput.value) dateInput.value = dateKeyUruguay();
    subscribe();
    render();
    updateOfflineState();
    window.clearInterval(state.timer);
    state.timer = window.setInterval(() => {
      if ($('#asistencia')?.classList.contains('active')) renderPersonal();
    }, 30000);
  }

  function show() {
    render();
  }

  bindEvents();
  window.LubaydAttendanceUI = { show, render, openCamera, openAdminEditor, syncPending, subscribe };
  window.addEventListener('lubayd-profile-ready', event => initialize(event.detail?.user, event.detail?.profile, { offline: false }));
  window.addEventListener('lubayd-offline-profile-ready', event => initialize(event.detail?.user, event.detail?.profile, { offline: true }));
  window.addEventListener('lubayd-auth-changed', event => {
    if (!event.detail?.user) {
      if (state.offlineSession) return;
      state.unsubscribe?.();
      state.unsubscribe = null;
      state.user = null;
      state.profile = null;
      state.records = [];
      stopStream();
      window.clearInterval(state.timer);
    }
  });
  window.addEventListener('lubayd-offline-signed-out', () => {
    state.unsubscribe?.();
    state.unsubscribe = null;
    state.user = null;
    state.profile = null;
    state.records = [];
    state.offlineSession = false;
    stopStream();
    window.clearInterval(state.timer);
  });
  if (window.LubaydCurrentUser && window.LubaydCurrentProfile) initialize(window.LubaydCurrentUser, window.LubaydCurrentProfile, { offline: Boolean(window.LubaydOfflineSession) });
})();
