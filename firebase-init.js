/* Lubayd SA V21.0.1 - Firebase Auth + acceso offline universal */
(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyCQDwcbAox4QEDe_czZX_YSd9jVx9g5BkY',
    authDomain: 'lubayd-sa.firebaseapp.com',
    projectId: 'lubayd-sa',
    storageBucket: 'lubayd-sa.firebasestorage.app',
    messagingSenderId: '916029913982',
    appId: '1:916029913982:web:cc4e5b02b8b8055171d12f',
    measurementId: 'G-LVP0TWS84N'
  };

  let auth = null;
  let db = null;
  let firebaseReady = false;
  let authObserverStarted = false;

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isNetworkError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return !navigator.onLine ||
      code.includes('network-request-failed') ||
      code.includes('unavailable') ||
      message.includes('network') ||
      message.includes('conexión') ||
      message.includes('conexion') ||
      message.includes('offline');
  }

  function authErrorMessage(error) {
    const code = String(error?.code || '');
    const messages = {
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/wrong-password': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'Correo o contraseña incorrectos.',
      'auth/invalid-email': 'El correo electrónico no es válido.',
      'auth/user-disabled': 'Esta cuenta está desactivada.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
      'auth/network-request-failed': 'No hay conexión. Este usuario debe iniciar sesión online una vez en este teléfono antes de usar el acceso offline.'
    };
    return messages[code] || error?.message || 'No se pudo iniciar sesión.';
  }

  function dispatchAuthState(user, profile, error) {
    const detail = { user: user || null, profile: profile || null, error: error || null };
    window.LubaydLastAuthState = detail;
    window.dispatchEvent(new CustomEvent('lubayd-auth-state', { detail }));
  }

  async function readProfile(user) {
    if (!user) return null;
    const fallback = {
      uid: user.uid,
      nombre: user.displayName || user.email?.split('@')[0] || 'Usuario',
      email: user.email || '',
      role: 'operador',
      active: true
    };

    if (!db) return fallback;

    try {
      const snapshot = await db.collection('usuarios').doc(user.uid).get();
      if (!snapshot.exists) return fallback;
      return Object.assign({}, fallback, snapshot.data(), { uid: user.uid });
    } catch (error) {
      console.warn('[Lubayd] Perfil desde caché/local:', error);
      try {
        const local = await window.LubaydOffline?.getProfileByEmail?.(user.email || '');
        return local || fallback;
      } catch (_) {
        return fallback;
      }
    }
  }

  async function prepareOfflineCredential(user, profile, password) {
    if (!window.LubaydOffline?.savePasswordCredential) {
      console.warn('[Lubayd] offline-store.js todavía no está disponible.');
      return;
    }
    await window.LubaydOffline.savePasswordCredential(user, profile, password);
  }

  async function offlineLogin(email, password) {
    if (!window.LubaydOffline?.loginWithPassword) {
      throw new Error('El módulo offline no está disponible. Actualiza la aplicación con internet.');
    }
    const result = await window.LubaydOffline.loginWithPassword(normalizeEmail(email), password);
    const localUser = {
      uid: result.profile.uid,
      email: result.profile.email || normalizeEmail(email),
      displayName: result.profile.nombre || '',
      isOffline: true
    };
    window.dispatchEvent(new CustomEvent('lubayd-offline-unlock', {
      detail: { user: localUser, profile: result.profile }
    }));
    return { user: localUser, offline: true };
  }

  async function login(email, password) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) throw new Error('Escribe el correo y la contraseña.');

    if (!navigator.onLine || !firebaseReady || !auth) {
      return offlineLogin(normalizedEmail, password);
    }

    try {
      const credential = await auth.signInWithEmailAndPassword(normalizedEmail, password);
      const profile = await readProfile(credential.user);
      if (profile?.active === false) {
        await auth.signOut();
        throw Object.assign(new Error('Esta cuenta está desactivada.'), { code: 'auth/user-disabled' });
      }
      await prepareOfflineCredential(credential.user, profile, password);
      return credential;
    } catch (error) {
      if (isNetworkError(error)) return offlineLogin(normalizedEmail, password);
      throw error;
    }
  }

  async function register(name, email, password) {
    if (!firebaseReady || !auth || !db) throw new Error('Se necesita conexión para crear una cuenta.');
    const credential = await auth.createUserWithEmailAndPassword(normalizeEmail(email), password);
    const cleanName = String(name || '').trim();
    if (cleanName) await credential.user.updateProfile({ displayName: cleanName });
    const profile = {
      nombre: cleanName || credential.user.email?.split('@')[0] || 'Usuario',
      email: credential.user.email || normalizeEmail(email),
      role: 'operador',
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('usuarios').doc(credential.user.uid).set(profile, { merge: true });
    await prepareOfflineCredential(credential.user, profile, password);
    return credential;
  }

  async function logout() {
    if (auth?.currentUser) await auth.signOut();
  }

  async function resetPassword(email) {
    if (!firebaseReady || !auth) throw new Error('Se necesita conexión para recuperar la contraseña.');
    return auth.sendPasswordResetEmail(normalizeEmail(email));
  }

  async function startFirebase() {
    if (!window.firebase) {
      console.warn('[Lubayd] Firebase SDK no cargó. El acceso offline seguirá disponible.');
      return;
    }

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (error) {
      console.warn('[Lubayd] Persistencia de Auth:', error);
    }

    try {
      await db.enablePersistence({ synchronizeTabs: true });
    } catch (error) {
      if (!['failed-precondition', 'unimplemented'].includes(error?.code)) {
        console.warn('[Lubayd] Persistencia de Firestore:', error);
      }
    }

    firebaseReady = true;

    if (!authObserverStarted) {
      authObserverStarted = true;
      auth.onAuthStateChanged(async user => {
        try {
          if (!user) {
            dispatchAuthState(null, null, null);
            return;
          }
          const profile = await readProfile(user);
          dispatchAuthState(user, profile, null);
        } catch (error) {
          dispatchAuthState(null, null, error);
        }
      }, error => dispatchAuthState(null, null, error));
    }

    window.dispatchEvent(new CustomEvent('lubayd-cloud-ready'));
  }

  window.LubaydFirebase = {
    available: () => firebaseReady,
    get auth() { return auth; },
    get db() { return db; },
    get FieldValue() { return window.firebase?.firestore?.FieldValue || null; },
    login,
    register,
    logout,
    resetPassword,
    readProfile,
    authErrorMessage,
    isNetworkError
  };

  // Compatibilidad con módulos anteriores que consultan LubaydCloud.
  window.LubaydCloud = {
    get available() { return Boolean(db); },
    subscribe(onData, onError) {
      if (!db) throw new Error('Firestore no está disponible.');
      return db.collection('partes').onSnapshot({ includeMetadataChanges: true }, snapshot => {
        const records = snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
        onData(records, {
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites
        });
      }, onError);
    },
    save(record) {
      if (!db) return Promise.reject(new Error('Firestore no está disponible.'));
      return db.collection('partes').doc(record.id).set(record, { merge: true });
    },
    remove(id) {
      if (!db) return Promise.reject(new Error('Firestore no está disponible.'));
      return db.collection('partes').doc(id).delete();
    }
  };

  startFirebase().catch(error => {
    console.error('[Lubayd] Firebase:', error);
    dispatchAuthState(null, null, error);
  });
})();
