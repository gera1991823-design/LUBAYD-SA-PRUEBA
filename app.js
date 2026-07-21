'use strict';

const STORAGE_KEY = 'lubayd_partes_v3';
const LEGACY_KEYS = ['lubayd_partes_v2', 'lubayd_partes'];
const DRAFT_KEY = 'lubayd_parte_draft_v16';
const TOTAL_STEPS = 5;
const CHECK_IDS = ['agua', 'aceite', 'valvulina', 'giro', 'chequeoGral', 'cabezal', 'grua'];
const CHECK_LABELS = {
  agua: 'Agua',
  aceite: 'Aceite',
  valvulina: 'Valvulina',
  giro: 'Giro',
  chequeoGral: 'Chequeo general',
  cabezal: 'Cabezal',
  grua: 'Grúa'
};
const DRAFT_FIELDS = [
  'monte', 'fecha', 'maquina', 'operador', 'trozaCantidad', 'pulpaCantidad', 'largo',
  'horometroInicio', 'horometroFinal', 'arbolesIniciales', 'arbolesFinales', 'carros',
  'desde1', 'hasta1', 'trabajo1', 'mecanico1', 'observaciones', 'combustible',
  'hidraulico', 'controlado', 'firma', ...CHECK_IDS
];

let step = 1;
let currentGps = null;
let gpsInProgress = false;
let gpsAttemptedThisForm = false;
let signatureData = '';
let signatureStrokes = [];
let activeSignatureStroke = null;
let signatureDrawing = false;
let deferredInstall = null;
let waitingWorker = null;
let cloudUnsubscribe = null;
let draftTimer = null;
let toastTimer = null;
let formInitialized = false;
let authenticatedUser = null;
let authenticatedProfile = null;
let authChangeSequence = 0;
let offlineSession = false;
let offlineProfiles = [];
const SESSION_DURATION_MS = 60 * 60 * 1000;
const NAVIGATION_STATE_KEY = 'lubayd_navigation_v20_8_6';
let sessionExpiresAt = 0;
let sessionTimer = null;
let sessionCountdownTimer = null;
let interactiveAuthIntent = false;
let explicitSignOut = false;
let pendingOfflineCredential = '';
let currentViewId = 'dashboard';
let syncPendingPartsPromise = null;
let periodicSyncTimer = null;
let navigationScrollTimer = null;
let currentCloudStatus = {
  text: 'Conectando…',
  ok: false,
  detail: 'Esperando datos'
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function loadRecords() {
  let raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    for (const key of LEGACY_KEYS) {
      raw = localStorage.getItem(key);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        break;
      }
    }
  }
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('No se pudieron leer los registros locales:', error);
    return [];
  }
}

function sortRecords(records) {
  return [...records].sort((a, b) => String(b.createdAt || b.fecha || '').localeCompare(String(a.createdAt || a.fecha || '')));
}

const state = {
  get records() {
    return sortRecords(loadRecords());
  },
  save(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortRecords(records)));
  },
  updateLocal(recordId, changes) {
    const records = this.records.map(item => item.id === recordId ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item);
    this.save(records);
    renderAll();
    return records.find(item => item.id === recordId) || null;
  },
  async saveRecord(record) {
    const pendingRecord = {
      ...record,
      syncStatus: 'pending',
      syncError: '',
      offlineCaptured: offlineSession || !hasOnlineFirebaseSession(),
      localSavedAt: new Date().toISOString()
    };
    const records = this.records.filter(item => item.id !== pendingRecord.id);
    records.unshift(pendingRecord);
    this.save(records);
    renderAll();

    // Siempre se guarda primero en la cola local. Solo se marca sincronizado
    // después de recibir confirmación real de la Function.
    await enqueuePartForSync(pendingRecord, 'upsert');
    this.updateLocal(pendingRecord.id, { syncStatus: 'pending', syncError: '' });
    setCloudStatus('Pendiente', false, 'Parte guardado en este dispositivo');

    if (hasOnlineFirebaseSession()) {
      setCloudStatus('Sincronizando…', false, 'Enviando el parte al servidor');
      const result = await syncPendingParts({ silent: true }).catch(() => ({ synced: 0, errors: 1 }));
      const saved = this.records.find(item => item.id === pendingRecord.id);
      if (saved?.syncStatus === 'synced' || result?.synced > 0) {
        setCloudStatus('Sincronizado', true, `Actualizado ${formatTime(new Date())}`);
        return { ...pendingRecord, ...saved, syncStatus: 'synced' };
      }
    }

    return pendingRecord;
  },
  async deleteRecord(id) {
    const existing = this.records.find(item => item.id === id);
    if (!existing) return;
    this.save(this.records.filter(item => item.id !== id));
    renderAll();

    const queued = await window.LubaydOffline?.getPartQueueItem?.(id).catch(() => null);
    if (queued?.operation === 'upsert' && existing.syncStatus !== 'synced') {
      await window.LubaydOffline?.removePartQueue?.(id).catch(() => {});
      return;
    }

    await enqueuePartForSync(existing, 'delete');
    setCloudStatus('Pendiente', false, 'Eliminación guardada en este dispositivo');
    if (hasOnlineFirebaseSession()) {
      await syncPendingParts({ silent: true }).catch(() => {});
    }
  }
};

window.AppState = state;
window.escapeHtml = escapeHtml;

function currentUser() {
  return authenticatedUser;
}

function isOfflineSession() {
  return offlineSession;
}

window.LubaydIsOfflineSession = isOfflineSession;


function hasOnlineFirebaseSession() {
  const firebaseUser = window.firebase?.auth?.().currentUser;
  // En algunos Android/MIUI navigator.onLine queda desactualizado. La sesión
  // autenticada es la señal principal; la llamada real decidirá si hay red.
  return Boolean(
    !offlineSession &&
    firebaseUser?.uid &&
    authenticatedUser?.uid &&
    firebaseUser.uid === authenticatedUser.uid
  );
}

async function authorizeCurrentDeviceForOperator(options = {}) {
  if (offlineSession || !hasOnlineFirebaseSession()) return null;
  if (authenticatedProfile?.active !== true || authenticatedProfile?.role !== 'operador') return null;
  if (!window.LubaydOffline?.getDeviceEnrollmentPayload || !window.LubaydOfflineDeviceCloud?.authorizeCurrentUserDevice) return null;
  try {
    const payload = await window.LubaydOffline.getDeviceEnrollmentPayload(`Teléfono de ${userDisplayName()}`);
    const result = await window.LubaydOfflineDeviceCloud.authorizeCurrentUserDevice(payload);
    const allowedUserIds = Array.from(new Set([...(payload.allowedUserIds || []), authenticatedUser.uid]));
    await window.LubaydOffline.markDeviceEnrolled({
      deviceName: payload.deviceName,
      allowedUserIds,
      preparedByUid: authenticatedUser.uid
    });
    if (!options.silent) showToast('Teléfono autorizado', 'Este operador puede trabajar y sincronizar desde este celular.');
    return result;
  } catch (error) {
    console.warn('Autorización automática del teléfono:', error);
    if (!options.silent) showToast('No se pudo autorizar el teléfono', error.message || String(error));
    throw error;
  }
}

window.LubaydAuthorizeCurrentDevice = authorizeCurrentDeviceForOperator;

async function enqueuePartForSync(record, operation = 'upsert') {
  if (!window.LubaydOffline?.enqueuePartOperation) {
    throw new Error('El almacenamiento offline de partes no está disponible.');
  }
  return window.LubaydOffline.enqueuePartOperation({
    operation,
    recordId: record.id,
    userId: record.createdByUid || authenticatedUser?.uid || '',
    record
  });
}

async function syncPendingParts(options = {}) {
  if (syncPendingPartsPromise) return syncPendingPartsPromise;
  syncPendingPartsPromise = (async () => {
    if (!window.LubaydOffline?.listPartQueue || !authenticatedUser?.uid) return { synced: 0, errors: 0 };

    const identity = await window.LubaydOffline.getDeviceIdentity?.().catch(() => null);
    const deviceReady = Boolean(identity?.enrolled && identity.deviceId && identity.deviceToken);
    const onlineUser = window.firebase?.auth?.().currentUser || null;
    const onlineSessionReady = Boolean(!offlineSession && onlineUser?.uid === authenticatedUser.uid);
    if (!deviceReady && !onlineSessionReady) return { synced: 0, errors: 0 };

    // Incluimos "syncing" para recuperar colas que quedaron trabadas por un cierre o recarga.
    const items = await window.LubaydOffline.listPartQueue({
      userId: authenticatedUser.uid,
      statuses: ['pending', 'error', 'syncing']
    });
    let synced = 0;
    let errors = 0;

    for (const item of items) {
      try {
        await window.LubaydOffline.updatePartQueue(item.recordId, { status: 'syncing', lastError: '' });
        let remote = null;
        const sameOnlineOperator = onlineSessionReady && onlineUser.uid === item.userId;

        if (sameOnlineOperator) {
          // La sesión Firebase del propio operador es la vía principal y no depende
          // de cuántos celulares utilice el usuario.
          const idToken = await onlineUser.getIdToken(false);
          // Se confirma contra la Function antes de marcar el parte como sincronizado.
          // Así Android no confunde una escritura local de Firestore con una subida real.
          remote = await window.LubaydOffline.syncPartQueueItemWithDevice(item, identity, { idToken });
        } else {
          // Una sesión iniciada sin conexión puede sincronizar al volver la señal
          // mediante la credencial local que se autorizó en el primer acceso online.
          if (!deviceReady) throw new Error('Conéctate e inicia sesión una vez en este celular para habilitar la sincronización automática.');
          remote = await window.LubaydOffline.syncPartQueueItemWithDevice(item, identity);
        }

        await window.LubaydOffline.markPartSynced(item.recordId);
        if (item.operation === 'upsert') {
          state.updateLocal(item.recordId, {
            ...(remote || {}),
            syncStatus: 'synced',
            syncError: '',
            syncedAtClient: new Date().toISOString()
          });
        }
        synced += 1;
      } catch (error) {
        errors += 1;
        await window.LubaydOffline.markPartError(item.recordId, error).catch(() => {});
        if (item.operation === 'upsert') {
          state.updateLocal(item.recordId, { syncStatus: 'error', syncError: error.message || String(error) });
        }
        if (/network|conexi|offline|fetch|abort|failed to fetch|load failed/i.test(String(error?.message || error))) break;
      }
    }

    renderAll();
    if ($('#historial')?.classList.contains('active')) renderHistory();
    if (!options.silent && (synced || errors)) {
      showToast(errors ? 'Sincronización incompleta' : 'Partes sincronizados', errors ? `${synced} enviados y ${errors} con error.` : `${synced} parte(s) enviados y visibles para administración.`);
    }
    return { synced, errors };
  })();

  try {
    return await syncPendingPartsPromise;
  } finally {
    syncPendingPartsPromise = null;
  }
}
window.LubaydSyncOfflineParts = syncPendingParts;

