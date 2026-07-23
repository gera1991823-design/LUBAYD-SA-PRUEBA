/* Lubayd SA V22.4.0 - Firebase dinamico; el acceso offline nunca depende de Internet */
(function () {
  'use strict';
  const { config, normalizeEmail, clone, emit } = window.Lubayd;
  let auth = null;
  let db = null;
  let functions = null;
  let messaging = null;
  let ready = false;
  let initializing = null;
  let observerStarted = false;
  let authStateKnown = false;
  let authStateUser = null;
  const authWaiters = new Set();

  function normalize(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  }
  function networkError(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return !navigator.onLine || code.includes('network') || code.includes('unavailable') || message.includes('network') || message.includes('offline') || message.includes('conex');
  }
  function errorMessage(error) {
    const code = String(error?.code || '');
    const map = {
      'auth/invalid-email': 'El correo electrónico no es válido.',
      'auth/missing-password': 'Ingresá la contraseña.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'Correo o contraseña incorrectos.',
      'auth/wrong-password': 'Correo o contraseña incorrectos.',
      'auth/user-disabled': 'Esta cuenta está desactivada.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y volvé a probar.',
      'auth/network-request-failed': 'No se pudo conectar. Elegí Offline para ingresar sin internet.',
      'functions/unauthenticated': 'La autorización del teléfono venció. Iniciá sesión Online una vez.',
      'functions/permission-denied': 'Este usuario o dispositivo no está autorizado.',
      'permission-denied': 'Firebase rechazó la operación. Revisá reglas y permisos.'
    };
    return map[code] || error?.message || 'No se pudo completar la operación.';
  }
  async function withTimeout(promise, milliseconds, message) {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message || 'La operación demoró demasiado.')), milliseconds); });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }
  function loadScript(url, test, timeoutMs = 15000) {
    if (test()) return Promise.resolve(true);
    const existing = Array.from(document.scripts).find(script => script.src === url);
    if (existing) {
      return withTimeout(new Promise((resolve, reject) => {
        if (test()) return resolve(true);
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar Firebase.')), { once: true });
      }), timeoutMs, 'Firebase demoró demasiado en cargar.');
    }
    return withTimeout(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('No se pudo cargar Firebase.'));
      document.head.appendChild(script);
    }), timeoutMs, 'Firebase demoró demasiado en cargar.');
  }
  async function loadFirebaseSdk() {
    if (!navigator.onLine) return false;
    const version = config.firebaseSdkVersion || '10.14.1';
    const base = `https://www.gstatic.com/firebasejs/${version}`;
    await loadScript(`${base}/firebase-app-compat.js`, () => Boolean(window.firebase));
    await loadScript(`${base}/firebase-auth-compat.js`, () => Boolean(window.firebase?.auth));
    await loadScript(`${base}/firebase-firestore-compat.js`, () => Boolean(window.firebase?.firestore));
    await loadScript(`${base}/firebase-functions-compat.js`, () => Boolean(window.firebase?.functions));
    try { await loadScript(`${base}/firebase-messaging-compat.js`, () => Boolean(window.firebase?.messaging), 9000); } catch (_) {}
    return true;
  }
  function settleAuthState(user) {
    authStateKnown = true;
    authStateUser = user || null;
    for (const resolve of authWaiters) resolve(authStateUser);
    authWaiters.clear();
  }
  async function initializeInternal() {
    if (ready) return true;
    if (!navigator.onLine) return false;
    await loadFirebaseSdk();
    if (!window.firebase) return false;
    if (!firebase.apps.length) firebase.initializeApp(config.firebase);
    auth = firebase.auth();
    db = firebase.firestore();
    functions = firebase.app().functions(config.functionsRegion || 'southamerica-east1');
    try {
      const supported = typeof firebase.messaging?.isSupported === 'function' ? await firebase.messaging.isSupported() : Boolean(firebase.messaging);
      messaging = supported && firebase.messaging ? firebase.messaging() : null;
    } catch (_) { messaging = null; }
    try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (error) { console.warn('[Lubayd] Persistencia Auth:', error); }
    db.enablePersistence({ synchronizeTabs: true }).catch(error => {
      if (!['failed-precondition', 'unimplemented'].includes(error?.code)) console.warn('[Lubayd] Persistencia Firestore:', error);
    });
    ready = true;
    window.Lubayd.state.firebaseReady = true;
    if (!observerStarted) {
      observerStarted = true;
      auth.onAuthStateChanged(user => {
        settleAuthState(user);
        if (user) processPersistedUser(user);
        else emit('lubayd-cloud-signed-out', {});
      }, error => {
        settleAuthState(null);
        console.warn('[Lubayd] Auth observer:', error);
      });
    }
    emit('lubayd-cloud-ready', { available: true });
    return true;
  }
  async function ensureReady(milliseconds = 18000) {
    if (ready) return true;
    if (!navigator.onLine) return false;
    if (!initializing) {
      initializing = initializeInternal().catch(error => {
        console.warn('[Lubayd] Firebase:', error);
        emit('lubayd-cloud-ready', { available: false, error });
        return false;
      }).finally(() => { if (!ready) initializing = null; });
    }
    return withTimeout(initializing, milliseconds, 'No se pudo iniciar la conexión online.').catch(() => false);
  }
  async function waitForAuthState(milliseconds = 8000) {
    const available = await ensureReady(Math.max(milliseconds, 10000));
    if (!available || !auth) return null;
    if (authStateKnown) return authStateUser;
    return new Promise(resolve => {
      const done = value => { clearTimeout(timer); authWaiters.delete(done); resolve(value || null); };
      const timer = setTimeout(() => done(auth?.currentUser || null), milliseconds);
      authWaiters.add(done);
    });
  }
  async function profileFor(user) {
    if (!user) return null;
    const fallback = { uid: user.uid, nombre: user.displayName || user.email?.split('@')[0] || 'Usuario', email: user.email || '', role: 'operador', active: false };
    if (!db) return fallback;
    try {
      const snapshot = await withTimeout(db.collection('usuarios').doc(user.uid).get(), 8000, 'No se pudo leer el perfil.');
      return snapshot.exists ? Object.assign({}, fallback, normalize(snapshot.data()), { uid: user.uid }) : fallback;
    } catch (error) {
      const local = await window.LubaydOffline?.findProfileByEmail?.(user.email || '').catch(() => null);
      if (local?.profile) return Object.assign({}, fallback, local.profile, { uid: user.uid });
      throw error;
    }
  }
  async function cacheProfile(user, profile) {
    const existing = await window.LubaydOffline?.get?.('profiles', user.uid).catch(() => null);
    if (!existing) return;
    existing.email = normalizeEmail(user.email);
    existing.profile = Object.assign({}, existing.profile || {}, clone(profile || {}), { uid: user.uid, email: user.email || '' });
    existing.updatedAt = new Date().toISOString();
    await window.LubaydOffline.put('profiles', existing);
  }
  async function authorizeDevice(user) {
    if (!(await ensureReady()) || !functions || !user || !window.LubaydOffline) return null;
    const local = await window.LubaydOffline.get('profiles', user.uid).catch(() => null);
    if (!local?.deviceId) return null;
    const callable = functions.httpsCallable('authorizeOfflineDevice');
    const result = await withTimeout(callable({ deviceId: local.deviceId, userAgent: navigator.userAgent.slice(0, 400), appVersion: config.version }), 16000, 'No se pudo autorizar este teléfono.');
    const data = result?.data || {};
    if (!data.deviceSecret) throw new Error('Firebase no devolvió la autorización del teléfono.');
    await window.LubaydOffline.saveDeviceAuthorization(user.uid, { deviceId: local.deviceId, deviceSecret: data.deviceSecret, expiresAt: data.expiresAt || '' });
    return data;
  }
  async function loginOnline(email, password) {
    if (!(await ensureReady()) || !auth) throw new Error('No se pudo iniciar Firebase. Revisá internet.');
    const credential = await auth.signInWithEmailAndPassword(normalizeEmail(email), password);
    const profile = await profileFor(credential.user);
    if (profile?.active === false) {
      await auth.signOut();
      const error = new Error('Esta cuenta está desactivada.');
      error.code = 'auth/user-disabled';
      throw error;
    }
    await window.LubaydOffline.saveCredential(credential.user, profile, password);
    try { await authorizeDevice(credential.user); } catch (error) { console.warn('[Lubayd] Autorización offline:', error); }
    window.Lubayd.state.user = credential.user;
    window.Lubayd.state.profile = profile;
    window.Lubayd.state.offlineSession = false;
    emit('lubayd-session-ready', { user: credential.user, profile, offline: false, mode: 'online', source: 'login' });
    return { user: credential.user, profile };
  }
  async function register(name, email, password) {
    if (!(await ensureReady()) || !auth || !db) throw new Error('Se necesita conexión para crear una cuenta.');
    const credential = await auth.createUserWithEmailAndPassword(normalizeEmail(email), password);
    const cleanName = String(name || '').trim();
    if (cleanName) await credential.user.updateProfile({ displayName: cleanName });
    const profile = {
      nombre: cleanName || credential.user.email?.split('@')[0] || 'Usuario', email: credential.user.email || normalizeEmail(email),
      role: 'operador', active: false, createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('usuarios').doc(credential.user.uid).set(profile, { merge: true });
    await auth.signOut();
    return true;
  }
  async function logout() { if (auth?.currentUser) await auth.signOut(); }
  async function resetPassword(email) {
    if (!(await ensureReady()) || !auth) throw new Error('Se necesita conexión para recuperar la contraseña.');
    return auth.sendPasswordResetEmail(normalizeEmail(email));
  }
  async function call(name, data) {
    if (!(await ensureReady()) || !functions) throw new Error('Firebase Functions no está disponible.');
    return (await functions.httpsCallable(name)(data)).data;
  }
  function collection(name) { if (!db) throw new Error('Firestore no está disponible.'); return db.collection(name); }
  function currentUser() { return auth?.currentUser || null; }
  async function processPersistedUser(user) {
    if (!user || window.Lubayd.state.offlineSession) return;
    try {
      const profile = await profileFor(user);
      if (profile?.active === false) { await auth.signOut(); return; }
      await cacheProfile(user, profile).catch(() => {});
      window.Lubayd.state.user = user;
      window.Lubayd.state.profile = profile;
      window.Lubayd.state.offlineSession = false;
      emit('lubayd-session-ready', { user, profile, offline: false, mode: 'online', source: 'persisted' });
    } catch (error) { console.warn('[Lubayd] Sesión persistida no verificada:', error); }
  }

  window.LubaydCloud = {
    get ready() { return ready; }, get auth() { return auth; }, get db() { return db; }, get functions() { return functions; }, get messaging() { return messaging; },
    normalize, networkError, errorMessage, profileFor, authorizeDevice, loginOnline, register, logout, resetPassword, call, collection, currentUser, waitForAuthState, ensureReady
  };

  if (navigator.onLine) ensureReady().catch(() => {});
  else emit('lubayd-cloud-ready', { available: false, offline: true });
  window.addEventListener('online', () => ensureReady().catch(() => {}));
})();
