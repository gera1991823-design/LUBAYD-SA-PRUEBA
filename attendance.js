/* Lubayd SA V20.2 - Asistencia móvil */
(function () {
  'use strict';

  const state = {
    user: null,
    profile: null,
    current: null,
    records: [],
    users: [],
    cameraType: null,
    stream: null,
    facingMode: 'user',
    gps: null,
    busy: false
  };

  const $ = selector => document.querySelector(selector);
  const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayKey = () => localDateKey(new Date());
  const isManager = () => ['admin', 'supervisor'].includes(state.profile?.role);
  const db = () => window.LubaydFirebase?.db;
  const FieldValue = () => window.LubaydFirebase?.FieldValue;

  function toast(title, text) {
    if (window.LubaydUI?.toast) window.LubaydUI.toast(title, text);
    else console.info(title, text);
  }

  function timestampDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatTime(value) {
    const date = timestampDate(value);
    return date ? new Intl.DateTimeFormat('es-UY', { hour: '2-digit', minute: '2-digit' }).format(date) : '--:--';
  }

  function formatDate(dateKey) {
    const date = new Date(`${dateKey}T12:00:00`);
    return new Intl.DateTimeFormat('es-UY', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(date);
  }

  function minutesBetween(start, end) {
    const a = timestampDate(start);
    const b = timestampDate(end);
    if (!a || !b) return 0;
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  }

  function durationText(start, end) {
    const total = minutesBetween(start, end);
    return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
  }

  function statusFor(record) {
    if (!record?.entrada?.at) return { text: 'Sin registrar', className: 'neutral' };
    if (!record?.salida?.at) return { text: 'Trabajando', className: 'online' };
    return { text: 'Finalizado', className: 'neutral' };
  }

  function displayName(record) {
    return record?.userName || record?.userEmail || 'Usuario';
  }

  function initials(name) {
    const parts = String(name || 'U').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  async function getGps() {
    if (!navigator.geolocation) throw new Error('Este dispositivo no dispone de ubicación GPS.');
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAtClient: new Date().toISOString()
      }), error => {
        const messages = {
          1: 'Debes permitir el acceso a la ubicación.',
          2: 'No fue posible determinar la ubicación.',
          3: 'La ubicación demoró demasiado.'
        };
        reject(new Error(messages[error.code] || 'No se pudo obtener la ubicación.'));
      }, { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 });
    });
  }

  async function refreshMyAttendance() {
    if (!state.user || !db()) return;
    const id = `${state.user.uid}_${todayKey()}`;
    const snapshot = await db().collection('asistencias').doc(id).get();
    state.current = snapshot.exists ? Object.assign({ id: snapshot.id }, snapshot.data()) : null;
    renderPersonalAttendance();
    window.dispatchEvent(new CustomEvent('lubayd-attendance-updated'));
  }

  async function loadUsers() {
    if (!isManager() || !db()) return [];
    const snapshot = await db().collection('usuarios').get();
    state.users = snapshot.docs.map(doc => Object.assign({ uid: doc.id }, doc.data()))
      .filter(user => user.active !== false)
      .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
    return state.users;
  }

  async function refreshManagerAttendance(options) {
    if (!isManager() || !db()) return;
    const opts = options || {};
    const dateKey = $('#attendanceDateFilter')?.value || todayKey();
    const list = $('#attendanceList');
    const errorBox = $('#attendanceError');
    if (list) {
      list.className = 'attendance-card-list empty-state';
      list.textContent = 'Cargando marcas…';
    }
    errorBox?.classList.add('hidden');
    try {
      const [attendanceSnapshot] = await Promise.all([
        db().collection('asistencias').where('dateKey', '==', dateKey).get(),
        state.users.length ? Promise.resolve(state.users) : loadUsers()
      ]);
      state.records = attendanceSnapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data()))
        .sort((a, b) => displayName(a).localeCompare(displayName(b), 'es'));
      renderManagerAttendance();
      if (!opts.silent) toast('Marcas actualizadas', `Información del ${formatDate(dateKey)}.`);
      window.dispatchEvent(new CustomEvent('lubayd-attendance-updated'));
    } catch (error) {
      console.error('Cargar asistencia:', error);
      if (list) {
        list.className = 'attendance-card-list empty-state';
        list.textContent = 'No fue posible cargar las marcas.';
      }
      if (errorBox) {
        errorBox.textContent = `Error al consultar Firestore: ${error.message || error}`;
        errorBox.classList.remove('hidden');
      }
    }
  }

  function renderPersonalAttendance() {
    const record = state.current;
    const status = statusFor(record);
    if ($('#myAttendanceDate')) $('#myAttendanceDate').textContent = formatDate(todayKey());
    if ($('#myAttendanceStatus')) {
      $('#myAttendanceStatus').textContent = status.text;
      $('#myAttendanceStatus').className = `status-pill ${status.className}`;
    }
    if ($('#myEntryTime')) $('#myEntryTime').textContent = formatTime(record?.entrada?.at);
    if ($('#myExitTime')) $('#myExitTime').textContent = formatTime(record?.salida?.at);
    if ($('#myTotalTime')) $('#myTotalTime').textContent = record?.salida?.at ? durationText(record.entrada.at, record.salida.at) : '0 h 00 min';
    if ($('#myEntryMeta')) $('#myEntryMeta').textContent = record?.entrada?.gps ? `GPS ±${Math.round(record.entrada.gps.accuracy || 0)} m` : 'Pendiente';
    if ($('#myExitMeta')) $('#myExitMeta').textContent = record?.salida?.gps ? `GPS ±${Math.round(record.salida.gps.accuracy || 0)} m` : 'Pendiente';
    if ($('#registerEntryButton')) $('#registerEntryButton').disabled = Boolean(record?.entrada?.at) || state.busy;
    if ($('#registerExitButton')) $('#registerExitButton').disabled = !record?.entrada?.at || Boolean(record?.salida?.at) || state.busy;
  }

  function renderManagerAttendance() {
    const dateKey = $('#attendanceDateFilter')?.value || todayKey();
    const query = String($('#attendanceSearch')?.value || '').trim().toLowerCase();
    const byUser = new Map(state.records.map(record => [record.userId, record]));
    const rows = state.users.map(user => byUser.get(user.uid) || {
      id: '',
      userId: user.uid,
      userName: user.nombre || user.email || 'Usuario',
      userEmail: user.email || '',
      dateKey,
      entrada: null,
      salida: null,
      missing: true
    });
    state.records.forEach(record => {
      if (!state.users.some(user => user.uid === record.userId)) rows.push(record);
    });
    const filtered = rows.filter(record => {
      const haystack = `${record.userName || ''} ${record.userEmail || ''}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    const present = state.records.filter(record => record.entrada?.at).length;
    const working = state.records.filter(record => record.entrada?.at && !record.salida?.at).length;
    const finished = state.records.filter(record => record.salida?.at).length;
    const missing = Math.max(0, state.users.length - present);
    if ($('#summaryPresent')) $('#summaryPresent').textContent = present;
    if ($('#summaryWorking')) $('#summaryWorking').textContent = working;
    if ($('#summaryFinished')) $('#summaryFinished').textContent = finished;
    if ($('#summaryMissing')) $('#summaryMissing').textContent = missing;

    const list = $('#attendanceList');
    if (!list) return;
    if (!filtered.length) {
      list.className = 'attendance-card-list empty-state';
      list.textContent = `No hay marcas para ${formatDate(dateKey)}.`;
      return;
    }
    list.className = 'attendance-card-list';
    list.innerHTML = filtered.map(record => {
      const status = statusFor(record);
      return `<article class="attendance-card" data-attendance-id="${escapeHtml(record.id)}">
        <header><div><h3>${escapeHtml(displayName(record))}</h3><div class="email">${escapeHtml(record.userEmail || '')}</div></div><span class="status-pill ${status.className}">${status.text}</span></header>
        <div class="time-row"><div><span>Entrada</span><strong>${formatTime(record.entrada?.at)}</strong><small>${record.entrada?.gps ? `GPS ±${Math.round(record.entrada.gps.accuracy || 0)} m` : 'Sin GPS'}</small></div><div><span>Salida</span><strong>${formatTime(record.salida?.at)}</strong><small>${record.salida?.gps ? `GPS ±${Math.round(record.salida.gps.accuracy || 0)} m` : 'Pendiente'}</small></div><div><span>Total</span><strong>${record.missing ? 'Sin jornada' : (record.salida?.at ? durationText(record.entrada?.at, record.salida?.at) : 'En curso')}</strong><small>${escapeHtml(record.dateKey || '')}</small></div></div>
        <footer>${record.missing ? '<span class="inline-notice">Aún no registró llegada</span>' : `<button class="secondary-button" data-action="detail">Ver detalle</button>${state.profile?.role === 'admin' ? '<button class="secondary-button" data-action="edit">Editar</button><button class="danger-button" data-action="delete">Eliminar</button>' : ''}`}</footer>
      </article>`;
    }).join('');
  }

  async function openCamera(type) {
    if (state.busy) return;
    state.cameraType = type;
    state.gps = null;
    $('#cameraTitle').textContent = type === 'entrada' ? 'Registrar llegada' : 'Registrar salida';
    $('#cameraInstruction').textContent = type === 'entrada' ? 'Mira a la cámara para registrar tu llegada.' : 'Mira a la cámara para registrar tu salida.';
    $('#cameraGpsState').textContent = 'Obteniendo ubicación precisa…';
    $('#cameraModal').classList.remove('hidden');
    try {
      await startCamera();
      state.gps = await getGps();
      $('#cameraGpsState').textContent = `Ubicación lista · precisión aproximada ±${Math.round(state.gps.accuracy || 0)} metros.`;
    } catch (error) {
      $('#cameraGpsState').textContent = error.message || String(error);
      toast('No se pudo preparar la marca', error.message || String(error));
    }
  }

  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara no está disponible en este navegador.');
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    $('#cameraVideo').srcObject = state.stream;
    await $('#cameraVideo').play();
  }

  function stopCamera() {
    state.stream?.getTracks?.().forEach(track => track.stop());
    state.stream = null;
    if ($('#cameraVideo')) $('#cameraVideo').srcObject = null;
  }

  function closeCamera() {
    stopCamera();
    state.cameraType = null;
    state.gps = null;
    $('#cameraModal')?.classList.add('hidden');
  }

  function capturePhoto() {
    const video = $('#cameraVideo');
    const canvas = $('#cameraCanvas');
    if (!video?.videoWidth) throw new Error('La cámara todavía no está lista.');
    const maxWidth = 600;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (state.facingMode === 'user') {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.62);
  }

  async function registerAttendance() {
    if (state.busy) return;
    if (!state.user || !state.profile) return toast('Sesión requerida', 'Vuelve a iniciar sesión.');
    if (!state.gps) return toast('Ubicación pendiente', 'Espera a que la ubicación quede lista.');
    state.busy = true;
    renderPersonalAttendance();
    $('#captureAttendanceButton').disabled = true;
    $('#captureAttendanceButton').textContent = 'Registrando…';
    const type = state.cameraType;
    const dateKey = todayKey();
    const attendanceId = `${state.user.uid}_${dateKey}`;
    try {
      const photoData = capturePhoto();
      const photoRef = db().collection('asistencia_fotos').doc();
      const attendanceRef = db().collection('asistencias').doc(attendanceId);
      const snapshot = await attendanceRef.get();
      const existing = snapshot.exists ? snapshot.data() : null;
      if (type === 'entrada' && existing?.entrada?.at) throw new Error('La llegada de hoy ya está registrada.');
      if (type === 'salida' && !existing?.entrada?.at) throw new Error('Primero debes registrar la llegada.');
      if (type === 'salida' && existing?.salida?.at) throw new Error('La salida de hoy ya está registrada.');

      await photoRef.set({
        attendanceId,
        userId: state.user.uid,
        type,
        dataUrl: photoData,
        createdAt: FieldValue().serverTimestamp(),
        createdAtClient: new Date().toISOString()
      });

      const mark = {
        at: FieldValue().serverTimestamp(),
        atClient: new Date().toISOString(),
        photoId: photoRef.id,
        gps: Object.assign({}, state.gps),
        device: navigator.userAgent.slice(0, 300)
      };

      if (type === 'entrada') {
        await attendanceRef.set({
          userId: state.user.uid,
          userName: state.profile.nombre || state.user.displayName || state.user.email,
          userEmail: state.user.email || '',
          dateKey,
          entrada: mark,
          salida: null,
          createdAt: FieldValue().serverTimestamp(),
          updatedAt: FieldValue().serverTimestamp()
        });
      } else {
        await attendanceRef.update({ salida: mark, updatedAt: FieldValue().serverTimestamp() });
      }
      closeCamera();
      await refreshMyAttendance();
      if (isManager()) await refreshManagerAttendance({ silent: true });
      toast(type === 'entrada' ? 'Llegada registrada' : 'Salida registrada', `Hora confirmada por Firebase: ${formatTime(type === 'entrada' ? state.current?.entrada?.at : state.current?.salida?.at)}.`);
    } catch (error) {
      console.error('Registrar asistencia:', error);
      toast('No se pudo registrar', error.message || String(error));
    } finally {
      state.busy = false;
      $('#captureAttendanceButton').disabled = false;
      $('#captureAttendanceButton').textContent = 'Tomar foto y registrar';
      renderPersonalAttendance();
    }
  }

  async function showDetail(record) {
    const detail = $('#detailContent');
    $('#detailModal').classList.remove('hidden');
    detail.innerHTML = '<div class="empty-state">Cargando detalle…</div>';
    try {
      const photoIds = [record.entrada?.photoId, record.salida?.photoId].filter(Boolean);
      const photos = await Promise.all(photoIds.map(id => db().collection('asistencia_fotos').doc(id).get()));
      const photoMap = Object.fromEntries(photos.filter(s => s.exists).map(s => [s.id, s.data().dataUrl]));
      const gpsLinks = ['entrada', 'salida'].map(type => {
        const gps = record[type]?.gps;
        return gps ? `https://www.google.com/maps?q=${gps.latitude},${gps.longitude}` : '';
      });
      detail.innerHTML = `<div class="detail-grid">
        <article><span>Operador</span><strong>${escapeHtml(displayName(record))}</strong></article>
        <article><span>Fecha</span><strong>${escapeHtml(formatDate(record.dateKey))}</strong></article>
        <article><span>Entrada</span><strong>${formatTime(record.entrada?.at)}</strong>${gpsLinks[0] ? `<a href="${gpsLinks[0]}" target="_blank" rel="noopener">Abrir ubicación</a>` : ''}</article>
        <article><span>Salida</span><strong>${formatTime(record.salida?.at)}</strong>${gpsLinks[1] ? `<a href="${gpsLinks[1]}" target="_blank" rel="noopener">Abrir ubicación</a>` : ''}</article>
        <article><span>Duración</span><strong>${record.salida?.at ? durationText(record.entrada?.at, record.salida?.at) : 'Jornada en curso'}</strong></article>
        <article><span>Estado</span><strong>${statusFor(record).text}</strong></article>
      </div><div class="detail-photo-grid"><div><strong>Foto de entrada</strong>${photoMap[record.entrada?.photoId] ? `<img src="${photoMap[record.entrada.photoId]}" alt="Foto de entrada">` : '<div class="empty-state">Sin foto</div>'}</div><div><strong>Foto de salida</strong>${photoMap[record.salida?.photoId] ? `<img src="${photoMap[record.salida.photoId]}" alt="Foto de salida">` : '<div class="empty-state">Sin foto</div>'}</div></div>`;
    } catch (error) {
      detail.innerHTML = `<div class="error-banner">${escapeHtml(error.message || error)}</div>`;
    }
  }

  async function editRecord(record) {
    if (state.profile?.role !== 'admin') return;
    const entryDefault = formatTime(record.entrada?.at).replace('.', ':');
    const exitDefault = record.salida?.at ? formatTime(record.salida.at).replace('.', ':') : '';
    const entry = prompt('Nueva hora de entrada (HH:MM)', entryDefault);
    if (entry === null) return;
    const exit = prompt('Nueva hora de salida (HH:MM). Déjalo vacío para mantenerla pendiente.', exitDefault);
    if (exit === null) return;
    const reason = prompt('Motivo obligatorio de la corrección');
    if (!reason?.trim()) return toast('Motivo requerido', 'La modificación no fue realizada.');
    try {
      const timestamp = time => {
        if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`Hora inválida: ${time}`);
        const date = new Date(`${record.dateKey}T${time}:00`);
        if (Number.isNaN(date.getTime())) throw new Error(`Hora inválida: ${time}`);
        return firebase.firestore.Timestamp.fromDate(date);
      };
      const updates = { 'entrada.at': timestamp(entry), updatedAt: FieldValue().serverTimestamp() };
      if (exit.trim()) updates['salida.at'] = timestamp(exit.trim());
      await db().collection('asistencias').doc(record.id).update(updates);
      await db().collection('asistencia_auditoria').add({
        attendanceId: record.id,
        action: 'edit',
        reason: reason.trim(),
        before: { entry: record.entrada?.at || null, exit: record.salida?.at || null },
        after: { entry, exit: exit.trim() || null },
        adminId: state.user.uid,
        adminEmail: state.user.email || '',
        createdAt: FieldValue().serverTimestamp()
      });
      await refreshManagerAttendance({ silent: true });
      toast('Marca corregida', 'La modificación quedó registrada en auditoría.');
    } catch (error) {
      toast('No se pudo editar', error.message || String(error));
    }
  }

  async function deleteRecord(record) {
    if (state.profile?.role !== 'admin') return;
    if (!confirm(`¿Eliminar completamente la marca de ${displayName(record)}?`)) return;
    const reason = prompt('Motivo obligatorio de la eliminación');
    if (!reason?.trim()) return toast('Motivo requerido', 'La eliminación no fue realizada.');
    try {
      const batch = db().batch();
      batch.delete(db().collection('asistencias').doc(record.id));
      [record.entrada?.photoId, record.salida?.photoId].filter(Boolean).forEach(id => batch.delete(db().collection('asistencia_fotos').doc(id)));
      const auditRef = db().collection('asistencia_auditoria').doc();
      batch.set(auditRef, {
        attendanceId: record.id,
        action: 'delete',
        reason: reason.trim(),
        snapshot: {
          userId: record.userId,
          userName: record.userName || '',
          userEmail: record.userEmail || '',
          dateKey: record.dateKey,
          entryClient: record.entrada?.atClient || '',
          exitClient: record.salida?.atClient || ''
        },
        adminId: state.user.uid,
        adminEmail: state.user.email || '',
        createdAt: FieldValue().serverTimestamp()
      });
      await batch.commit();
      await refreshManagerAttendance({ silent: true });
      toast('Marca eliminada', 'La eliminación quedó registrada en auditoría.');
    } catch (error) {
      toast('No se pudo eliminar', error.message || String(error));
    }
  }

  function bindEvents() {
    $('#registerEntryButton')?.addEventListener('click', () => openCamera('entrada'));
    $('#registerExitButton')?.addEventListener('click', () => openCamera('salida'));
    $('#closeCameraButton')?.addEventListener('click', closeCamera);
    $('#captureAttendanceButton')?.addEventListener('click', registerAttendance);
    $('#switchCameraButton')?.addEventListener('click', async () => {
      state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
      try { await startCamera(); } catch (error) { toast('Cámara', error.message || String(error)); }
    });
    $('#refreshAttendanceButton')?.addEventListener('click', async () => {
      await refreshMyAttendance();
      if (isManager()) await refreshManagerAttendance();
      else toast('Marca actualizada', 'Tu jornada está sincronizada.');
    });
    $('#attendanceDateFilter')?.addEventListener('change', () => refreshManagerAttendance({ silent: true }));
    $('#attendanceSearch')?.addEventListener('input', renderManagerAttendance);
    $('#todayButton')?.addEventListener('click', () => {
      $('#attendanceDateFilter').value = todayKey();
      refreshManagerAttendance({ silent: true });
    });
    $('#previousDateButton')?.addEventListener('click', () => shiftDate(-1));
    $('#nextDateButton')?.addEventListener('click', () => shiftDate(1));
    $('#attendanceList')?.addEventListener('click', event => {
      const card = event.target.closest('[data-attendance-id]');
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!card || !action) return;
      const record = state.records.find(item => item.id === card.dataset.attendanceId);
      if (!record) return;
      if (action === 'detail') showDetail(record);
      if (action === 'edit') editRecord(record);
      if (action === 'delete') deleteRecord(record);
    });
    $('#closeDetailButton')?.addEventListener('click', () => $('#detailModal').classList.add('hidden'));
  }

  function shiftDate(days) {
    const input = $('#attendanceDateFilter');
    const date = new Date(`${input.value || todayKey()}T12:00:00`);
    date.setDate(date.getDate() + days);
    input.value = localDateKey(date);
    refreshManagerAttendance({ silent: true });
  }

  async function initialize(user, profile) {
    state.user = user;
    state.profile = profile;
    state.current = null;
    state.records = [];
    state.users = [];
    if ($('#attendanceDateFilter')) $('#attendanceDateFilter').value = todayKey();
    renderPersonalAttendance();
    await refreshMyAttendance();
    if (isManager()) {
      await loadUsers();
      await refreshManagerAttendance({ silent: true });
    }
  }

  function reset() {
    stopCamera();
    state.user = null;
    state.profile = null;
    state.current = null;
    state.records = [];
    state.users = [];
  }

  bindEvents();
  window.addEventListener('lubayd-auth-ready', event => initialize(event.detail.user, event.detail.profile));
  window.addEventListener('lubayd-signed-out', reset);
  window.addEventListener('beforeunload', stopCamera);

  window.LubaydAttendance = {
    refreshMyAttendance,
    refreshManagerAttendance,
    getCurrent: () => state.current,
    getRecords: () => state.records.slice(),
    isManager
  };
})();