function userDisplayName(user = currentUser()) {
  if (!user) return 'Usuario';
  return String(authenticatedProfile?.nombre || user.displayName || user.email?.split('@')[0] || 'Usuario').trim();
}

function userInitials(user = currentUser()) {
  const name = userDisplayName(user);
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

function enforceAuthenticatedOperator() {
  const input = $('#operador');
  if (!input) return;
  input.value = currentUser() ? userDisplayName() : '';
  input.readOnly = true;
}

function updateUserInterface(user) {
  const name = userDisplayName(user);
  const email = offlineSession ? 'Sesión offline · datos en este teléfono' : (user?.email || 'Sesión segura');
  const initials = userInitials(user);
  ['#sidebarUserName', '#topbarUserName'].forEach(selector => { if ($(selector)) $(selector).textContent = name; });
  ['#sidebarUserEmail', '#topbarUserEmail'].forEach(selector => { if ($(selector)) $(selector).textContent = email; });
  ['#sidebarAvatar', '#topbarAvatar', '#operatorWelcomeAvatar'].forEach(selector => { if ($(selector)) $(selector).textContent = initials; });
  enforceAuthenticatedOperator();
  updateGreeting();
}

function setAuthMessage(text = '', type = '') {
  const message = $('#authMessage');
  if (!message) return;
  message.textContent = text;
  message.className = `auth-message ${type}`.trim();
}

function setAuthBusy(form, busy, label) {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
  button.disabled = busy;
  button.innerHTML = busy ? `${escapeHtml(label)}…` : button.dataset.originalHtml;
}

function showAuthTab(tab) {
  $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#loginForm')?.classList.toggle('active', tab === 'login');
  $('#registerForm')?.classList.toggle('active', tab === 'register');
  setAuthMessage('');
}

$$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showAuthTab(button.dataset.authTab)));

$('#loginForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  setAuthBusy(form, true, 'Ingresando');
  setAuthMessage('');
  try {
    interactiveAuthIntent = true;
    window.LubaydInteractiveLogin = true;
    pendingOfflineCredential = $('#loginPassword').value;
    await window.LubaydAuth.login($('#loginEmail').value, pendingOfflineCredential);
  } catch (error) {
    interactiveAuthIntent = false;
    window.LubaydInteractiveLogin = false;
    pendingOfflineCredential = '';
    setAuthMessage(window.LubaydAuth?.errorMessage?.(error) || 'No se pudo iniciar sesión.');
  } finally {
    setAuthBusy(form, false, 'Ingresando');
  }
});

$('#registerForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if ($('#registerPassword').value !== $('#registerConfirm').value) {
    setAuthMessage('Las contraseñas no coinciden.');
    $('#registerConfirm').focus();
    return;
  }
  setAuthBusy(form, true, 'Creando usuario');
  setAuthMessage('');
  try {
    interactiveAuthIntent = true;
    window.LubaydInteractiveLogin = true;
    pendingOfflineCredential = $('#registerPassword').value;
    await window.LubaydAuth.register($('#registerName').value, $('#registerEmail').value, pendingOfflineCredential);
  } catch (error) {
    interactiveAuthIntent = false;
    window.LubaydInteractiveLogin = false;
    pendingOfflineCredential = '';
    setAuthMessage(window.LubaydAuth?.errorMessage?.(error) || 'No se pudo crear el usuario.');
  } finally {
    setAuthBusy(form, false, 'Creando usuario');
  }
});

$('#resetPasswordBtn')?.addEventListener('click', async () => {
  const email = $('#loginEmail').value.trim();
  if (!email) {
    setAuthMessage('Escribe tu correo para enviarte el enlace de recuperación.');
    $('#loginEmail').focus();
    return;
  }
  try {
    await window.LubaydAuth.resetPassword(email);
    setAuthMessage('Te enviamos un correo para restablecer la contraseña.', 'success');
  } catch (error) {
    setAuthMessage(window.LubaydAuth?.errorMessage?.(error) || 'No se pudo enviar el correo.');
  }
});


function sessionRemainingText(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateSessionTimerUi() {
  const badge = $('#sessionTimerBadge');
  if (!badge) return;
  const remaining = sessionExpiresAt - Date.now();
  badge.classList.toggle('warning', remaining > 0 && remaining <= 5 * 60 * 1000);
  badge.classList.toggle('hidden', remaining <= 0 || !currentUser());
  if (remaining > 0) badge.innerHTML = `<svg><use href="#i-clock"></use></svg><span>Sesión ${sessionRemainingText(remaining)}</span>`;
}

function stopSessionClock() {
  window.clearTimeout(sessionTimer);
  window.clearInterval(sessionCountdownTimer);
  sessionTimer = null;
  sessionCountdownTimer = null;
  sessionExpiresAt = 0;
  $('#sessionTimerBadge')?.classList.add('hidden');
}

async function expireCurrentSession(message = 'La sesión de una hora finalizó. Vuelve a ingresar.') {
  if (explicitSignOut) return;
  explicitSignOut = true;
  stopSessionClock();
  await window.LubaydOffline?.clearActiveSession?.().catch(() => {});
  if (window.firebase?.auth?.().currentUser) await window.firebase.auth().signOut().catch(() => {});
  offlineSession = false;
  authenticatedUser = null;
  authenticatedProfile = null;
  window.LubaydCurrentUser = null;
  window.LubaydCurrentProfile = null;
  window.LubaydOfflineSession = false;
  document.body.classList.remove('auth-ready', 'offline-session');
  document.body.classList.add('auth-pending');
  window.dispatchEvent(new CustomEvent('lubayd-offline-signed-out'));
  showAuthTab('login');
  setAuthMessage(message);
  await refreshOfflineAccess();
  explicitSignOut = false;
}

function startSessionClock(session) {
  stopSessionClock();
  sessionExpiresAt = new Date(session?.expiresAt || 0).getTime();
  if (!sessionExpiresAt || sessionExpiresAt <= Date.now()) {
    expireCurrentSession();
    return;
  }
  updateSessionTimerUi();
  sessionCountdownTimer = window.setInterval(updateSessionTimerUi, 1000);
  sessionTimer = window.setTimeout(() => expireCurrentSession(), Math.max(0, sessionExpiresAt - Date.now()));
}

async function createOneHourSession(uid, mode) {
  const session = await window.LubaydOffline.createSession(uid, mode, SESSION_DURATION_MS);
  startSessionClock(session);
  return session;
}

async function restoreOfflineSessionIfAvailable() {
  if (currentUser() || !window.LubaydOffline?.available) return false;
  const session = await window.LubaydOffline.getActiveSession().catch(() => null);
  if (!session || session.mode !== 'offline') return false;
  const profile = session.profile;
  const user = { uid: profile.uid, email: profile.email || '', displayName: profile.nombre || '', isOffline: true };
  await activateOfflineSession(user, profile, session);
  return true;
}

function setOfflineLoginMessage(text = '', success = false) {
  const element = $('#offlineLoginMessage');
  if (!element) return;
  element.textContent = text;
  element.className = `auth-message${success ? ' success' : ''}`;
}

let offlineAccessRefreshTimer = null;

async function refreshOfflineAccess(options = {}) {
  const panel = $('#offlineAccessPanel');
  const select = $('#offlineProfileSelect');
  const button = $('#offlineLoginBtn');
  if (!panel || !select) return;

  // El acceso offline siempre debe permanecer visible. Si todavía no hay datos,
  // mostramos el motivo y reintentamos en vez de ocultar el panel.
  panel.classList.remove('hidden');
  clearTimeout(offlineAccessRefreshTimer);

  if (!window.LubaydOffline?.available) {
    offlineProfiles = [];
    select.innerHTML = '<option value="">Almacenamiento offline no disponible</option>';
    select.disabled = true;
    if (button) button.disabled = true;
    setOfflineLoginMessage('Este navegador no permite leer los usuarios offline. Abre la aplicación instalada desde el icono.');
    return;
  }

  try {
    offlineProfiles = await window.LubaydOffline.listProfiles({ onlyWithPin: true, onlyOperators: true });
    if (offlineProfiles.length) {
      const selected = select.value;
      select.innerHTML = offlineProfiles.map(profile => `<option value="${escapeHtml(profile.uid)}">${escapeHtml(profile.nombre || profile.email || 'Usuario')}</option>`).join('');
      if (selected && offlineProfiles.some(profile => profile.uid === selected)) select.value = selected;
      select.disabled = false;
      if (button) button.disabled = false;
      if (!options.silent) setOfflineLoginMessage(`${offlineProfiles.length} usuario(s) disponible(s) en este dispositivo.`, true);
      return;
    }

    select.innerHTML = '<option value="">No hay usuarios preparados en este dispositivo</option>';
    select.disabled = true;
    if (button) button.disabled = true;
    setOfflineLoginMessage(navigator.onLine
      ? 'No hay operadores con PIN guardados en este teléfono. Inicia como administrador y vuelve a prepararlos en Usuarios.'
      : 'Este teléfono no tiene operadores preparados. Necesitarás conexión y acceso de administrador para configurarlos.');

    const attempt = Number(options.attempt || 0);
    if (attempt < 3) {
      offlineAccessRefreshTimer = window.setTimeout(() => refreshOfflineAccess({ silent: true, attempt: attempt + 1 }), 700 * (attempt + 1));
    }
  } catch (error) {
    offlineProfiles = [];
    select.innerHTML = '<option value="">No se pudieron leer los usuarios offline</option>';
    select.disabled = true;
    if (button) button.disabled = true;
    setOfflineLoginMessage(`No se pudo abrir el almacenamiento offline: ${error.message || error}`);
    console.warn('Perfiles offline:', error);
    const attempt = Number(options.attempt || 0);
    if (attempt < 3) {
      offlineAccessRefreshTimer = window.setTimeout(() => refreshOfflineAccess({ silent: true, attempt: attempt + 1 }), 900 * (attempt + 1));
    }
  }
}

async function activateOfflineSession(user, profile, existingSession) {
  offlineSession = true;
  authenticatedUser = user;
  authenticatedProfile = profile;
  window.LubaydCurrentUser = user;
  window.LubaydCurrentProfile = profile;
  window.LubaydOfflineSession = true;
  const session = existingSession || await createOneHourSession(user.uid, 'offline');
  startSessionClock(session);
  document.body.classList.remove('auth-pending', 'auth-restoring');
  document.body.classList.add('auth-ready', 'offline-session');
  updateUserInterface(user);
  setCloudStatus('Modo offline', false, 'Partes y marcas quedan pendientes en este teléfono');
  renderAll();
  updateOfflinePreparationUi();
  window.dispatchEvent(new CustomEvent('lubayd-offline-profile-ready', { detail: { user, profile, offline: true } }));
  restorePreferredView();
}

async function offlineLogin() {
  const uid = $('#offlineProfileSelect')?.value || '';
  const pin = $('#offlinePinInput')?.value || '';
  if (!uid || !pin) return setOfflineLoginMessage('Selecciona un usuario e ingresa su clave offline.');
  const button = $('#offlineLoginBtn');
  if (button) { button.disabled = true; button.innerHTML = 'Verificando…'; }
  setOfflineLoginMessage('');
  try {
    const valid = await window.LubaydOffline.verifyPin(uid, pin);
    if (!valid) throw new Error('Clave offline incorrecta.');
    const profile = await window.LubaydOffline.getProfile(uid);
    if (!profile || profile.active === false) throw new Error('Este usuario no está habilitado para acceso offline.');
    const user = { uid, email: profile.email || '', displayName: profile.nombre || '', isOffline: true };
    if ($('#offlinePinInput')) $('#offlinePinInput').value = '';
    await activateOfflineSession(user, profile);
  } catch (error) {
    setOfflineLoginMessage(error.message || String(error));
  } finally {
    if (button) { button.disabled = false; button.innerHTML = '<svg><use href="#i-shield"></use></svg> Ingresar sin conexión'; }
  }
}

async function updateOfflinePreparationUi() {
  if (!window.LubaydOffline?.available) return;
  const uid = authenticatedUser?.uid;
  const onlineSession = Boolean(uid && !offlineSession && window.firebase?.auth?.().currentUser?.uid === uid);
  let hasPin = false;
  let pending = 0;
  if (uid) {
    hasPin = await window.LubaydOffline.hasPin(uid).catch(() => false);
    pending = await window.LubaydOffline.pendingCount(uid).catch(() => 0);
  }
  const text = $('#offlineReadyText');
  const badge = $('#offlineReadyBadge');
  if (text) text.textContent = hasPin
    ? `Este teléfono está preparado. ${pending ? `${pending} marca(s) pendiente(s) de sincronización.` : 'No hay marcas pendientes.'}`
    : 'Inicia sesión una vez con internet para habilitar automáticamente el acceso sin conexión en este celular.';
  if (badge) {
    badge.textContent = hasPin ? 'Preparado' : 'Falta preparar';
    badge.classList.toggle('ready', hasPin);
    badge.classList.toggle('warning', !hasPin);
  }
  if ($('#offlinePinSetup')) $('#offlinePinSetup').disabled = !onlineSession;
  if ($('#saveOfflinePinBtn')) $('#saveOfflinePinBtn').disabled = !onlineSession;
  if ($('#removeOfflinePinBtn')) $('#removeOfflinePinBtn').disabled = !onlineSession || !hasPin;
}

async function saveOfflinePin() {
  if (offlineSession || !authenticatedUser?.uid || window.firebase?.auth?.().currentUser?.uid !== authenticatedUser.uid) {
    showToast('Conexión requerida', 'Inicia sesión normalmente para configurar el PIN offline.');
    return;
  }
  try {
    await window.LubaydOffline.saveProfile(authenticatedUser, authenticatedProfile);
    await window.LubaydOffline.setPin(authenticatedUser.uid, $('#offlinePinSetup')?.value || '');
    await authorizeCurrentDeviceForOperator({ silent: true });
    if ($('#offlinePinSetup')) $('#offlinePinSetup').value = '';
    await refreshOfflineAccess();
    await updateOfflinePreparationUi();
    showToast('PIN offline guardado', 'Este usuario ya puede abrir la asistencia sin internet en este teléfono.');
  } catch (error) {
    showToast('No se pudo guardar el PIN', error.message || String(error));
  }
}

async function removeOfflinePin() {
  if (offlineSession || !authenticatedUser?.uid) return;
  if (!confirm('¿Eliminar el acceso por PIN de este teléfono? Las marcas guardadas no se borrarán.')) return;
  await window.LubaydOffline.removePin(authenticatedUser.uid);
  await refreshOfflineAccess();
  await updateOfflinePreparationUi();
  showToast('PIN eliminado', 'El modo offline deberá prepararse nuevamente.');
}

$('#offlineLoginBtn')?.addEventListener('click', offlineLogin);
$('#offlineRefreshBtn')?.addEventListener('click', () => refreshOfflineAccess({ silent: false }));
$('#offlinePinInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') offlineLogin(); });
$('#saveOfflinePinBtn')?.addEventListener('click', saveOfflinePin);
$('#removeOfflinePinBtn')?.addEventListener('click', removeOfflinePin);
window.addEventListener('lubayd-offline-state-changed', () => { refreshOfflineAccess(); updateOfflinePreparationUi(); });

