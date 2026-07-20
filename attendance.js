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
    editingRecordId: null
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
    return date ? new Intl.DateTimeFormat('es-UY', { hour: '2-digit', minute: '2-digit' }).format(date) : '—';
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
    return ({ pendiente: 'Sin marcar', trabajando: 'Jornada activa', finalizado: 'Turno finalizado' })[status] || status;
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

    renderMarkCard('entry', record);
    renderMarkCard('exit', record);

    const entryButton = $('#attendanceEntryBtn');
    const exitButton = $('#attendanceExitBtn');
    if (entryButton) {
      entryButton.disabled = Boolean(record) || state.busy;
      entryButton.innerHTML = record
        ? '<svg><use href="#i-check"></use></svg> Llegada registrada'
        : '<svg><use href="#i-camera"></use></svg> Registrar llegada';
    }
    if (exitButton) {
      exitButton.disabled = !record || Boolean(record?.exitAt || record?.exitPhotoId) || state.busy;
      exitButton.innerHTML = record?.exitAt || record?.exitPhotoId
        ? '<svg><use href="#i-check"></use></svg> Salida registrada'
        : '<svg><use href="#i-camera"></use></svg> Registrar salida';
    }

    const onlineNotice = $('#attendanceOnlineNotice');
    if (onlineNotice) {
      onlineNotice.classList.toggle('offline', !navigator.onLine);
      onlineNotice.innerHTML = navigator.onLine
        ? '<i></i><span><strong>Conexión disponible</strong><small>La hora se confirmará desde Firebase.</small></span>'
        : '<i></i><span><strong>Sin conexión</strong><small>La marcación se habilitará al recuperar internet.</small></span>';
    }

    renderPersonalHistory();
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
    card.innerHTML = `
      <div class="attendance-mark-icon ${hasMark ? 'done' : ''}"><svg><use href="#${isEntry ? 'i-log-in' : 'i-log-out'}"></use></svg></div>
      <div class="attendance-mark-content">
        <span>${isEntry ? 'LLEGADA' : 'SALIDA'}</span>
        <strong>${hasMark ? formatTime(time) : 'Pendiente'}</strong>
        <small>${hasMark ? 'Hora registrada por el servidor' : isEntry ? 'Inicia tu jornada con una fotografía' : 'Finaliza tu jornada con una fotografía'}</small>
        ${gps ? `<div class="attendance-gps-chip ${quality.className}"><svg><use href="#i-pin"></use></svg>${quality.label} · ±${Math.round(Number(gps.accuracy || 0))} m</div>` : ''}
      </div>
      ${hasMark ? `<div class="attendance-mark-actions"><button type="button" data-attendance-photo="${escapeHtml(photoId)}" aria-label="Ver foto"><svg><use href="#i-camera"></use></svg></button><a href="${mapUrl(gps)}" target="_blank" rel="noopener" aria-label="Ver ubicación"><svg><use href="#i-map"></use></svg></a></div>` : ''}
    `;
  }

  function renderPersonalHistory() {
    const root = $('#attendancePersonalHistory');
    if (!root || !state.user) return;
    const records = state.records.filter(record => record.userId === state.user.uid).slice(0, 10);
    if (!records.length) {
      root.innerHTML = '<div class="attendance-empty"><svg><use href="#i-clock"></use></svg><strong>Todavía no hay registros</strong><span>Tu historial de entradas y salidas aparecerá aquí.</span></div>';
      return;
    }
    root.innerHTML = records.map(record => {
      const total = record.entryAt && record.exitAt ? formatDuration(minutesBetween(record.entryAt, record.exitAt)) : 'En curso';
      const status = statusOf(record);
      return `<article class="attendance-history-row">
        <div class="attendance-history-date"><strong>${escapeHtml(formatDate(record.dateKey))}</strong><span class="attendance-status ${status}"><i></i>${escapeHtml(statusLabel(status))}</span></div>
        <div><span>Entrada</span><strong>${escapeHtml(formatTime(record.entryAt))}</strong></div>
        <div><span>Salida</span><strong>${escapeHtml(formatTime(record.exitAt))}</strong></div>
        <div><span>Total</span><strong>${escapeHtml(total)}</strong></div>
        <div class="attendance-history-actions">
          ${record.entryPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.entryPhotoId)}" title="Foto de llegada"><svg><use href="#i-camera"></use></svg></button>` : ''}
          ${record.exitPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.exitPhotoId)}" title="Foto de salida"><svg><use href="#i-camera"></use></svg></button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  function inputTimeValue(value) {
    const date = toDate(value);
    if (!date) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function renderTeam() {
    const adminPanel = $('#attendanceAdminPanel');
    const canSeeTeam = state.profile?.role === 'admin' || state.profile?.role === 'supervisor';
    const isAdmin = state.profile?.role === 'admin';
    if (!adminPanel) return;
    adminPanel.classList.toggle('hidden', !canSeeTeam);
    adminPanel.classList.toggle('can-manage-attendance', isAdmin);
    $$('.attendance-admin-only-column').forEach(node => node.classList.toggle('hidden', !isAdmin));
    if (!canSeeTeam) return;

    const selectedDate = $('#attendanceAdminDate')?.value || dateKeyUruguay();
    const records = state.records.filter(record => record.dateKey === selectedDate);
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
      return `<tr>
        <td data-label="Usuario"><div class="attendance-person-cell"><span>${initials(record.userName)}</span><div><strong>${escapeHtml(record.userName || 'Usuario')}</strong><small>${escapeHtml(record.userEmail || '')}</small>${corrected}</div></div></td>
        <td data-label="Llegada">${escapeHtml(formatTime(record.entryAt))}</td>
        <td data-label="Salida">${escapeHtml(formatTime(record.exitAt))}</td>
        <td data-label="Total">${escapeHtml(total)}</td>
        <td data-label="Estado"><span class="attendance-status ${status}"><i></i>${escapeHtml(statusLabel(status))}</span></td>
        <td data-label="Evidencia"><div class="attendance-table-actions">
          ${record.entryPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.entryPhotoId)}" title="Foto de llegada"><svg><use href="#i-camera"></use></svg></button>` : ''}
          ${record.exitPhotoId ? `<button type="button" data-attendance-photo="${escapeHtml(record.exitPhotoId)}" title="Foto de salida"><svg><use href="#i-camera"></use></svg></button>` : ''}
          ${record.entryGps ? `<a href="${mapUrl(record.entryGps)}" target="_blank" rel="noopener" title="Ubicación de llegada"><svg><use href="#i-pin"></use></svg></a>` : ''}
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
    if (state.profile?.role !== 'admin') return notify('Acceso restringido', 'Solo el administrador puede modificar o eliminar horarios.', 'error');
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
    if (state.profile?.role !== 'admin') return;
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
    if (state.profile?.role !== 'admin') return;
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

  function subscribe() {
    state.unsubscribe?.();
    state.unsubscribe = null;
    if (!state.user || !window.LubaydAttendanceData?.available) return;
    state.unsubscribe = window.LubaydAttendanceData.subscribe(state.profile, function (records, metadata) {
      state.records = records || [];
      state.metadata = metadata || {};
      render();
    }, function (error) {
      console.error('Asistencia:', error);
      notify('No se pudo cargar la asistencia', error?.message || 'Revisa las reglas de Firebase.', 'error');
    });
  }

  function updateCameraState(kind, title, text, className) {
    const node = $('#attendanceCameraState');
    if (!node) return;
    node.className = `camera-state ${className || ''}`;
    node.innerHTML = `<span class="camera-state-icon"><svg><use href="#${kind}"></use></svg></span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`;
  }

  async function obtainGps() {
    if (!navigator.geolocation) throw new Error('Este dispositivo no permite obtener la ubicación.');
    updateCameraState('i-pin', 'Obteniendo ubicación', 'Espera mientras validamos la posición actual.', 'loading');
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAtClient: new Date(position.timestamp || Date.now()).toISOString()
        });
      }, error => {
        const messages = {
          1: 'Debes permitir el acceso a la ubicación.',
          2: 'No fue posible determinar la ubicación.',
          3: 'La ubicación tardó demasiado. Intenta nuevamente al aire libre.'
        };
        reject(new Error(messages[error.code] || 'No se pudo obtener la ubicación.'));
      }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    });
  }

  async function openCamera(mode) {
    if (state.busy) return;
    if (!navigator.onLine) {
      notify('Sin conexión', 'Para registrar asistencia necesitas conexión a internet.', 'error');
      return;
    }
    const record = currentTodayRecord();
    if (mode === 'entry' && record) return notify('Llegada ya registrada', 'Solo se permite una llegada por jornada.', 'error');
    if (mode === 'exit' && !record) return notify('Falta la llegada', 'Primero debes registrar la llegada.', 'error');
    if (mode === 'exit' && (record.exitAt || record.exitPhotoId)) return notify('Salida ya registrada', 'Solo se permite una salida por jornada.', 'error');

    state.cameraMode = mode;
    state.photoBlob = null;
    state.gps = null;
    const modal = $('#attendanceCameraModal');
    const video = $('#attendanceCameraVideo');
    const preview = $('#attendanceCameraPreview');
    const captureBtn = $('#attendanceCaptureBtn');
    const confirmBtn = $('#attendanceConfirmBtn');
    const retakeBtn = $('#attendanceRetakeBtn');
    $('#attendanceCameraTitle').textContent = mode === 'entry' ? 'Registrar llegada' : 'Registrar salida';
    $('#attendanceCameraSubtitle').textContent = 'Foto y ubicación obtenidas en este momento';
    preview?.classList.add('hidden');
    video?.classList.remove('hidden');
    captureBtn?.classList.remove('hidden');
    confirmBtn?.classList.add('hidden');
    retakeBtn?.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
    document.body.classList.add('camera-open');
    updateCameraState('i-camera', 'Preparando cámara', 'Permite el acceso a la cámara frontal.', 'loading');

    try {
      const gpsPromise = obtainGps();
      const stream = await (navigator.mediaDevices?.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }
      }) || Promise.reject(new Error('La cámara no está disponible en este navegador.')));
      state.stream = stream;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      updateCameraState('i-pin', 'Cámara lista · validando GPS', 'Mantén el teléfono estable mientras obtenemos la ubicación.', 'loading');
      const gps = await gpsPromise;
      state.gps = gps;
      const quality = gpsQuality(gps.accuracy);
      updateCameraState('i-check', 'Cámara y GPS listos', `${quality.label} · precisión aproximada ±${Math.round(gps.accuracy)} m`, 'success');
      if (captureBtn) captureBtn.disabled = false;
    } catch (error) {
      stopStream();
      updateCameraState('i-alert', 'No se pudo iniciar', error.message || 'Revisa los permisos del dispositivo.', 'error');
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

  async function confirmMark() {
    if (state.busy || !state.photoBlob || !state.gps) return;
    state.busy = true;
    const button = $('#attendanceConfirmBtn');
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="button-spinner"></span> Guardando...';
    }
    updateCameraState('i-cloud', 'Guardando asistencia', 'Subiendo fotografía y confirmando hora del servidor.', 'loading');
    try {
      await window.LubaydAttendanceData.register(state.cameraMode, {
        dateKey: dateKeyUruguay(),
        blob: state.photoBlob,
        gps: state.gps
      });
      notify(state.cameraMode === 'entry' ? 'Llegada registrada' : 'Salida registrada', 'La foto, el GPS y la hora quedaron guardados correctamente.');
      closeCamera();
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

  async function openPhoto(path) {
    if (!path) return;
    const modal = $('#attendancePhotoModal');
    const image = $('#attendancePhotoImage');
    const loading = $('#attendancePhotoLoading');
    modal?.classList.remove('hidden');
    document.body.classList.add('camera-open');
    image?.classList.add('hidden');
    loading?.classList.remove('hidden');
    try {
      const url = await window.LubaydAttendanceData.getPhotoUrl(path);
      if (image) {
        image.src = url;
        image.classList.remove('hidden');
      }
      loading?.classList.add('hidden');
    } catch (error) {
      loading.innerHTML = `<svg><use href="#i-alert"></use></svg><strong>No se pudo abrir la fotografía</strong><span>${escapeHtml(error.message || 'Revisa las reglas de Firestore.')}</span>`;
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
    $('#attendanceAdminRefresh')?.addEventListener('click', renderTeam);
    $('#attendanceClosePhoto')?.addEventListener('click', closePhoto);
    $('.attendance-photo-backdrop')?.addEventListener('click', closePhoto);
    $('#attendanceAdminEditForm')?.addEventListener('submit', saveAdminAttendance);
    $('#attendanceAdminEditClose')?.addEventListener('click', closeAdminEditor);
    $('#attendanceAdminEditCancel')?.addEventListener('click', closeAdminEditor);
    $('.attendance-admin-edit-backdrop')?.addEventListener('click', closeAdminEditor);
    $('#attendanceAdminDeleteBtn')?.addEventListener('click', () => deleteAdminAttendance());
    document.addEventListener('click', event => {
      const photoButton = event.target.closest('[data-attendance-photo]');
      if (photoButton) return openPhoto(photoButton.dataset.attendancePhoto);
      const editButton = event.target.closest('[data-attendance-edit]');
      if (editButton) return openAdminEditor(editButton.dataset.attendanceEdit);
      const deleteButton = event.target.closest('[data-attendance-delete]');
      if (deleteButton) return openAdminEditor(deleteButton.dataset.attendanceDelete, true);
    });
    window.addEventListener('online', renderPersonal);
    window.addEventListener('offline', renderPersonal);
    window.addEventListener('beforeunload', stopStream);
  }

  function initialize(user, profile) {
    state.user = user;
    state.profile = profile;
    const dateInput = $('#attendanceAdminDate');
    if (dateInput && !dateInput.value) dateInput.value = dateKeyUruguay();
    subscribe();
    render();
    window.clearInterval(state.timer);
    state.timer = window.setInterval(() => {
      if ($('#asistencia')?.classList.contains('active')) renderPersonal();
    }, 30000);
  }

  function show() {
    render();
  }

  bindEvents();
  window.LubaydAttendanceUI = { show, render, openCamera, openAdminEditor };
  window.addEventListener('lubayd-profile-ready', event => initialize(event.detail?.user, event.detail?.profile));
  window.addEventListener('lubayd-auth-changed', event => {
    if (!event.detail?.user) {
      state.unsubscribe?.();
      state.unsubscribe = null;
      state.user = null;
      state.profile = null;
      state.records = [];
      stopStream();
      window.clearInterval(state.timer);
    }
  });
  if (window.LubaydCurrentUser && window.LubaydCurrentProfile) initialize(window.LubaydCurrentUser, window.LubaydCurrentProfile);
})();
