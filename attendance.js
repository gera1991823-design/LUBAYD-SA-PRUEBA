/* Lubayd SA V20.5.1 - asistencia diseño V20.1, horarios Uruguay y cola offline */
(function () {
  'use strict';

  const VERSION = '20.5.1';
  const TIME_ZONE = 'America/Montevideo';
  const state = {
    user: null,
    profile: null,
    offlineSession: false,
    current: null,
    records: [],
    users: [],
    cameraType: null,
    stream: null,
    facingMode: 'user',
    gps: null,
    busy: false,
    syncing: false
  };

  const $ = selector => document.querySelector(selector);
  const db = () => window.LubaydFirebase?.db;
  const FieldValue = () => window.LubaydFirebase?.FieldValue;
  const isManager = () => ['admin', 'supervisor'].includes(state.profile?.role);
  const isAdmin = () => state.profile?.role === 'admin';
  const canRegister = () => state.profile?.role === 'operador';
  const hasOnlineFirebaseSession = () => Boolean(
    navigator.onLine &&
    !state.offlineSession &&
    window.firebase?.auth?.().currentUser?.uid &&
    window.firebase.auth().currentUser.uid === state.user?.uid
  );

  function toast(title, text) {
    window.LubaydUI?.toast?.(title, text);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function timestampDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value.seconds != null) return new Date(Number(value.seconds) * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function zonedParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  }

  function dateKeyInUruguay(date = new Date()) {
    const parts = zonedParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function formatTime(value) {
    const date = timestampDate(value);
    return date ? new Intl.DateTimeFormat('es-UY', {
      timeZone: TIME_ZONE,
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date) : '--:--';
  }

  function formatDate(dateKey) {
    if (!dateKey) return '—';
    const date = new Date(`${dateKey}T12:00:00Z`);
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    }).format(date);
  }

  function getZoneOffsetMilliseconds(date) {
    const parts = zonedParts(date);
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    return asUtc - date.getTime();
  }

  function uruguayWallTimeToDate(dateKey, timeText) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(timeText)) {
      throw new Error('La hora debe tener el formato HH:MM.');
    }
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hour, minute] = timeText.split(':').map(Number);
    if (hour > 23 || minute > 59) throw new Error('La hora ingresada no es válida.');
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    let result = new Date(utcGuess.getTime() - getZoneOffsetMilliseconds(utcGuess));
    const secondOffset = getZoneOffsetMilliseconds(result);
    result = new Date(utcGuess.getTime() - secondOffset);
    return result;
  }

  function minutesBetween(start, end) {
    const startDate = timestampDate(start);
    const endDate = timestampDate(end);
    if (!startDate || !endDate) return 0;
    return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  }

  function durationText(start, end) {
    const minutes = minutesBetween(start, end);
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  }

  function statusFor(record) {
    if (!record?.entrada?.at) return { text: 'Sin registrar', className: 'neutral' };
    if (!record?.salida?.at) return { text: 'Trabajando', className: 'online' };
    return { text: 'Finalizado', className: 'neutral' };
  }

  function syncStatusFor(record) {
    const statuses = [record?.entrada?.syncStatus, record?.salida?.syncStatus].filter(Boolean);
    if (statuses.includes('error')) return 'error';
    if (statuses.some(status => status !== 'synced')) return 'pending';
    return 'synced';
  }

  function displayName(record) {
    return record?.userName || record?.userEmail || 'Usuario';
  }

  function deviceDescription() {
    const platform = /iPad|iPhone|iPod/i.test(navigator.userAgent) ? 'iOS' : /Android/i.test(navigator.userAgent) ? 'Android' : 'Web';
    return `${platform} · ${String(navigator.userAgent || '').slice(0, 160)}`;
  }

  function clientMutationId(type) {
    return `${state.user.uid}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function getGps() {
    if (!navigator.geolocation) throw new Error('Este dispositivo no dispone de ubicación GPS.');
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAtClient: nowIso()
      }), error => {
        const messages = {
          1: 'Debes permitir el acceso a la ubicación.',
          2: 'No fue posible determinar la ubicación.',
          3: 'La ubicación demoró demasiado.'
        };
        reject(new Error(messages[error.code] || 'No se pudo obtener la ubicación.'));
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  function normalizeRemoteRecord(snapshot) {
    if (!snapshot?.exists) return null;
    const raw = Object.assign({ id: snapshot.id }, snapshot.data());
    ['entrada', 'salida'].forEach(type => {
      if (!raw[type]) return;
      raw[type] = Object.assign({}, raw[type], { syncStatus: 'synced', syncError: '' });
    });
    return raw;
  }

  async function refreshMyAttendance() {
    if (!state.user?.uid || !window.LubaydOffline?.available) return;
    const attendanceId = `${state.user.uid}_${dateKeyInUruguay()}`;
    let local = await window.LubaydOffline.getAttendance(attendanceId);
    state.current = local || null;
    renderPersonalAttendance();

    if (hasOnlineFirebaseSession() && db()) {
      try {
        const snapshot = await db().collection('asistencias').doc(attendanceId).get();
        if (snapshot.exists) {
          const remote = normalizeRemoteRecord(snapshot);
          local = await window.LubaydOffline.mergeRemoteAttendance(remote);
          state.current = local;
        }
      } catch (error) {
        console.warn('Consultar marca personal:', error);
      }
    }

    renderPersonalAttendance();
    await updateSyncState();
    window.dispatchEvent(new CustomEvent('lubayd-attendance-updated'));
  }

  async function loadUsers() {
    if (!isManager()) return [];
    if (state.offlineSession || !db()) {
      const profiles = await window.LubaydOffline.listProfiles({ onlyWithPin: false }).catch(() => []);
      state.users = profiles.filter(profile => profile.active !== false);
      return state.users;
    }
    try {
      const snapshot = await db().collection('usuarios').get();
      state.users = snapshot.docs.map(doc => Object.assign({ uid: doc.id }, doc.data()))
        .filter(user => user.active !== false)
        .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
    } catch (error) {
      const profiles = await window.LubaydOffline.listProfiles({ onlyWithPin: false }).catch(() => []);
      state.users = profiles.filter(profile => profile.active !== false);
      if (!state.users.length) throw error;
    }
    return state.users;
  }

  async function refreshManagerAttendance(options) {
    if (!isManager()) return;
    const opts = options || {};
    const dateKey = $('#attendanceDateFilter')?.value || dateKeyInUruguay();
    const list = $('#attendanceList');
    const errorBox = $('#attendanceError');
    list.className = 'attendance-card-list empty-state';
    list.textContent = 'Cargando marcas…';
    errorBox?.classList.add('hidden');

    try {
      if (!state.users.length) await loadUsers();
      let remoteRecords = [];
      if (!state.offlineSession && db()) {
        const snapshot = await db().collection('asistencias').where('dateKey', '==', dateKey).get();
        remoteRecords = snapshot.docs.map(normalizeRemoteRecord);
        await Promise.all(remoteRecords.map(record => window.LubaydOffline.mergeRemoteAttendance(record)));
      }
      const localRecords = await window.LubaydOffline.listAttendance(dateKey);
      const recordsById = new Map(localRecords.map(record => [record.id, record]));
      remoteRecords.forEach(record => recordsById.set(record.id, record));
      state.records = Array.from(recordsById.values()).sort((a, b) => displayName(a).localeCompare(displayName(b), 'es'));
      renderManagerAttendance();
      if (!opts.silent) toast('Marcas actualizadas', `Información del ${formatDate(dateKey)}.`);
      window.dispatchEvent(new CustomEvent('lubayd-attendance-updated'));
    } catch (error) {
      console.error('Cargar asistencia:', error);
      const localRecords = await window.LubaydOffline.listAttendance(dateKey).catch(() => []);
      state.records = localRecords;
      renderManagerAttendance();
      if (errorBox) {
        errorBox.textContent = localRecords.length
          ? 'Sin conexión con Firebase. Se muestran únicamente datos disponibles en este dispositivo.'
          : `No fue posible cargar las marcas: ${error.message || error}`;
        errorBox.classList.remove('hidden');
      }
    }
  }

  async function updateSyncState() {
    const box = $('#attendanceSyncState');
    const syncButton = $('#syncAttendanceButton');
    if (!box || !state.user?.uid) return;
    const items = await window.LubaydOffline.listQueue({ userId: state.user.uid, statuses: ['pending', 'syncing', 'error'] }).catch(() => []);
    const errors = items.filter(item => item.status === 'error');
    box.className = `sync-state ${errors.length ? 'error' : items.length ? 'pending' : 'synced'}`;
    box.innerHTML = errors.length
      ? `<span></span><div><strong>${errors.length} marca(s) con error</strong><small>Conéctate y pulsa “Sincronizar ahora” para reintentar.</small></div>`
      : items.length
        ? `<span></span><div><strong>${items.length} marca(s) pendiente(s)</strong><small>Guardadas en este teléfono. Se enviarán cuando vuelva internet.</small></div>`
        : '<span></span><div><strong>Todo sincronizado</strong><small>Las marcas ya están disponibles para administración.</small></div>';
    if (syncButton) {
      syncButton.disabled = state.syncing || !items.length || !hasOnlineFirebaseSession();
      syncButton.textContent = state.syncing ? 'Sincronizando…' : `Sincronizar ahora${items.length ? ` (${items.length})` : ''}`;
    }
    const bannerCount = $('#offlineSessionPending');
    if (bannerCount) bannerCount.textContent = `${items.length} pendiente(s)`;
    window.LubaydApp?.updateOfflineReadiness?.();
  }

  function updateRolePanels() {
    const personalPanel = $('#myAttendancePanel');
    const managerInfo = $('#managerInfoPanel');
    const managerPanel = $('#managerAttendancePanel');
    const description = $('#attendanceRoleDescription');
    personalPanel?.classList.toggle('hidden', !canRegister());
    managerInfo?.classList.toggle('hidden', !isManager());
    managerPanel?.classList.toggle('hidden', !isManager());
    if (description) {
      description.textContent = isAdmin()
        ? 'Visualiza, corrige horarios o elimina registros. El administrador no realiza marcas.'
        : state.profile?.role === 'supervisor'
          ? 'Visualiza las marcas del equipo. El supervisor no realiza ni modifica marcas.'
          : 'Registra tu entrada y salida con foto, GPS y hora de Uruguay.';
    }
  }

  function renderPersonalAttendance() {
    updateRolePanels();
    if (!canRegister()) return;
    const record = state.current;
    const status = statusFor(record);
    $('#myAttendanceDate').textContent = formatDate(dateKeyInUruguay());
    $('#myAttendanceStatus').textContent = status.text;
    $('#myAttendanceStatus').className = `status-pill ${status.className}`;
    $('#myEntryTime').textContent = formatTime(record?.entrada?.at);
    $('#myExitTime').textContent = formatTime(record?.salida?.at);
    $('#myTotalTime').textContent = record?.salida?.at ? durationText(record.entrada.at, record.salida.at) : '0 h 00 min';
    $('#myEntryMeta').textContent = markMeta(record?.entrada, 'Pendiente');
    $('#myExitMeta').textContent = markMeta(record?.salida, 'Pendiente');
    $('#registerEntryButton').disabled = Boolean(record?.entrada?.at) || state.busy;
    $('#registerExitButton').disabled = !record?.entrada?.at || Boolean(record?.salida?.at) || state.busy;
  }

  function markMeta(mark, fallback) {
    if (!mark?.at) return fallback;
    const gps = mark.gps ? `GPS ±${Math.round(mark.gps.accuracy || 0)} m` : 'Sin GPS';
    if (mark.syncStatus === 'error') return `${gps} · Error de sincronización`;
    if (mark.syncStatus && mark.syncStatus !== 'synced') return `${gps} · Pendiente de sincronización`;
    return `${gps} · Sincronizada`;
  }

  function renderManagerAttendance() {
    const dateKey = $('#attendanceDateFilter')?.value || dateKeyInUruguay();
    const query = String($('#attendanceSearch')?.value || '').trim().toLowerCase();
    const byUser = new Map(state.records.map(record => [record.userId, record]));
    const rows = state.users.map(user => byUser.get(user.uid) || {
      id: '', userId: user.uid, userName: user.nombre || user.email || 'Usuario',
      userEmail: user.email || '', dateKey, entrada: null, salida: null, missing: true
    });
    state.records.forEach(record => {
      if (!state.users.some(user => user.uid === record.userId)) rows.push(record);
    });
    const filtered = rows.filter(record => `${record.userName || ''} ${record.userEmail || ''}`.toLowerCase().includes(query));
    const present = state.records.filter(record => record.entrada?.at).length;
    const working = state.records.filter(record => record.entrada?.at && !record.salida?.at).length;
    const finished = state.records.filter(record => record.salida?.at).length;
    const missing = Math.max(0, state.users.length - present);
    $('#summaryPresent').textContent = present;
    $('#summaryWorking').textContent = working;
    $('#summaryFinished').textContent = finished;
    $('#summaryMissing').textContent = missing;

    const list = $('#attendanceList');
    if (!filtered.length) {
      list.className = 'attendance-card-list empty-state';
      list.textContent = `No hay marcas para ${formatDate(dateKey)}.`;
      return;
    }
    list.className = 'attendance-card-list';
    list.innerHTML = filtered.map(record => {
      const status = statusFor(record);
      const syncStatus = syncStatusFor(record);
      const syncLabel = syncStatus === 'synced' ? 'Sincronizada' : syncStatus === 'error' ? 'Error de sincronización' : 'Pendiente en dispositivo';
      return `<article class="attendance-card" data-attendance-id="${escapeHtml(record.id)}">
        <header><div><h3>${escapeHtml(displayName(record))}</h3><div class="email">${escapeHtml(record.userEmail || '')}</div></div><span class="status-pill ${status.className}">${status.text}</span></header>
        <div class="time-row"><div><span>Entrada</span><strong>${formatTime(record.entrada?.at)}</strong><small>${record.entrada?.gps ? `GPS ±${Math.round(record.entrada.gps.accuracy || 0)} m` : 'Sin GPS'}</small></div><div><span>Salida</span><strong>${formatTime(record.salida?.at)}</strong><small>${record.salida?.gps ? `GPS ±${Math.round(record.salida.gps.accuracy || 0)} m` : 'Pendiente'}</small></div><div><span>Total</span><strong>${record.missing ? 'Sin jornada' : record.salida?.at ? durationText(record.entrada?.at, record.salida?.at) : 'En curso'}</strong><small>${syncLabel}</small></div></div>
        <footer>${record.missing ? '<span class="inline-notice">Aún no registró llegada</span>' : `<button class="secondary-button" data-action="detail">Ver detalle</button>${isAdmin() && !state.offlineSession ? '<button class="secondary-button" data-action="edit">Editar horarios</button><button class="danger-button" data-action="delete">Eliminar</button>' : ''}`}</footer>
      </article>`;
    }).join('');
  }

  async function openCamera(type) {
    if (!canRegister()) return toast('Acción no disponible', 'Administradores y supervisores no realizan marcas.');
    if (state.busy) return;
    state.cameraType = type;
    state.gps = null;
    $('#cameraTitle').textContent = type === 'entrada' ? 'Registrar llegada' : 'Registrar salida';
    $('#cameraInstruction').textContent = type === 'entrada' ? 'Tómate una foto para registrar tu llegada.' : 'Tómate una foto para registrar tu salida.';
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
      video: { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false
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
    const maxWidth = 560;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (state.facingMode === 'user') {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.58);
    if (dataUrl.length > 820000) throw new Error('La fotografía quedó demasiado grande. Intenta nuevamente.');
    return dataUrl;
  }

  async function registerAttendance() {
    if (state.busy || !canRegister()) return;
    if (!state.user?.uid || !state.profile) return toast('Sesión requerida', 'Vuelve a iniciar sesión.');
    if (!state.gps) return toast('Ubicación pendiente', 'Espera a que la ubicación quede lista.');
    const type = state.cameraType;
    if (!['entrada', 'salida'].includes(type)) return;

    state.busy = true;
    renderPersonalAttendance();
    $('#captureAttendanceButton').disabled = true;
    $('#captureAttendanceButton').textContent = 'Guardando en el teléfono…';
    try {
      const capturedAt = new Date();
      const dateKey = dateKeyInUruguay(capturedAt);
      const attendanceId = `${state.user.uid}_${dateKey}`;
      const photoId = `${attendanceId}_${type}_${Date.now()}`;
      const mutationId = clientMutationId(type);
      const mark = {
        at: capturedAt.toISOString(),
        atClient: capturedAt.toISOString(),
        photoId,
        gps: state.gps,
        device: deviceDescription(),
        clientMutationId: mutationId,
        offlineCaptured: !hasOnlineFirebaseSession(),
        syncStatus: 'pending',
        syncError: ''
      };
      const photoData = capturePhoto();
      const saved = await window.LubaydOffline.enqueueAttendanceMark({
        attendanceId,
        userId: state.user.uid,
        userName: state.profile.nombre || state.user.displayName || state.user.email || 'Usuario',
        userEmail: state.user.email || state.profile.email || '',
        dateKey,
        type,
        photoId,
        photoData,
        mark
      });
      state.current = saved.record;
      closeCamera();
      renderPersonalAttendance();
      await updateSyncState();
      window.dispatchEvent(new CustomEvent('lubayd-attendance-updated'));

      if (hasOnlineFirebaseSession()) {
        toast(type === 'entrada' ? 'Llegada guardada' : 'Salida guardada', `Hora Uruguay: ${formatTime(capturedAt)}. Sincronizando con Firebase…`);
        await syncPending({ automatic: true });
      } else {
        toast(type === 'entrada' ? 'Llegada guardada sin conexión' : 'Salida guardada sin conexión', `Hora Uruguay: ${formatTime(capturedAt)}. Quedó pendiente en este teléfono.`);
      }
    } catch (error) {
      console.error('Registrar asistencia:', error);
      toast('No se pudo guardar la marca', error.message || String(error));
    } finally {
      state.busy = false;
      $('#captureAttendanceButton').disabled = false;
      $('#captureAttendanceButton').textContent = 'Tomar foto y registrar';
      renderPersonalAttendance();
    }
  }

  function remoteMark(item) {
    const atDate = timestampDate(item.mark.atClient || item.mark.at);
    if (!atDate) throw new Error('La marca local no contiene una hora válida.');
    return {
      at: firebase.firestore.Timestamp.fromDate(atDate),
      atClient: atDate.toISOString(),
      photoId: item.photoId,
      gps: item.mark.gps || null,
      device: item.mark.device || '',
      clientMutationId: item.mark.clientMutationId || '',
      offlineCaptured: Boolean(item.mark.offlineCaptured),
      serverReceivedAt: FieldValue().serverTimestamp()
    };
  }

  async function syncQueueItem(item) {
    await window.LubaydOffline.updateQueueItem(item.id, { status: 'syncing', lastError: '' });
    const attendanceRef = db().collection('asistencias').doc(item.attendanceId);
    const photoRef = db().collection('asistencia_fotos').doc(item.photoId);
    const snapshot = await attendanceRef.get();
    const existing = snapshot.exists ? snapshot.data() : null;
    const existingMark = existing?.[item.type];
    if (existingMark?.clientMutationId === item.mark.clientMutationId || existingMark?.photoId === item.photoId) {
      const remoteRecord = normalizeRemoteRecord(snapshot);
      await window.LubaydOffline.markSynced(item.id, remoteRecord);
      return;
    }
    if (existingMark?.at) throw new Error(item.type === 'entrada' ? 'Ya existe otra llegada para este día.' : 'Ya existe otra salida para este día.');
    if (item.type === 'salida' && !existing?.entrada?.at) throw new Error('La llegada todavía no está sincronizada.');

    const batch = db().batch();
    batch.set(photoRef, {
      attendanceId: item.attendanceId,
      userId: item.userId,
      type: item.type,
      dataUrl: item.photoData,
      createdAt: FieldValue().serverTimestamp(),
      createdAtClient: item.mark.atClient
    });
    const mark = remoteMark(item);
    if (item.type === 'entrada') {
      batch.set(attendanceRef, {
        userId: item.userId,
        userName: item.userName,
        userEmail: item.userEmail,
        dateKey: item.dateKey,
        entrada: mark,
        salida: null,
        createdAt: FieldValue().serverTimestamp(),
        createdAtClient: item.mark.atClient,
        updatedAt: FieldValue().serverTimestamp()
      });
    } else {
      batch.update(attendanceRef, { salida: mark, updatedAt: FieldValue().serverTimestamp() });
    }
    await batch.commit();
    const updatedSnapshot = await attendanceRef.get();
    await window.LubaydOffline.markSynced(item.id, normalizeRemoteRecord(updatedSnapshot));
  }

  async function syncPending(options) {
    const opts = options || {};
    if (state.syncing) return;
    if (!hasOnlineFirebaseSession() || !db()) {
      if (!opts.automatic) toast('Sin conexión', 'Inicia sesión online y recupera internet para sincronizar.');
      await updateSyncState();
      return;
    }
    state.syncing = true;
    await window.LubaydOffline.retryErrors(state.user.uid);
    let items = await window.LubaydOffline.listQueue({ userId: state.user.uid, statuses: ['pending', 'error'] });
    items = items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || (a.type === 'entrada' ? -1 : 1));
    let success = 0;
    let failed = 0;
    await updateSyncState();
    for (const item of items) {
      try {
        await syncQueueItem(item);
        success += 1;
      } catch (error) {
        console.error('Sincronizar marca:', item.id, error);
        await window.LubaydOffline.markError(item.id, error);
        failed += 1;
        if (!navigator.onLine) break;
      }
    }
    state.syncing = false;
    await refreshMyAttendance();
    await updateSyncState();
    if (!opts.automatic || failed) {
      toast(failed ? 'Sincronización incompleta' : 'Sincronización completa', failed ? `${success} enviadas y ${failed} con error.` : `${success} marca(s) enviadas a Firebase.`);
    }
  }

  async function localPhotoMap(record) {
    const result = {};
    for (const type of ['entrada', 'salida']) {
      const photoId = record[type]?.photoId;
      if (!photoId) continue;
      const queueItem = await window.LubaydOffline.getQueueItem(`${record.id}_${type}`).catch(() => null);
      if (queueItem?.photoData) result[photoId] = queueItem.photoData;
    }
    return result;
  }

  async function showDetail(record) {
    const detail = $('#detailContent');
    $('#detailModal').classList.remove('hidden');
    detail.innerHTML = '<div class="empty-state">Cargando detalle…</div>';
    try {
      const photoMap = await localPhotoMap(record);
      if (!state.offlineSession && db()) {
        const missingIds = [record.entrada?.photoId, record.salida?.photoId].filter(id => id && !photoMap[id]);
        const photos = await Promise.all(missingIds.map(id => db().collection('asistencia_fotos').doc(id).get().catch(() => null)));
        photos.filter(snapshot => snapshot?.exists).forEach(snapshot => { photoMap[snapshot.id] = snapshot.data().dataUrl; });
      }
      const gpsLinks = ['entrada', 'salida'].map(type => {
        const gps = record[type]?.gps;
        return gps ? `https://www.google.com/maps?q=${gps.latitude},${gps.longitude}` : '';
      });
      detail.innerHTML = `<div class="detail-grid">
        <article><span>Operador</span><strong>${escapeHtml(displayName(record))}</strong></article>
        <article><span>Fecha</span><strong>${escapeHtml(formatDate(record.dateKey))}</strong></article>
        <article><span>Zona horaria</span><strong>Uruguay</strong></article>
        <article><span>Entrada</span><strong>${formatTime(record.entrada?.at)}</strong>${gpsLinks[0] ? `<a href="${gpsLinks[0]}" target="_blank" rel="noopener">Abrir ubicación</a>` : ''}</article>
        <article><span>Salida</span><strong>${formatTime(record.salida?.at)}</strong>${gpsLinks[1] ? `<a href="${gpsLinks[1]}" target="_blank" rel="noopener">Abrir ubicación</a>` : ''}</article>
        <article><span>Duración</span><strong>${record.salida?.at ? durationText(record.entrada?.at, record.salida?.at) : 'Jornada en curso'}</strong></article>
      </div><div class="detail-photo-grid"><div><strong>Foto de entrada</strong>${photoMap[record.entrada?.photoId] ? `<img src="${photoMap[record.entrada.photoId]}" alt="Foto de entrada">` : '<div class="empty-state">Sin foto disponible</div>'}</div><div><strong>Foto de salida</strong>${photoMap[record.salida?.photoId] ? `<img src="${photoMap[record.salida.photoId]}" alt="Foto de salida">` : '<div class="empty-state">Sin foto disponible</div>'}</div></div>`;
    } catch (error) {
      detail.innerHTML = `<div class="error-banner">${escapeHtml(error.message || error)}</div>`;
    }
  }

  async function editRecord(record) {
    if (!isAdmin() || state.offlineSession) return;
    const entryDefault = formatTime(record.entrada?.at);
    const exitDefault = record.salida?.at ? formatTime(record.salida.at) : '';
    const entryText = prompt('Nueva hora de entrada en horario de Uruguay (HH:MM)', entryDefault);
    if (entryText === null) return;
    const exitText = prompt('Nueva hora de salida en horario de Uruguay (HH:MM). Déjalo vacío para jornada abierta.', exitDefault);
    if (exitText === null) return;
    const reason = prompt('Motivo obligatorio de la corrección');
    if (!reason?.trim()) return toast('Motivo requerido', 'La modificación no fue realizada.');
    try {
      const entryDate = uruguayWallTimeToDate(record.dateKey, entryText.trim());
      const exitDate = exitText.trim() ? uruguayWallTimeToDate(record.dateKey, exitText.trim()) : null;
      if (exitDate && exitDate <= entryDate) throw new Error('La salida debe ser posterior a la entrada.');
      const entry = Object.assign({}, record.entrada, {
        at: firebase.firestore.Timestamp.fromDate(entryDate),
        atClient: entryDate.toISOString(),
        correctedByAdmin: true
      });
      const updates = {
        entrada: entry,
        salida: exitDate ? Object.assign({}, record.salida || {}, {
          at: firebase.firestore.Timestamp.fromDate(exitDate),
          atClient: exitDate.toISOString(),
          correctedByAdmin: true
        }) : null,
        updatedAt: FieldValue().serverTimestamp(),
        correctedAt: FieldValue().serverTimestamp(),
        correctionReason: reason.trim(),
        correctedByUid: state.user.uid,
        correctedByName: state.profile.nombre || state.user.email || 'Administrador'
      };
      await db().collection('asistencias').doc(record.id).update(updates);
      await db().collection('asistencia_auditoria').add({
        attendanceId: record.id,
        action: 'edit',
        reason: reason.trim(),
        before: { entry: record.entrada?.at || null, exit: record.salida?.at || null },
        after: { entry: entryDate.toISOString(), exit: exitDate?.toISOString() || null },
        userId: record.userId,
        dateKey: record.dateKey,
        adminId: state.user.uid,
        adminEmail: state.user.email || '',
        createdAt: FieldValue().serverTimestamp()
      });
      const updated = await db().collection('asistencias').doc(record.id).get();
      await window.LubaydOffline.mergeRemoteAttendance(normalizeRemoteRecord(updated));
      await refreshManagerAttendance({ silent: true });
      toast('Horarios corregidos', 'Se guardaron usando la zona horaria de Uruguay y quedaron registrados en auditoría.');
    } catch (error) {
      toast('No se pudo editar', error.message || String(error));
    }
  }

  async function deleteRecord(record) {
    if (!isAdmin() || state.offlineSession) return;
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
        userId: record.userId,
        dateKey: record.dateKey,
        snapshot: {
          userName: record.userName || '', userEmail: record.userEmail || '',
          entryClient: record.entrada?.atClient || '', exitClient: record.salida?.atClient || ''
        },
        adminId: state.user.uid,
        adminEmail: state.user.email || '',
        createdAt: FieldValue().serverTimestamp()
      });
      await batch.commit();
      await window.LubaydOffline.removeAttendance(record.id).catch(() => null);
      state.records = state.records.filter(item => item.id !== record.id);
      await refreshManagerAttendance({ silent: true });
      toast('Marca eliminada', 'La eliminación quedó registrada en auditoría.');
    } catch (error) {
      toast('No se pudo eliminar', error.message || String(error));
    }
  }

  function shiftDate(days) {
    const input = $('#attendanceDateFilter');
    const [year, month, day] = (input.value || dateKeyInUruguay()).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days, 12));
    input.value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    refreshManagerAttendance({ silent: true });
  }

  function bindEvents() {
    $('#registerEntryButton')?.addEventListener('click', () => openCamera('entrada'));
    $('#registerExitButton')?.addEventListener('click', () => openCamera('salida'));
    $('#syncAttendanceButton')?.addEventListener('click', () => syncPending());
    $('#closeCameraButton')?.addEventListener('click', closeCamera);
    $('#captureAttendanceButton')?.addEventListener('click', registerAttendance);
    $('#switchCameraButton')?.addEventListener('click', async () => {
      state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
      try { await startCamera(); } catch (error) { toast('Cámara', error.message || String(error)); }
    });
    $('#refreshAttendanceButton')?.addEventListener('click', async () => {
      if (canRegister()) await refreshMyAttendance();
      if (isManager()) await refreshManagerAttendance();
      else toast('Asistencia actualizada', 'Se revisaron las marcas del dispositivo y Firebase.');
    });
    $('#attendanceDateFilter')?.addEventListener('change', () => refreshManagerAttendance({ silent: true }));
    $('#attendanceSearch')?.addEventListener('input', renderManagerAttendance);
    $('#todayButton')?.addEventListener('click', () => {
      $('#attendanceDateFilter').value = dateKeyInUruguay();
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
    window.addEventListener('online', () => syncPending({ automatic: true }));
    window.addEventListener('lubayd-offline-state-changed', updateSyncState);
  }

  async function initialize(user, profile, offline) {
    state.user = user;
    state.profile = profile;
    state.offlineSession = Boolean(offline || user?.isOffline || window.LubaydOfflineSession);
    state.current = null;
    state.records = [];
    state.users = [];
    $('#attendanceDateFilter').value = dateKeyInUruguay();
    updateRolePanels();
    if (canRegister()) await refreshMyAttendance();
    if (isManager()) {
      await loadUsers().catch(error => console.warn('Usuarios de asistencia:', error));
      await refreshManagerAttendance({ silent: true });
    }
    await updateSyncState();
    if (canRegister() && hasOnlineFirebaseSession()) syncPending({ automatic: true });
  }

  function reset() {
    stopCamera();
    state.user = null;
    state.profile = null;
    state.offlineSession = false;
    state.current = null;
    state.records = [];
    state.users = [];
  }

  bindEvents();
  window.addEventListener('lubayd-auth-ready', event => initialize(event.detail.user, event.detail.profile, event.detail.offline));
  window.addEventListener('lubayd-signed-out', reset);
  window.addEventListener('beforeunload', stopCamera);

  window.LubaydAttendance = {
    version: VERSION,
    refreshMyAttendance,
    refreshManagerAttendance,
    syncPending,
    getCurrent: () => state.current,
    getRecords: () => state.records.slice(),
    isManager,
    isAdmin,
    canRegister,
    timeZone: TIME_ZONE
  };
})();