async function logout() {
  if (!confirm('¿Cerrar la sesión actual?')) return;
  explicitSignOut = true;
  stopSessionClock();
  await window.LubaydOffline?.clearActiveSession?.().catch(() => {});
  if (offlineSession) {
    offlineSession = false;
    authenticatedUser = null;
    authenticatedProfile = null;
    window.LubaydCurrentUser = null;
    window.LubaydCurrentProfile = null;
    window.LubaydOfflineSession = false;
    document.body.classList.remove('auth-ready', 'offline-session');
    document.body.classList.add('auth-pending');
    window.dispatchEvent(new CustomEvent('lubayd-offline-signed-out'));
    await refreshOfflineAccess();
    explicitSignOut = false;
    return;
  }
  if (window.LubaydAuth?.available) await window.LubaydAuth.logout().catch(() => {});
  authenticatedUser = null;
  authenticatedProfile = null;
  document.body.classList.remove('auth-ready', 'offline-session');
  document.body.classList.add('auth-pending');
  await refreshOfflineAccess();
  explicitSignOut = false;
}
$('#logoutBtn')?.addEventListener('click', logout);
$('#mobileLogoutBtn')?.addEventListener('click', async () => {
  $('#mobileMoreSheet')?.classList.add('hidden');
  document.body.classList.remove('mobile-sheet-open');
  await logout();
});

async function handleAuthChange(user) {
  if (!user && offlineSession) return;
  const sequence = ++authChangeSequence;
  cloudUnsubscribe?.();
  cloudUnsubscribe = null;

  if (!user) {
    authenticatedUser = null;
    authenticatedProfile = null;
    window.LubaydCurrentProfile = null;
    stopSessionClock();
    const restored = explicitSignOut ? false : await restoreOfflineSessionIfAvailable().catch(() => false);
    if (restored) return;
    document.body.classList.remove('auth-ready', 'offline-session', 'auth-restoring');
    document.body.classList.add('auth-pending');
    setCloudStatus('Sesión cerrada', false, 'Ingresa con PIN local o con Firebase');
    showAuthTab('login');
    await refreshOfflineAccess({ silent: true });
    window.setTimeout(() => $('#loginEmail')?.focus(), 120);
    return;
  }

  document.body.classList.remove('auth-ready');
  document.body.classList.add('auth-pending');
  setAuthMessage('Verificando autorización…', 'success');

  try {
    offlineSession = false;
    window.LubaydOfflineSession = false;
    document.body.classList.remove('offline-session');
    const profile = await window.LubaydAuth.getProfile(user);
    if (sequence !== authChangeSequence) return;

    if (!profile?.active) {
      await window.LubaydOffline?.clearActiveSession?.().catch(() => {});
      await window.LubaydAuth.logout();
      window.setTimeout(() => {
        showAuthTab('login');
        $('#loginEmail').value = user.email || '';
        setAuthMessage('La cuenta está desactivada. Consulta con el administrador.');
      }, 80);
      return;
    }

    await window.LubaydOffline.saveProfile(user, profile).catch(error => console.warn('Guardar perfil local:', error));
    if (profile.role === 'operador' && pendingOfflineCredential) {
      const alreadyPrepared = await window.LubaydOffline.hasPin(user.uid).catch(() => false);
      if (!alreadyPrepared) {
        await window.LubaydOffline.setPin(user.uid, pendingOfflineCredential).catch(error => console.warn('Preparación automática offline:', error));
      }
    }
    pendingOfflineCredential = '';
    let session = await window.LubaydOffline.getActiveSession().catch(() => null);
    const interactive = interactiveAuthIntent || window.LubaydInteractiveLogin === true;
    if (interactive) {
      session = await createOneHourSession(user.uid, 'online');
    } else if (!session || session.mode !== 'online' || session.uid !== user.uid) {
      await window.LubaydAuth.logout().catch(() => {});
      setAuthMessage('La sesión anterior finalizó. Vuelve a ingresar.');
      return;
    } else {
      startSessionClock(session);
    }
    interactiveAuthIntent = false;
    window.LubaydInteractiveLogin = false;

    authenticatedUser = user;
    authenticatedProfile = profile;
    window.LubaydCurrentUser = user;
    window.LubaydCurrentProfile = profile;
    document.body.classList.remove('auth-pending', 'auth-restoring');
    document.body.classList.add('auth-ready');
    setAuthMessage('');
    updateUserInterface(user);
    updateSessionTimerUi();
    window.dispatchEvent(new CustomEvent('lubayd-profile-ready', { detail: { user, profile } }));
    initializeForm();
    renderAll();
    restorePreferredView();
    startCloudSync();
    refreshOfflineAccess();
    updateOfflinePreparationUi();
    await authorizeCurrentDeviceForOperator({ silent: true }).catch(error => console.warn('Autorización multidispositivo:', error));
    window.setTimeout(() => {
      Promise.allSettled([
        window.LubaydSyncOfflineAttendance?.({ silent: true }),
        syncPendingParts({ silent: true })
      ]).catch(() => {});
    }, 1000);
    window.setTimeout(() => syncPendingParts({ silent: true }).catch(console.warn), 5000);
  } catch (error) {
    interactiveAuthIntent = false;
    window.LubaydInteractiveLogin = false;
    console.error('Verificación de usuario:', error);
    document.body.classList.remove('auth-restoring');
    await window.LubaydOffline?.clearActiveSession?.().catch(() => {});
    await window.LubaydAuth.logout().catch(() => {});
    window.setTimeout(() => setAuthMessage(error.message || 'No se pudo verificar la autorización del usuario.'), 80);
  }
}
window.addEventListener('lubayd-auth-changed', event => handleAuthChange(event.detail?.user || null));

