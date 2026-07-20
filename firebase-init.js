/* Lubayd SA V20.4 - Firebase Authentication and Firestore */
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

  function normalize(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    }
    return value;
  }

  function authErrorMessage(error) {
    const map = {
      'auth/invalid-email': 'El correo electrónico no es válido.',
      'auth/missing-password': 'Ingresa la contraseña.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'No existe una cuenta con ese correo.',
      'auth/wrong-password': 'La contraseña es incorrecta.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
      'auth/network-request-failed': 'No se pudo conectar con Firebase.',
      'auth/operation-not-allowed': 'Habilita el acceso por correo y contraseña en Firebase Authentication.',
      'permission-denied': 'Firebase rechazó la operación. Publica las reglas incluidas en esta versión.'
    };
    return map[error?.code] || error?.message || 'No se pudo completar la operación.';
  }

  try {
    if (!window.firebase) throw new Error('Firebase SDK no disponible.');
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth = firebase.auth();
    const db = firebase.firestore();
    const FieldValue = firebase.firestore.FieldValue;

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);
    db.enablePersistence({ synchronizeTabs: true }).catch(function (error) {
      if (!['failed-precondition', 'unimplemented'].includes(error.code)) console.warn('Persistencia Firestore:', error);
    });

    async function getProfile(user) {
      if (!user) return null;
      const ref = db.collection('usuarios').doc(user.uid);
      const snapshot = await ref.get();
      if (snapshot.exists) return Object.assign({ uid: user.uid }, normalize(snapshot.data()));

      const fallback = {
        nombre: user.displayName || user.email?.split('@')[0] || 'Usuario',
        email: user.email || '',
        role: 'operador',
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };
      await ref.set(fallback, { merge: true });
      return Object.assign({ uid: user.uid }, normalize(fallback));
    }

    window.LubaydFirebase = {
      available: true,
      config: firebaseConfig,
      auth,
      db,
      FieldValue,
      normalize,
      authErrorMessage,
      currentUser: () => auth.currentUser,
      currentProfile: () => window.LubaydCurrentProfile || null,
      async login(email, password) {
        return auth.signInWithEmailAndPassword(String(email || '').trim(), password);
      },
      async register(name, email, password) {
        const credential = await auth.createUserWithEmailAndPassword(String(email || '').trim(), password);
        await credential.user.updateProfile({ displayName: String(name || '').trim() });
        await db.collection('usuarios').doc(credential.user.uid).set({
          nombre: String(name || '').trim(),
          email: credential.user.email || '',
          role: 'operador',
          active: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return credential;
      },
      resetPassword(email) {
        return auth.sendPasswordResetEmail(String(email || '').trim());
      },
      logout() {
        return auth.signOut();
      },
      getProfile
    };

    auth.onAuthStateChanged(async function (user) {
      let profile = null;
      let error = null;
      if (user) {
        try {
          profile = await getProfile(user);
        } catch (err) {
          error = err;
          console.error('Perfil de usuario:', err);
        }
      }
      window.LubaydLastAuthState = { user, profile, error };
      window.dispatchEvent(new CustomEvent('lubayd-auth-state', { detail: window.LubaydLastAuthState }));
    });
  } catch (error) {
    console.error(error);
    window.LubaydFirebase = { available: false, error, authErrorMessage };
    window.LubaydLastAuthState = { user: null, profile: null, error };
    window.dispatchEvent(new CustomEvent('lubayd-auth-state', { detail: window.LubaydLastAuthState }));
  }
})();
