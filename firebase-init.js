/* Lubayd SA V22.1.1 - Firebase y sesion online no bloqueante */
(function () {
  'use strict';
  const { config, normalizeEmail, clone, emit } = window.Lubayd;
  let auth = null;
  let db = null;
  let functions = null;
  let messaging = null;
  let ready = false;
  let observerStarted = false;

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
      'auth/missing-password': 'Ingresa la contraseña.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'Correo o contraseña incorrectos.',
      'auth/wrong-password': 'Correo o contraseña incorrectos.',
      'auth/user-disabled': 'Esta cuenta está desactivada.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
      'auth/network-request-failed': 'No se pudo conectar. Revisa internet o ingresa en modo offline.',
      'functions/unauthenticated': 'La autorización del teléfono venció. Inicia sesión online una vez.',
      'functions/permission-denied': 'Este usuario o dispositivo no está autorizado.',
      'permission-denied': 'Firebase rechazó la operación. Revisa las reglas y los permisos.'
    };
    return map[code] || error?.message || 'No se pudo completar la operación.';
  }
  async function timeout(promise, milliseconds, message) {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message || 'La operación demoró demasiado.')), milliseconds); });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }
  async function profileFor(user) {
    if (!user) return null;
    const fallback = { uid: user.uid, nombre: user.displayName || user.email?.split('@')[0] || 'Usuario', email: user.email || '', role: 'operador', active: false };
    if (!db) return fallback;
    try {
      const snapshot = await timeout(db.collection('usuarios').doc(user.uid).get(), 7000, 'No se pudo leer el perfil.');
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
    if (!functions || !user || !window.LubaydOffline) return null;
    const local = await window.LubaydOffline.get('profiles', user.uid).catch(() => null);
    if (!local?.deviceId) return null;
    const callable = functions.httpsCallable('authorizeOfflineDevice');
    const result = await timeout(callable({ deviceId: local.deviceId, userAgent: navigator.userAgent.slice(0, 400), appVersion: config.version }), 15000, 'No se pudo autorizar este teléfono.');
    const data = result?.data || {};
    if (!data.deviceSecret) throw new Error('Firebase no devolvió la autorización del teléfono.');
    await window.LubaydOffline.saveDeviceAuthorization(user.uid, { deviceId: local.deviceId, deviceSecret: data.deviceSecret, expiresAt: data.expiresAt || '' });
    return data;
  }
  async function loginOnline(email, password) {
    if (!ready || !auth) throw new Error('Firebase todavía no está disponible.');
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
    emit('lubayd-session-ready', { user: credential.user, profile, offline: false, source: 'login' });
    return { user: credential.user, profile };
  }
  async function register(name, email, password) {
    if (!ready || !auth || !db) throw new Error('Se necesita conexión para crear una cuenta.');
    const credential = await auth.createUserWithEmailAndPassword(normalizeEmail(email), password);
    const cleanName = String(name || '').trim();
    if (cleanName) await credential.user.updateProfile({ displayName: cleanName });
    const profile = {
      nombre: cleanName || credential.user.email?.split('@')[0] || 'Usuario',
      email: credential.user.email || normalizeEmail(email),
      role: 'operador',
      active: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('usuarios').doc(credential.user.uid).set(profile, { merge: true });
    await auth.signOut();
    return true;
  }
  async function logout() { if (auth?.currentUser) await auth.signOut(); }
  async function resetPassword(email) {
    if (!ready || !auth || !navigator.onLine) throw new Error('Se necesita conexión para recuperar la contraseña.');
    return auth.sendPasswordResetEmail(normalizeEmail(email));
  }
  async function call(name, data) {
    if (!functions) throw new Error('Firebase Functions no está disponible.');
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
      emit('lubayd-session-ready', { user, profile, offline: false, source: 'persisted' });
    } catch (error) {
      console.warn('[Lubayd] Sesión persistida no verificada:', error);
      // La pantalla de ingreso permanece visible; nunca se muestra una espera bloqueante.
    }
  }
  async function initialize() {
    if (!window.firebase) {
      console.warn('[Lubayd] Firebase SDK no cargó. El acceso offline sigue disponible.');
      emit('lubayd-cloud-ready', { available: false });
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(config.firebase);
    auth = firebase.auth();
    db = firebase.firestore();
    functions = firebase.app().functions(config.functionsRegion || 'southamerica-east1');
    try {
      const messagingSupported = typeof firebase.messaging.isSupported === 'function' ? await firebase.messaging.isSupported() : true;
      messaging = messagingSupported ? firebase.messaging() : null;
    } catch (_) { messaging = null; }
    try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (error) { console.warn('Persistencia Auth:', error); }
    db.enablePersistence({ synchronizeTabs: true }).catch(error => {
      if (!['failed-precondition', 'unimplemented'].includes(error?.code)) console.warn('Persistencia Firestore:', error);
    });
    ready = true;
    window.Lubayd.state.firebaseReady = true;
    if (!observerStarted) {
      observerStarted = true;
      auth.onAuthStateChanged(user => {
        if (user) processPersistedUser(user);
        else emit('lubayd-cloud-signed-out', {});
      }, error => console.warn('[Lubayd] Auth observer:', error));
    }
    emit('lubayd-cloud-ready', { available: true });
  }

  window.LubaydCloud = {
    get ready() { return ready; }, get auth() { return auth; }, get db() { return db; }, get functions() { return functions; }, get messaging() { return messaging; },
    normalize, networkError, errorMessage, profileFor, authorizeDevice, loginOnline, register, logout, resetPassword, call, collection, currentUser
  };
  initialize().catch(error => {
    console.error('[Lubayd Firebase]', error);
    emit('lubayd-cloud-ready', { available: false, error });
  });
})();