const viewMeta = {
  dashboard: ['Centro de operaciones', 'Panel operativo'],
  asistencia: ['Control horario', 'Asistencia del equipo'],
  nuevo: ['Registro guiado', 'Nuevo parte diario'],
  historial: ['Registros', 'Historial de partes'],
  graficos: ['Análisis operativo', 'Gráficos de producción'],
  ubicaciones: ['Geolocalización', 'Ubicaciones GPS'],
  chat: ['Comunicación interna', 'Mensajes del equipo'],
  incidencias: ['Control de novedades', 'Incidencias y alertas'],
  maquinas: ['Catálogo operativo', 'Máquinas'],
  montes: ['Catálogo de campo', 'Montes y lotes'],
  usuarios: ['Administración', 'Usuarios y permisos'],
  reportes: ['Inteligencia operativa', 'Reportes avanzados'],
  sincronizacion: ['Conectividad', 'Sincronización'],
  configuracion: ['Preferencias', 'Configuración']
};


function readNavigationState() {
  try {
    const raw = sessionStorage.getItem(NAVIGATION_STATE_KEY) || localStorage.getItem(NAVIGATION_STATE_KEY) || '{}';
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeNavigationState(changes = {}) {
  const current = readNavigationState();
  const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
  const raw = JSON.stringify(next);
  try { sessionStorage.setItem(NAVIGATION_STATE_KEY, raw); } catch (_) {}
  try { localStorage.setItem(NAVIGATION_STATE_KEY, raw); } catch (_) {}
  return next;
}

function saveCurrentScrollPosition() {
  if (!currentViewId) return;
  const current = readNavigationState();
  writeNavigationState({
    view: currentViewId,
    scrollByView: { ...(current.scrollByView || {}), [currentViewId]: Math.max(0, Math.round(window.scrollY || 0)) }
  });
}

function preferredViewId() {
  const queryView = new URLSearchParams(window.location.search).get('view');
  const savedView = readNavigationState().view;
  return viewMeta[queryView] ? queryView : (viewMeta[savedView] ? savedView : 'dashboard');
}

function restorePreferredView() {
  if (!currentUser()) return;
  let id = preferredViewId();
  const target = document.getElementById(id);
  const offlineAllowed = new Set(['dashboard', 'asistencia', 'nuevo', 'historial', 'graficos', 'ubicaciones']);
  if (!target || (offlineSession && !offlineAllowed.has(id)) || (target.classList.contains('admin-view') && authenticatedProfile?.role !== 'admin')) {
    id = 'dashboard';
  }
  showView(id, { restorePosition: true, preserveCurrentScroll: false });
}

function showView(id, options = {}) {
  if (!currentUser()) return;
  if (offlineSession) {
    const offlineViews = new Set(['dashboard', 'asistencia', 'nuevo', 'historial', 'graficos', 'ubicaciones']);
    if (!offlineViews.has(id)) {
      showToast('Función en línea', 'Esta sección necesita conexión. Puedes usar Inicio, Partes, Historial, Gráficos, Ubicaciones y Asistencia sin internet.');
      return;
    }
  }
  if (options.preserveCurrentScroll !== false) saveCurrentScrollPosition();
  const targetView = document.getElementById(id);
  if (!targetView) return;
  if (targetView.classList.contains('admin-view') && authenticatedProfile?.role !== 'admin') {
    showToast('Acceso restringido', 'Esta herramienta está disponible únicamente para administradores.');
    return;
  }

  currentViewId = id;
  $$('.view').forEach(view => view.classList.toggle('active', view.id === id));
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === id));

  const [eyebrow, title] = viewMeta[id] || ['Gestión forestal', 'Lubayd SA'];
  $('#pageEyebrow').textContent = eyebrow;
  $('#pageTitle').textContent = title;

  if (id === 'nuevo') {
    initializeForm();
    updateStep();
  }
  if (id === 'historial') renderHistory();
  if (id === 'ubicaciones') renderLocations();
  if (id === 'asistencia' && window.LubaydAttendanceUI?.show) window.LubaydAttendanceUI.show();
  if (typeof window.LubaydOperations?.viewChanged === 'function') window.LubaydOperations.viewChanged(id);
  if (id === 'graficos' && typeof window.renderCharts === 'function') window.renderCharts();
  if (id === 'chat' && window.LubaydChatUI?.show) window.LubaydChatUI.show();

  closeSidebar();
  const previousState = readNavigationState();
  writeNavigationState({ view: id, scrollByView: previousState.scrollByView || {} });
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('view', id);
    window.history.replaceState({ view: id }, '', url);
  } catch (_) {}
  const savedTop = Number(previousState.scrollByView?.[id] || 0);
  window.setTimeout(() => window.scrollTo({ top: options.restorePosition ? savedTop : 0, behavior: 'auto' }), 0);
}
window.LubaydShowView = showView;

$$('[data-view], [data-view-link]').forEach(element => {
  element.addEventListener('click', () => showView(element.dataset.view || element.dataset.viewLink));
});
$('#heroNewBtn')?.addEventListener('click', () => showView('nuevo'));
$('#continueDraftBtn')?.addEventListener('click', () => showView('nuevo'));

function initializeForm() {
  if (formInitialized) {
    if (!$('#fecha').value) $('#fecha').value = todayKey();
    enforceAuthenticatedOperator();
    return;
  }

  formInitialized = true;
  if (!restoreDraft()) {
    $('#fecha').value = todayKey();
  }
  enforceAuthenticatedOperator();
  recalculateProduction();
  updateCheckCards();
  renderGpsState();
  refreshSuggestions();
  updateStep();
}

function updateStep() {
  $$('.form-page').forEach(page => page.classList.toggle('active', Number(page.dataset.step) === step));
  $$('.wizard-step').forEach((item, index) => {
    const itemStep = index + 1;
    item.classList.toggle('active', itemStep === step);
    item.classList.toggle('completed', itemStep < step);
    const button = item.querySelector('button');
    button.disabled = itemStep > step;
    button.setAttribute('aria-current', itemStep === step ? 'step' : 'false');
  });

  const labels = ['Datos generales', 'Producción', 'Chequeo', 'Ubicación', 'Resumen'];
  $('#mobileStepLabel').textContent = `Paso ${step} de ${TOTAL_STEPS}`;
  $('#stepText').textContent = labels[step - 1];
  $('#stepProgressBar').style.width = `${(step / TOTAL_STEPS) * 100}%`;
  $('#prevBtn').classList.toggle('hidden', step === 1);
  $('#nextBtn').classList.toggle('hidden', step === TOTAL_STEPS);
  $('#saveBtn').classList.toggle('hidden', step !== TOTAL_STEPS);
  clearFormMessage();

  if (step === 4 && !currentGps && !gpsInProgress && !gpsAttemptedThisForm) {
    gpsAttemptedThisForm = true;
    window.setTimeout(() => captureGps(true), 350);
  }
  if (step === 5) {
    window.requestAnimationFrame(() => { resizeSignatureCanvas(); renderSignaturePad(); });
    fillReview();
  }
}

$$('.wizard-step').forEach(item => {
  item.querySelector('button')?.addEventListener('click', () => {
    const target = Number(item.dataset.stepTarget);
    if (target < step) {
      step = target;
      updateStep();
      scrollFormTop();
    }
  });
});

function scrollFormTop() {
  const shell = $('.wizard-shell');
  if (!shell) return;
  const offset = window.innerWidth <= 900 ? 82 : 96;
  window.scrollTo({ top: Math.max(0, shell.getBoundingClientRect().top + window.scrollY - offset), behavior: 'smooth' });
}

function validateStep(stepNumber, options = {}) {
  const page = $(`.form-page[data-step="${stepNumber}"]`);
  if (!page) return true;

  page.querySelectorAll('.field-error').forEach(field => field.classList.remove('field-error'));
  const required = [...page.querySelectorAll('input[required], select[required], textarea[required]')];

  for (const input of required) {
    if (!input.checkValidity()) {
      const field = input.closest('.field, .field-group') || input.parentElement;
      field?.classList.add('field-error');
      if (!options.silent) {
        showFormMessage('Revisa el formato de los datos antes de continuar.', 'error');
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => input.focus({ preventScroll: true }), 260);
      }
      return false;
    }
  }

  if (stepNumber === 2) {
    const hourStart = $('#horometroInicio')?.value;
    const hourEnd = $('#horometroFinal')?.value;
    if (hourStart !== '' && hourEnd !== '' && numberValue('#horometroFinal') < numberValue('#horometroInicio')) {
      showFormMessage('El horómetro final no puede ser menor que el inicial.', 'error');
      $('#horometroFinal').closest('.field')?.classList.add('field-error');
      if (!options.silent) $('#horometroFinal').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    const treeStart = $('#arbolesIniciales')?.value;
    const treeEnd = $('#arbolesFinales')?.value;
    if (treeStart !== '' && treeEnd !== '' && numberValue('#arbolesFinales') < numberValue('#arbolesIniciales')) {
      showFormMessage('Los árboles finales no pueden ser menores que los iniciales.', 'error');
      $('#arbolesFinales').closest('.field')?.classList.add('field-error');
      if (!options.silent) $('#arbolesFinales').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
  }

  if (stepNumber === 4 && currentGps) {
    const captured = new Date(currentGps.capturedAt || currentGps.positionTimestamp || 0).getTime();
    if (!captured || Date.now() - captured > 15 * 60 * 1000) {
      currentGps = null;
      renderGpsState('La ubicación venció. Puedes obtener una nueva captura o continuar sin GPS.');
    }
  }

  return true;
}

function validateAllSteps() {
  for (let target = 1; target <= 4; target += 1) {
    if (!validateStep(target, { silent: true })) {
      step = target;
      updateStep();
      validateStep(target);
      scrollFormTop();
      return false;
    }
  }
  return true;
}

$('#nextBtn')?.addEventListener('click', () => {
  if (!validateStep(step)) return;
  step = Math.min(TOTAL_STEPS, step + 1);
  updateStep();
  scrollFormTop();
});

$('#prevBtn')?.addEventListener('click', () => {
  step = Math.max(1, step - 1);
  updateStep();
  scrollFormTop();
});

$('#cancelBtn')?.addEventListener('click', () => {
  saveDraft();
  showToast('Borrador guardado', 'Puedes continuar el parte más tarde.');
  showView('dashboard');
});

function numberValue(selector) {
  return Number($(selector)?.value) || 0;
}

function radioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
}

function setRadioValue(name, value) {
  $$(`input[name="${name}"]`).forEach(input => {
    input.checked = input.value === value;
  });
}

function recalculateProduction() {
  const hours = Math.max(0, numberValue('#horometroFinal') - numberValue('#horometroInicio'));
  const trees = Math.max(0, numberValue('#arbolesFinales') - numberValue('#arbolesIniciales'));
  const performance = hours > 0 ? trees / hours : 0;

  $('#calcHoras').textContent = `${formatNumber(hours, 1)} h`;
  $('#calcArboles').textContent = formatNumber(trees);
  $('#calcRendimiento').textContent = `${formatNumber(performance, 1)} árb/h`;
}

['#horometroInicio', '#horometroFinal', '#arbolesIniciales', '#arbolesFinales'].forEach(selector => {
  $(selector)?.addEventListener('input', recalculateProduction);
});

function updateCheckCards() {
  CHECK_IDS.forEach(id => {
    const input = document.getElementById(id);
    const card = input?.closest('.check-card');
    const stateLabel = card?.querySelector('.check-state');
    if (stateLabel) stateLabel.textContent = input.checked ? 'Óptimo' : 'Pendiente';
  });
  const checkAllButton = $('#checkAllBtn');
  if (checkAllButton) {
    const allChecked = CHECK_IDS.every(id => document.getElementById(id)?.checked);
    checkAllButton.innerHTML = allChecked
      ? '<svg><use href="#i-check"></use></svg> Desmarcar todos'
      : '<svg><use href="#i-check"></use></svg> Marcar todos';
  }
}

CHECK_IDS.forEach(id => document.getElementById(id)?.addEventListener('change', updateCheckCards));

$('#checkAllBtn')?.addEventListener('click', () => {
  const shouldCheck = CHECK_IDS.some(id => !document.getElementById(id).checked);
  CHECK_IDS.forEach(id => { document.getElementById(id).checked = shouldCheck; });
  updateCheckCards();
  scheduleDraftSave();
  $('#checkAllBtn').innerHTML = shouldCheck
    ? '<svg><use href="#i-check"></use></svg> Desmarcar todos'
    : '<svg><use href="#i-check"></use></svg> Marcar todos';
});

function recordFromForm() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    version: 20.86,
    createdAt: now,
    updatedAt: now,
    monte: $('#monte').value.trim(),
    fecha: $('#fecha').value,
    maquina: $('#maquina').value.trim(),
    operador: userDisplayName(),
    createdByUid: currentUser()?.uid || '',
    createdByEmail: currentUser()?.email || '',
    createdByName: userDisplayName(),
    turno: radioValue('turno'),
    trozaCantidad: numberValue('#trozaCantidad'),
    pulpaCantidad: numberValue('#pulpaCantidad'),
    largo: numberValue('#largo'),
    horometroInicio: numberValue('#horometroInicio'),
    horometroFinal: numberValue('#horometroFinal'),
    horas: Math.max(0, numberValue('#horometroFinal') - numberValue('#horometroInicio')),
    arbolesIniciales: numberValue('#arbolesIniciales'),
    arbolesFinales: numberValue('#arbolesFinales'),
    arboles: Math.max(0, numberValue('#arbolesFinales') - numberValue('#arbolesIniciales')),
    carros: numberValue('#carros'),
    actividad: radioValue('actividad'),
    desde: $('#desde1').value,
    hasta: $('#hasta1').value,
    trabajo: $('#trabajo1').value.trim(),
    mecanico: $('#mecanico1').value.trim(),
    checks: Object.fromEntries(CHECK_IDS.map(id => [id, document.getElementById(id).checked])),
    observaciones: $('#observaciones').value.trim(),
    combustible: numberValue('#combustible'),
    hidraulico: numberValue('#hidraulico'),
    controlado: $('#controlado').value.trim(),
    firma: $('#firma').value.trim(),
    firmaDigital: signatureData || '',
    firmaDigitalAt: signatureData ? now : '',
    gps: currentGps ? { ...currentGps } : null
  };
}

function fillReview() {
  const record = recordFromForm();
  const completedChecks = CHECK_IDS.filter(id => record.checks[id]);
  const gpsText = record.gps
    ? `${record.gps.latitude.toFixed(5)}, ${record.gps.longitude.toFixed(5)} · ±${Math.round(record.gps.accuracy)} m`
    : 'Sin ubicación GPS';

  $('#reviewContent').innerHTML = `
    <div class="review-hero">
      <div>
        <span>PARTE LISTO PARA GUARDAR</span>
        <h4>${escapeHtml(record.monte) || 'Monte sin definir'}</h4>
        <p>${escapeHtml(record.operador)} · ${escapeHtml(record.maquina)} · ${formatDate(record.fecha)}</p>
      </div>
      <div class="review-production">
        <div><strong>${formatNumber(record.arboles)}</strong><small>Árboles</small></div>
        <div><strong>${formatNumber(record.horas, 1)} h</strong><small>Horas</small></div>
      </div>
    </div>
    <div class="review-grid">
      ${reviewItem('Fecha', formatDate(record.fecha))}
      ${reviewItem('Turno', record.turno || '—')}
      ${reviewItem('Troza', formatNumber(record.trozaCantidad))}
      ${reviewItem('Pulpa', formatNumber(record.pulpaCantidad))}
      ${reviewItem('Actividad', record.actividad || '—')}
      ${reviewItem('Carros', formatNumber(record.carros))}
      ${reviewItem('Rendimiento', `${formatNumber(record.horas ? record.arboles / record.horas : 0, 1)} árb/h`)}
      ${reviewItem('Combustible', `${formatNumber(record.combustible, 1)} L`)}
      ${reviewItem('Hidráulico', `${formatNumber(record.hidraulico, 1)} L`)}
      ${reviewItem('Ubicación', gpsText)}
    </div>
    <div class="review-checks">
      <span>Chequeos confirmados: ${completedChecks.length} de ${CHECK_IDS.length}</span>
      <div class="review-check-list">
        ${CHECK_IDS.map(id => `<b class="${record.checks[id] ? 'ok' : ''}">${record.checks[id] ? '✓' : '○'} ${CHECK_LABELS[id]}</b>`).join('')}
      </div>
    </div>
    ${record.observaciones ? `<div class="review-checks"><span>Observaciones</span><p style="margin:0;color:#425466;font-size:11px;white-space:pre-wrap">${escapeHtml(record.observaciones)}</p></div>` : ''}
    ${record.firmaDigital ? `<div class="review-signature"><span>Firma digital</span><img src="${record.firmaDigital}" alt="Firma digital del responsable"></div>` : '<div class="review-signature"><span>Firma digital</span><p style="margin:0;color:#7b8b83;font-size:10px">Sin firma registrada.</p></div>'}
  `;
}

function reviewItem(label, value) {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`;
}

$('#parteForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser()) {
    showFormMessage('Tu sesión terminó. Vuelve a ingresar.', 'error');
    return;
  }
  if (!validateAllSteps()) return;

  const saveButton = $('#saveBtn');
  const original = saveButton.innerHTML;
  saveButton.disabled = true;
  saveButton.innerHTML = '<svg><use href="#i-cloud"></use></svg> Guardando…';

  try {
    const record = recordFromForm();
    const savedRecord = await state.saveRecord(record);
    resetForm({ clearDraft: true });
    showToast('Parte guardado', savedRecord?.syncStatus === 'synced' ? 'El registro quedó sincronizado y ya está visible para administración.' : 'El registro quedó guardado en este teléfono y se enviará al recuperar internet.');
    showView('dashboard');
  } catch (error) {
    console.error('Guardar parte:', error);
    showFormMessage(error.message || 'No se pudo guardar el parte en este dispositivo.', 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = original;
  }
});

function resetForm({ clearDraft = false } = {}) {
  $('#parteForm').reset();
  currentGps = null;
  gpsInProgress = false;
  gpsAttemptedThisForm = false;
  clearSignaturePad({ silent: true });
  step = 1;
  $('#fecha').value = todayKey();
  enforceAuthenticatedOperator();
  if (clearDraft) localStorage.removeItem(DRAFT_KEY);
  recalculateProduction();
  updateCheckCards();
  renderGpsState();
  updateStep();
  setDraftStatus('Guardado automático', 'Comienza a completar el nuevo parte');
}

function serializeDraft() {
  const values = {};
  DRAFT_FIELDS.forEach(id => {
    const element = document.getElementById(id);
    if (!element) return;
    values[id] = element.type === 'checkbox' ? element.checked : element.value;
  });

  return {
    values,
    turno: radioValue('turno'),
    actividad: radioValue('actividad'),
    signatureData,
    signatureStrokes,
    savedAt: new Date().toISOString()
  };
}

function saveDraft() {
  if (!formInitialized) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeDraft()));
    setDraftStatus('Borrador guardado', `Actualizado ${formatTime(new Date())}`);
  } catch (error) {
    console.warn('No se pudo guardar el borrador:', error);
    setDraftStatus('Borrador no guardado', 'El almacenamiento del navegador no está disponible');
  }
}

function scheduleDraftSave() {
  window.clearTimeout(draftTimer);
  setDraftStatus('Guardando…', 'Conservando los cambios en este dispositivo');
  draftTimer = window.setTimeout(saveDraft, 380);
}

function restoreDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return false;

  try {
    const draft = JSON.parse(raw);
    Object.entries(draft.values || {}).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (!element) return;
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else element.value = value ?? '';
    });
    setRadioValue('turno', draft.turno || '');
    setRadioValue('actividad', draft.actividad || '');
    signatureData = String(draft.signatureData || '');
    signatureStrokes = Array.isArray(draft.signatureStrokes) ? draft.signatureStrokes : [];
    activeSignatureStroke = null;
    renderSignaturePad();
    currentGps = null;
    enforceAuthenticatedOperator();
    updateCheckCards();
    renderGpsState();
    setDraftStatus('Borrador recuperado', draft.savedAt ? `Guardado ${formatDateTime(draft.savedAt)}` : 'Puedes continuar donde lo dejaste');
    return true;
  } catch (error) {
    console.warn('No se pudo restaurar el borrador:', error);
    localStorage.removeItem(DRAFT_KEY);
    return false;
  }
}

$('#parteForm')?.addEventListener('input', scheduleDraftSave);
$('#parteForm')?.addEventListener('change', scheduleDraftSave);

$('#clearDraftBtn')?.addEventListener('click', () => {
  if (!confirm('¿Limpiar todos los campos del parte actual?')) return;
  resetForm({ clearDraft: true });
  showToast('Formulario limpio', 'El borrador anterior fue eliminado.');
});

$('#useLastRecordBtn')?.addEventListener('click', () => {
  const last = state.records[0];
  if (!last) {
    showToast('Sin registros anteriores', 'Guarda un parte para poder reutilizar sus datos frecuentes.');
    return;
  }

  $('#monte').value = last.monte || '';
  $('#maquina').value = last.maquina || '';
  enforceAuthenticatedOperator();
  $('#trozaCantidad').value = last.trozaCantidad || '';
  $('#pulpaCantidad').value = last.pulpaCantidad || '';
  $('#largo').value = last.largo || '';
  setRadioValue('turno', last.turno || '');
  setRadioValue('actividad', last.actividad || '');
  clearSignaturePad({ silent: true });
  scheduleDraftSave();
  showToast('Datos reutilizados', 'Se cargaron el monte, la máquina y otros datos frecuentes. El operador corresponde al usuario conectado.');
});

function setDraftStatus(title, text) {
  $('#draftStatusTitle').textContent = title;
  $('#draftStatusText').textContent = text;
}

function showFormMessage(text, type = '') {
  const message = $('#message');
  message.textContent = text;
  message.className = `form-message ${type}`.trim();
}

function clearFormMessage() {
  const message = $('#message');
  message.textContent = '';
  message.className = 'form-message';
}

function refreshSuggestions() {
  const records = state.records;
  fillDatalist('#monteOptions', records.map(record => record.monte));
  fillDatalist('#maquinaOptions', records.map(record => record.maquina));
  fillDatalist('#operadorOptions', records.map(record => record.operador));
}

function fillDatalist(selector, values) {
  const unique = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  $(selector).innerHTML = unique.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function renderAll() {
  const records = state.records;
  const totalTrees = records.reduce((sum, record) => sum + (Number(record.arboles) || 0), 0);
  const totalHours = records.reduce((sum, record) => sum + (Number(record.horas) || 0), 0);
  const complete = records.filter(record => CHECK_IDS.every(id => Boolean(record.checks?.[id]))).length;
  const today = todayKey();
  const todayRecords = records.filter(record => record.fecha === today);
  const todayTrees = todayRecords.reduce((sum, record) => sum + (Number(record.arboles) || 0), 0);
  const todayHours = todayRecords.reduce((sum, record) => sum + (Number(record.horas) || 0), 0);
  const lastSevenCutoff = new Date();
  lastSevenCutoff.setHours(0, 0, 0, 0);
  lastSevenCutoff.setDate(lastSevenCutoff.getDate() - 6);
  const lastSeven = records.filter(record => {
    const date = parseRecordDate(record.fecha);
    return date && date >= lastSevenCutoff;
  });
  const sevenTrees = lastSeven.reduce((sum, record) => sum + (Number(record.arboles) || 0), 0);
  const sevenHours = lastSeven.reduce((sum, record) => sum + (Number(record.horas) || 0), 0);

  $('#kpiTotal').textContent = formatNumber(records.length);
  $('#kpiArboles').textContent = formatNumber(totalTrees);
  $('#kpiHoras').textContent = formatNumber(totalHours, 1);
  $('#kpiChequeos').textContent = `${records.length ? Math.round((complete / records.length) * 100) : 0}%`;
  $('#kpiTotalDelta').textContent = `${formatNumber(todayRecords.length)} hoy`;
  $('#kpiTreesDelta').textContent = `${formatNumber(todayTrees)} hoy`;
  $('#kpiHoursDelta').textContent = `${formatNumber(todayHours, 1)} h hoy`;
  $('#kpiChecksDelta').textContent = records.length ? `${complete} de ${records.length} completos` : 'Sin registros';
  $('#dashboardTrees7').textContent = formatNumber(sevenTrees);
  $('#dashboardHours7').textContent = `${formatNumber(sevenHours, 1)} h`;
  $('#dashboardAverage7').textContent = formatNumber(lastSeven.length ? sevenTrees / lastSeven.length : 0, 1);
  $('#lastUpdate').textContent = formatDateTime(new Date().toISOString());

  updateGreeting();
  renderRecent(records);
  refreshSuggestions();
  refreshOperatorFilters();

  if (typeof window.refreshChartOperators === 'function') window.refreshChartOperators();
  if (typeof window.renderDashboardTrend === 'function') window.renderDashboardTrend();
  if (typeof window.renderCharts === 'function' && $('#graficos')?.classList.contains('active')) window.renderCharts();
  if ($('#historial')?.classList.contains('active')) renderHistory();
  if ($('#ubicaciones')?.classList.contains('active')) renderLocations();

  window.dispatchEvent(new CustomEvent('lubayd-records-updated'));
}

function updateGreeting() {
  const name = userDisplayName();
  $('#greetingTitle').textContent = `Bienvenido, ${name}`;
  if ($('#adminGreetingTitle')) $('#adminGreetingTitle').textContent = `Bienvenido, ${name}`;
  $('#currentDateText').textContent = new Date().toLocaleDateString('es-UY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function renderRecent(records) {
  const root = $('#recentList');
  if (!records.length) {
    root.className = 'recent-list empty-state';
    root.textContent = 'Todavía no hay partes guardados.';
    return;
  }

  root.className = 'recent-list';
  root.innerHTML = records.slice(0, 5).map(record => `
    <article class="recent-item" data-detail="${escapeHtml(record.id)}" tabindex="0">
      <span class="recent-icon"><svg><use href="#i-tree"></use></svg></span>
      <div class="recent-copy"><strong>${escapeHtml(record.monte)} · ${escapeHtml(record.maquina)}</strong><span>${recordDateTimeLabel(record)} · ${escapeHtml(record.operador)} · ${escapeHtml(record.actividad || 'Sin actividad')}</span></div>
      <div class="recent-value"><strong>${formatNumber(record.arboles)}</strong><small>árboles</small></div>
      <svg><use href="#i-arrow"></use></svg>
    </article>
  `).join('');

  root.querySelectorAll('[data-detail]').forEach(item => {
    item.addEventListener('click', () => openDetail(item.dataset.detail));
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') openDetail(item.dataset.detail);
    });
  });
}

function refreshOperatorFilters() {
  const operators = [...new Set(state.records.map(record => String(record.operador || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  const select = $('#historyOperatorFilter');
  const current = select.value;
  select.innerHTML = '<option value="">Todos los operadores</option>' + operators.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (operators.includes(current)) select.value = current;
}

function filteredRecords() {
  const query = $('#historySearch').value.trim().toLowerCase();
  const date = $('#historyDateFilter').value;
  const activity = $('#activityFilter').value;
  const operator = $('#historyOperatorFilter').value;
  return state.records.filter(record => {
    const matchesQuery = !query || [record.monte, record.maquina, record.operador]
      .some(value => String(value || '').toLowerCase().includes(query));
    return matchesQuery
      && (!date || record.fecha === date)
      && (!activity || record.actividad === activity)
      && (!operator || record.operador === operator);
  });
}

function recordDateTimeLabel(record) {
  const time = formatTimeValue(record?.createdAt || record?.localSavedAt || record?.updatedAt);
  return `${formatDate(record?.fecha)}${time === '—' ? '' : ` · ${time}`}`;
}

function partSyncBadge(record) {
  if (record?.syncStatus === 'error') return '<span class="part-sync-badge error">Error al sincronizar</span>';
  if (record?.syncStatus === 'pending' || record?.syncStatus === 'syncing') return '<span class="part-sync-badge pending">Pendiente de sincronización</span>';
  return '<span class="part-sync-badge synced">Sincronizado</span>';
}

function renderHistory() {
  const records = filteredRecords();
  const body = $('#historyBody');
  const cards = $('#historyCards');
  const empty = $('#historyEmpty');

  empty.classList.toggle('show', records.length === 0);
  $('#historyResultCount').textContent = `${formatNumber(records.length)} ${records.length === 1 ? 'registro' : 'registros'}`;
  const selectedDate = $('#historyDateFilter').value;
  $('#historyDateLabel').textContent = selectedDate ? `Día: ${formatDate(selectedDate)}` : 'Todos los días';
  body.innerHTML = records.map(record => `
    <tr>
      <td>${recordDateTimeLabel(record)}${partSyncBadge(record)}</td>
      <td><strong>${escapeHtml(record.monte)}</strong></td>
      <td>${escapeHtml(record.maquina)}</td>
      <td>${escapeHtml(record.operador)}</td>
      <td>${escapeHtml(record.actividad || '—')}</td>
      <td><strong>${formatNumber(record.arboles)}</strong></td>
      <td>
        <div class="table-actions">
          <button class="table-action" data-detail="${escapeHtml(record.id)}" aria-label="Ver detalle"><svg><use href="#i-eye"></use></svg></button>
          ${record.gps ? `<a class="table-action" href="${mapUrl(record.gps)}" target="_blank" rel="noopener" aria-label="Abrir mapa"><svg><use href="#i-pin"></use></svg></a>` : ''}
          ${canDeleteRecord(record) ? `<button class="table-action danger" data-delete="${escapeHtml(record.id)}" aria-label="Eliminar"><svg><use href="#i-trash"></use></svg></button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  cards.innerHTML = records.map(record => `
    <article class="history-card">
      <div class="history-card-head">
        <div><strong>${escapeHtml(record.monte)} · ${escapeHtml(record.maquina)}</strong><span>${recordDateTimeLabel(record)} · ${escapeHtml(record.operador)}</span>${partSyncBadge(record)}</div>
        <div class="history-card-value"><b>${formatNumber(record.arboles)}</b><small>árboles</small></div>
      </div>
      <div class="history-card-meta"><span>${escapeHtml(record.actividad || 'Sin actividad')}</span><span>${formatNumber(record.horas, 1)} h</span><span>${formatNumber(record.combustible, 1)} L</span></div>
      <div class="history-card-actions">
        <button data-detail="${escapeHtml(record.id)}"><svg><use href="#i-eye"></use></svg>Ver</button>
        ${record.gps ? `<a href="${mapUrl(record.gps)}" target="_blank" rel="noopener"><svg><use href="#i-pin"></use></svg>Mapa</a>` : '<span></span>'}
        ${canDeleteRecord(record) ? `<button class="danger" data-delete="${escapeHtml(record.id)}"><svg><use href="#i-trash"></use></svg>Eliminar</button>` : '<span></span>'}
      </div>
    </article>
  `).join('');

  bindRecordActions(body);
  bindRecordActions(cards);
}

function canDeleteRecord(record) {
  const user = currentUser();
  return Boolean(user && record?.createdByUid && record.createdByUid === user.uid);
}

function bindRecordActions(root) {
  root.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.detail)));
  root.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteRecord(button.dataset.delete)));
}

$('#historySearch')?.addEventListener('input', renderHistory);
$('#historyDateFilter')?.addEventListener('change', renderHistory);
$('#activityFilter')?.addEventListener('change', renderHistory);
$('#historyOperatorFilter')?.addEventListener('change', renderHistory);
$('#clearHistoryFilters')?.addEventListener('click', () => {
  $('#historySearch').value = '';
  $('#historyDateFilter').value = '';
  $('#activityFilter').value = '';
  $('#historyOperatorFilter').value = '';
  renderHistory();
});

async function deleteRecord(id) {
  if (!confirm('¿Eliminar este parte? Esta acción también lo eliminará de los dispositivos sincronizados.')) return;
  await state.deleteRecord(id);
  renderHistory();
  renderLocations();
  showToast('Parte eliminado', 'El registro fue retirado del historial.');
}

function openDetail(id) {
  const record = state.records.find(item => item.id === id);
  if (!record) return;

  const fields = {
    Fecha: formatDate(record.fecha),
    Hora: formatTimeValue(record.createdAt || record.localSavedAt || record.updatedAt),
    Operador: record.operador || '—',
    Máquina: record.maquina || '—',
    Turno: record.turno || '—',
    Troza: formatNumber(record.trozaCantidad || 0),
    Pulpa: formatNumber(record.pulpaCantidad || 0),
    Actividad: record.actividad || '—',
    'Horas trabajadas': `${formatNumber(record.horas, 1)} h`,
    'Árboles procesados': formatNumber(record.arboles),
    Rendimiento: `${formatNumber(record.horas ? record.arboles / record.horas : 0, 1)} árb/h`,
    Carros: formatNumber(record.carros),
    Combustible: `${formatNumber(record.combustible, 1)} L`,
    Hidráulico: `${formatNumber(record.hidraulico, 1)} L`,
    GPS: record.gps ? `${record.gps.latitude.toFixed(6)}, ${record.gps.longitude.toFixed(6)} (±${Math.round(record.gps.accuracy)} m)` : 'Sin ubicación',
    Observaciones: record.observaciones || 'Sin observaciones'
  };

  $('#detailContent').innerHTML = `
    <span class="detail-eyebrow">DETALLE DEL PARTE</span>
    <h2 class="detail-title">${escapeHtml(record.monte)} · ${escapeHtml(record.maquina)}</h2>
    <p class="detail-subtitle">Registrado ${formatDateTime(record.createdAt)} por ${escapeHtml(record.operador || 'Operador')}.</p>
    <div class="detail-grid">${Object.entries(fields).map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join('')}</div>
    ${record.firmaDigital ? `<div class="detail-signature"><span>Firma digital</span><img src="${record.firmaDigital}" alt="Firma digital del parte"></div>` : ''}
    ${record.gps ? `<a class="btn btn-primary detail-map" href="${mapUrl(record.gps)}" target="_blank" rel="noopener"><svg><use href="#i-pin"></use></svg> Abrir ubicación en el mapa</a>` : ''}
  `;
  $('#detailModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  $('#detailModal').classList.add('hidden');
  document.body.style.overflow = '';
}

$('#detailClose')?.addEventListener('click', closeDetail);
$('#detailModal')?.addEventListener('click', event => {
  if (event.target.id === 'detailModal') closeDetail();
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#detailModal').classList.contains('hidden')) closeDetail();
});

$('#exportBtn')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.records, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `partes-forestales-${todayKey()}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 700);
  showToast('Archivo preparado', 'Se descargó una copia JSON del historial.');
});


function signatureCanvasElements() {
  return {
    canvas: $('#signatureCanvas'),
    placeholder: $('#signaturePlaceholder'),
    status: $('#signatureStatus'),
    undo: $('#signatureUndoBtn'),
    clear: $('#signatureClearBtn'),
    wrap: $('.signature-pad-wrap')
  };
}

function resizeSignatureCanvas() {
  const { canvas } = signatureCanvasElements();
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  renderSignaturePad();
}

function signatureContext() {
  const { canvas } = signatureCanvasElements();
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(rect.width, 1);
  const scaleY = canvas.height / Math.max(rect.height, 1);
  context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#10261b';
  context.lineWidth = 2.4;
  return { context, rect };
}

function drawSignatureStroke(context, stroke) {
  if (!stroke?.length) return;
  context.beginPath();
  context.moveTo(stroke[0].x, stroke[0].y);
  if (stroke.length === 1) {
    context.lineTo(stroke[0].x + 0.1, stroke[0].y + 0.1);
  } else {
    for (let index = 1; index < stroke.length; index += 1) {
      const point = stroke[index];
      const previous = stroke[index - 1];
      const middleX = (previous.x + point.x) / 2;
      const middleY = (previous.y + point.y) / 2;
      context.quadraticCurveTo(previous.x, previous.y, middleX, middleY);
    }
  }
  context.stroke();
}

function renderSignaturePad() {
  const elements = signatureCanvasElements();
  const setup = signatureContext();
  if (!setup || !elements.canvas) return;
  const { context, rect } = setup;
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, rect.width, rect.height);

  if (signatureStrokes.length) {
    signatureStrokes.forEach(stroke => drawSignatureStroke(context, stroke));
  } else if (signatureData) {
    const image = new Image();
    image.onload = () => {
      const current = signatureContext();
      if (!current) return;
      current.context.drawImage(image, 0, 0, current.rect.width, current.rect.height);
    };
    image.src = signatureData;
  }

  const hasSignature = Boolean(signatureData || signatureStrokes.length);
  elements.placeholder?.classList.toggle('hidden', hasSignature);
  elements.status?.classList.toggle('signed', hasSignature);
  if (elements.status) elements.status.textContent = hasSignature ? 'Firma registrada' : 'Sin firma';
  if (elements.undo) elements.undo.disabled = signatureStrokes.length === 0;
  if (elements.clear) elements.clear.disabled = !hasSignature;
}

function updateSignatureData() {
  const { canvas } = signatureCanvasElements();
  if (!canvas || !signatureStrokes.length) {
    signatureData = '';
    renderSignaturePad();
    return;
  }
  signatureData = canvas.toDataURL('image/png');
  renderSignaturePad();
  scheduleDraftSave();
  if (step === 5) fillReview();
}

function clearSignaturePad(options = {}) {
  signatureData = '';
  signatureStrokes = [];
  activeSignatureStroke = null;
  signatureDrawing = false;
  renderSignaturePad();
  if (!options.silent) {
    scheduleDraftSave();
    if (step === 5) fillReview();
  }
}

function signaturePoint(event) {
  const { canvas } = signatureCanvasElements();
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  };
}

function beginSignature(event) {
  const { canvas, wrap } = signatureCanvasElements();
  if (!canvas || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  resizeSignatureCanvas();
  signatureDrawing = true;
  activeSignatureStroke = [signaturePoint(event)];
  signatureStrokes.push(activeSignatureStroke);
  canvas.setPointerCapture?.(event.pointerId);
  wrap?.classList.add('drawing');
  renderSignaturePad();
}

function moveSignature(event) {
  if (!signatureDrawing || !activeSignatureStroke) return;
  event.preventDefault();
  activeSignatureStroke.push(signaturePoint(event));
  renderSignaturePad();
}

function endSignature(event) {
  if (!signatureDrawing) return;
  event.preventDefault();
  signatureDrawing = false;
  activeSignatureStroke = null;
  signatureCanvasElements().wrap?.classList.remove('drawing');
  updateSignatureData();
}

function initializeSignaturePad() {
  const { canvas, undo, clear } = signatureCanvasElements();
  if (!canvas) return;
  canvas.addEventListener('pointerdown', beginSignature, { passive: false });
  canvas.addEventListener('pointermove', moveSignature, { passive: false });
  canvas.addEventListener('pointerup', endSignature, { passive: false });
  canvas.addEventListener('pointercancel', endSignature, { passive: false });
  canvas.addEventListener('pointerleave', event => {
    if (signatureDrawing && event.pointerType === 'mouse') endSignature(event);
  });
  undo?.addEventListener('click', () => {
    if (signatureStrokes.length) signatureStrokes.pop();
    signatureData = '';
    if (signatureStrokes.length) {
      renderSignaturePad();
      const currentCanvas = signatureCanvasElements().canvas;
      signatureData = currentCanvas.toDataURL('image/png');
    }
    renderSignaturePad();
    scheduleDraftSave();
    if (step === 5) fillReview();
  });
  clear?.addEventListener('click', () => clearSignaturePad());
  window.addEventListener('resize', () => window.requestAnimationFrame(resizeSignatureCanvas));
  window.requestAnimationFrame(() => { resizeSignatureCanvas(); renderSignaturePad(); });
}

initializeSignaturePad();

function mapUrl(gps) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gps.latitude},${gps.longitude}`)}`;
}

function renderGpsState(message = '') {
  const stateBox = $('#gpsState');
  const coordinates = $('#gpsCoordinates');
  const link = $('#gpsPreviewLink');
  const pin = $('#gpsMapPin');
  const mapText = $('#mapStatusText');
  const button = $('#gpsCaptureBtn');
  if (!stateBox) return;

  stateBox.className = 'gps-state';
  pin?.classList.toggle('active', Boolean(currentGps));

  if (currentGps) {
    stateBox.classList.add('success', 'locked');
    stateBox.innerHTML = '<strong>Ubicación registrada y bloqueada</strong><small>Estas coordenadas no pueden modificarse dentro del parte.</small>';
    coordinates.classList.remove('hidden');
    coordinates.innerHTML = `
      <div><span>Latitud</span><strong>${currentGps.latitude.toFixed(6)}</strong></div>
      <div><span>Longitud</span><strong>${currentGps.longitude.toFixed(6)}</strong></div>
      <div><span>Precisión</span><strong>±${Math.round(currentGps.accuracy)} m</strong></div>
    `;
    link.href = mapUrl(currentGps);
    link.classList.remove('hidden');
    mapText.textContent = `Ubicación bloqueada · ±${Math.round(currentGps.accuracy)} m`;
    if (button) {
      button.disabled = true;
      button.classList.add('gps-locked-button');
      button.innerHTML = '<svg><use href="#i-lock"></use></svg> Ubicación bloqueada';
    }
  } else {
    stateBox.classList.add(message ? 'error' : 'idle');
    stateBox.innerHTML = `<strong>${escapeHtml(message || 'Ubicación pendiente')}</strong><small>${message ? 'Revisa el permiso y vuelve a intentarlo.' : 'Debes obtener la ubicación actual para continuar.'}</small>`;
    coordinates.classList.add('hidden');
    link.classList.add('hidden');
    mapText.textContent = message || 'Esperando ubicación';
    if (button) {
      button.disabled = gpsInProgress;
      button.classList.remove('gps-locked-button');
      if (!gpsInProgress) button.innerHTML = '<svg><use href="#i-pin"></use></svg> Obtener ubicación actual';
    }
  }
}

function captureGps(automatic = false) {
  if (currentGps) {
    showToast('Ubicación bloqueada', 'La captura ya quedó asociada al parte y no puede modificarse.');
    return;
  }
  if (gpsInProgress) return;
  const button = $('#gpsCaptureBtn');

  if (!navigator.geolocation) {
    renderGpsState('Este dispositivo no admite ubicación GPS');
    updateGpsSystem(false);
    return;
  }

  gpsInProgress = true;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<svg><use href="#i-refresh"></use></svg> Buscando ubicación…';
  }
  const stateBox = $('#gpsState');
  stateBox.className = 'gps-state loading';
  stateBox.innerHTML = `<strong>Buscando ubicación actual…</strong><small>${automatic ? 'Mantén activa la ubicación del teléfono.' : 'Esto puede demorar algunos segundos.'}</small>`;
  $('#mapStatusText').textContent = 'Buscando señal GPS…';

  const finish = () => {
    gpsInProgress = false;
    renderGpsState();
  };

  navigator.geolocation.getCurrentPosition(position => {
    const capturedAt = new Date().toISOString();
    currentGps = Object.freeze({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude,
      heading: position.coords.heading,
      speed: position.coords.speed,
      positionTimestamp: new Date(position.timestamp || Date.now()).toISOString(),
      capturedAt
    });
    updateGpsSystem(true);
    scheduleDraftSave();
    finish();
  }, error => {
    const messages = {
      1: 'Permiso de ubicación denegado',
      2: 'No se pudo determinar la ubicación',
      3: 'La búsqueda de GPS demoró demasiado'
    };
    gpsInProgress = false;
    renderGpsState(messages[error.code] || 'No se pudo obtener la ubicación');
    updateGpsSystem(false);
  }, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
  });
}

function updateGpsSystem(ok) {
  $('#gpsSystemStatus').textContent = ok ? 'Disponible' : 'Revisar permiso';
  $('#gpsStatusDot').classList.toggle('ok', ok);
}

$('#gpsCaptureBtn')?.addEventListener('click', () => captureGps(false));

function renderLocations() {
  const records = state.records.filter(record => record.gps);
  const list = $('#locationList');
  $('#gpsRecordCount').textContent = formatNumber(records.length);
  $('#gpsAverageAccuracy').textContent = records.length
    ? `±${Math.round(records.reduce((sum, record) => sum + (Number(record.gps.accuracy) || 0), 0) / records.length)} m`
    : '—';
  $('#gpsLastCapture').textContent = records[0]?.gps?.capturedAt ? formatDateTime(records[0].gps.capturedAt) : '—';

  if (!records.length) {
    list.innerHTML = '<div class="empty-state">Todavía no hay partes con ubicación GPS.</div>';
    return;
  }

  list.innerHTML = records.map(record => `
    <article class="location-item">
      <span class="location-pin"><svg><use href="#i-pin"></use></svg></span>
      <div class="location-copy"><strong>${escapeHtml(record.monte)} · ${escapeHtml(record.maquina)}</strong><span>${recordDateTimeLabel(record)} · ${escapeHtml(record.operador)}</span><small>${record.gps.latitude.toFixed(6)}, ${record.gps.longitude.toFixed(6)} · ±${Math.round(record.gps.accuracy)} m</small></div>
      <a class="btn btn-soft" href="${mapUrl(record.gps)}" target="_blank" rel="noopener"><svg><use href="#i-external"></use></svg> Abrir mapa</a>
    </article>
  `).join('');
}

$('#gpsRefreshBtn')?.addEventListener('click', renderLocations);

function showToast(title, text) {
  window.clearTimeout(toastTimer);
  $('#toastTitle').textContent = title;
  $('#toastText').textContent = text;
  $('#toast').classList.remove('hidden');
  toastTimer = window.setTimeout(() => $('#toast').classList.add('hidden'), 3200);
}

window.LubaydToast = showToast;

function syncNetworkStatus() {
  if (!navigator.onLine) {
    applyCloudStatus('Sin conexión', false, 'Trabajando con datos locales');
  } else {
    applyCloudStatus(currentCloudStatus.text, currentCloudStatus.ok, currentCloudStatus.detail);
  }
}

function setCloudStatus(text, ok, detail = '') {
  currentCloudStatus = { text, ok, detail: detail || (ok ? 'Datos actualizados' : 'Revisando conexión') };
  syncNetworkStatus();
}

function applyCloudStatus(text, ok, detail) {
  const network = $('#networkStatus');
  network.classList.toggle('offline', !ok || !navigator.onLine);
  network.querySelector('b').textContent = text;
  $('#lastSyncLabel').textContent = detail;
  $('#sidebarSyncTitle').textContent = navigator.onLine ? text : 'Sin conexión';
  $('#sidebarSyncText').textContent = navigator.onLine ? detail : 'Los cambios quedarán pendientes';
  $('#cloudSystemStatus').textContent = text;
}

function scheduleAutomaticSync(delay = 0) {
  window.setTimeout(() => {
    if (!currentUser()) return;
    // Siempre se intenta. Si el Redmi todavía no tiene red, fetch falla y la cola
    // permanece pendiente sin perder datos.
    Promise.allSettled([
      window.LubaydSyncOfflineAttendance?.({ silent: true }),
      syncPendingParts({ silent: true })
    ]).catch(() => {});
  }, Math.max(0, delay));
}

function resumeAndroidSync(delay = 350) {
  syncNetworkStatus();
  updateOfflinePreparationUi();
  if (!offlineSession) authorizeCurrentDeviceForOperator({ silent: true }).catch(() => null);
  scheduleAutomaticSync(delay);
  scheduleAutomaticSync(delay + 2500);
  if (!offlineSession && window.LubaydCloud?.available && !cloudUnsubscribe) startCloudSync();
}

window.addEventListener('online', () => resumeAndroidSync(150));
window.addEventListener('load', () => resumeAndroidSync(1800));
window.addEventListener('pageshow', () => resumeAndroidSync(450));
window.addEventListener('focus', () => resumeAndroidSync(300));
window.addEventListener('resume', () => resumeAndroidSync(250));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeAndroidSync(250);
});
window.addEventListener('offline', () => { syncNetworkStatus(); updateOfflinePreparationUi(); });
periodicSyncTimer = window.setInterval(() => {
  if (currentUser() && document.visibilityState === 'visible') scheduleAutomaticSync(0);
}, 15000);

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebarOverlay').classList.remove('show');
}

$('#menuBtn')?.addEventListener('click', () => {
  $('#sidebar').classList.toggle('open');
  $('#sidebarOverlay').classList.toggle('show');
});
$('#sidebarOverlay')?.addEventListener('click', closeSidebar);

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstall = event;
  $('#installBtn').classList.remove('hidden');
});

$('#installBtn')?.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('#installBtn').classList.add('hidden');
});

window.addEventListener('appinstalled', () => $('#installBtn').classList.add('hidden'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js?v=20.8.7', { scope: './', updateViaCache: 'none' });
      registration.update().catch(() => {});
      window.addEventListener('focus', () => registration.update().catch(() => {}));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
      if (registration.waiting) {
        waitingWorker = registration.waiting;
        $('#updateBanner').classList.remove('hidden');
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = worker;
            $('#updateBanner').classList.remove('hidden');
          }
        });
      });
    } catch (error) {
      console.error('Registro PWA:', error);
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => { saveCurrentScrollPosition(); window.location.reload(); });
}

$('#updateBtn')?.addEventListener('click', () => waitingWorker?.postMessage({ type: 'SKIP_WAITING' }));

async function startCloudSync() {
  if (offlineSession || !hasOnlineFirebaseSession()) {
    setCloudStatus(navigator.onLine ? 'Sesión offline' : 'Sin conexión', false, 'Los datos locales permanecen disponibles');
    return;
  }
  if (!currentUser()) {
    setCloudStatus('Sesión requerida', false, 'Inicia sesión para sincronizar');
    return;
  }
  if (!window.LubaydCloud?.available) {
    setCloudStatus('Solo local', false, 'Firebase no está disponible');
    return;
  }

  setCloudStatus('Conectando…', false, 'Iniciando sincronización segura');
  try {
    cloudUnsubscribe?.();
    cloudUnsubscribe = window.LubaydCloud.subscribe((records, metadata) => {
      const pendingLocal = state.records.filter(item => item.syncStatus && item.syncStatus !== 'synced');
      const merged = new Map(records.map(item => [item.id, { ...item, syncStatus: 'synced', syncError: '' }]));
      pendingLocal.forEach(item => merged.set(item.id, item));
      state.save(Array.from(merged.values()));
      renderAll();
      if ($('#historial')?.classList.contains('active')) renderHistory();
      if ($('#ubicaciones')?.classList.contains('active')) renderLocations();
      if (typeof window.renderCharts === 'function' && $('#graficos')?.classList.contains('active')) window.renderCharts();

      const detail = metadata.fromCache ? 'Mostrando caché local' : `Actualizado ${formatTime(new Date())}`;
      setCloudStatus(metadata.hasPendingWrites ? 'Sincronizando…' : (metadata.fromCache ? 'Datos locales' : 'Sincronizado'), !metadata.hasPendingWrites, detail);
    }, error => {
      console.error('Escucha Firestore:', error);
      setCloudStatus('Error de sincronización', false, 'Los datos locales siguen disponibles');
    });
  } catch (error) {
    console.error('Inicio Firestore:', error);
    setCloudStatus('Pendiente', false, 'No se pudo iniciar la nube');
  }
}

window.addEventListener('lubayd-firebase-ready', () => {
  if (!currentUser()) return;
  startCloudSync();
  window.setTimeout(() => syncPendingParts({ silent: true }).catch(console.warn), 1200);
});
window.addEventListener('lubayd-firebase-error', () => setCloudStatus('Solo local', false, 'Firebase no está disponible'));

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseRecordDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseRecordDate(value);
  return date ? date.toLocaleDateString('es-UY') : '—';
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' });
}

function formatTime(date) {
  return date.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
}

function formatTimeValue(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : formatTime(date);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('es-UY', { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 ? 0 : 0 });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

window.addEventListener('pageshow', () => refreshOfflineAccess({ silent: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !currentUser()) refreshOfflineAccess({ silent: true });
});
window.addEventListener('online', () => { if (!currentUser()) refreshOfflineAccess({ silent: true }); });
window.addEventListener('offline', () => { if (!currentUser()) refreshOfflineAccess({ silent: true }); });

syncNetworkStatus();
refreshOfflineAccess({ silent: true });
updateOfflinePreparationUi();

window.addEventListener('scroll', () => {
  window.clearTimeout(navigationScrollTimer);
  navigationScrollTimer = window.setTimeout(saveCurrentScrollPosition, 120);
}, { passive: true });
window.addEventListener('pagehide', saveCurrentScrollPosition);
window.addEventListener('beforeunload', saveCurrentScrollPosition);

if (window.LubaydCurrentUser) handleAuthChange(window.LubaydCurrentUser);
else window.setTimeout(() => restoreOfflineSessionIfAvailable(), 150);
