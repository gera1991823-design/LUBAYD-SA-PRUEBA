/* Lubayd SA - Firebase Authentication + Cloud Firestore */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyCQDwcbAox4QEDe_czZX_YSd9jVx9g5BkY",
    authDomain: "lubayd-sa.firebaseapp.com",
    projectId: "lubayd-sa",
    storageBucket: "lubayd-sa.firebasestorage.app",
    messagingSenderId: "916029913982",
    appId: "1:916029913982:web:cc4e5b02b8b8055171d12f",
    measurementId: "G-LVP0TWS84N"
  };

  function normalizeFirestoreValue(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], normalizeFirestoreValue(entry[1])];
      }));
    }
    return value;
  }

  function authErrorMessage(error) {
    const messages = {
      'auth/invalid-email': 'El correo electrónico no es válido.',
      'auth/missing-password': 'Ingresa la contraseña.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'No existe una cuenta con ese correo.',
      'auth/wrong-password': 'La contraseña es incorrecta.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
      'auth/network-request-failed': 'No se pudo conectar con Firebase. Revisa internet.',
      'auth/operation-not-allowed': 'Debes habilitar el acceso por correo y contraseña en Firebase Authentication.'
    };
    return messages[error && error.code] || (error && error.message) || 'No se pudo completar la operación.';
  }

  try {
    if (!window.firebase) throw new Error('Firebase SDK no disponible');
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth = firebase.auth();
    const db = firebase.firestore();
    const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (error) {
      console.warn('Persistencia de sesión:', error);
    });

    db.enablePersistence({ synchronizeTabs: true }).catch(function (error) {
      if (error.code !== 'failed-precondition' && error.code !== 'unimplemented') {
        console.warn('Persistencia Firestore:', error);
      }
    });

    const collection = db.collection('partes');
    const usersCollection = db.collection('usuarios');

    window.LubaydAuth = {
      available: true,
      currentUser() {
        return auth.currentUser;
      },
      async login(email, password) {
        const credential = await auth.signInWithEmailAndPassword(String(email || '').trim(), password);
        return credential.user;
      },
      async register(name, email, password) {
        window.LubaydRegistrationInProgress = true;
        try {
          const credential = await auth.createUserWithEmailAndPassword(String(email || '').trim(), password);
          const cleanName = String(name || '').trim();
          if (cleanName) await credential.user.updateProfile({ displayName: cleanName });
          await usersCollection.doc(credential.user.uid).set({
            nombre: cleanName || credential.user.email || 'Usuario',
            email: credential.user.email || '',
            active: false,
            role: 'operador',
            createdAt: serverTimestamp()
          });
          await credential.user.reload();
          window.LubaydCurrentUser = auth.currentUser;
          return auth.currentUser;
        } finally {
          window.LubaydRegistrationInProgress = false;
          window.dispatchEvent(new CustomEvent('lubayd-auth-changed', { detail: { user: auth.currentUser } }));
        }
      },
      async getProfile(user) {
        if (!user) return null;
        const reference = usersCollection.doc(user.uid);
        let snapshot = await reference.get();
        if (!snapshot.exists) {
          await reference.set({
            nombre: user.displayName || user.email || 'Usuario',
            email: user.email || '',
            active: false,
            role: 'operador',
            createdAt: serverTimestamp()
          });
          snapshot = await reference.get();
        }
        return Object.assign({ uid: user.uid }, normalizeFirestoreValue(snapshot.data() || {}));
      },
      async resetPassword(email) {
        return auth.sendPasswordResetEmail(String(email || '').trim());
      },
      async logout() {
        return auth.signOut();
      },
      errorMessage: authErrorMessage
    };

    window.LubaydCloud = {
      available: true,
      subscribe(onData, onError) {
        if (!auth.currentUser) throw new Error('Debes iniciar sesión para sincronizar.');
        return collection.onSnapshot({ includeMetadataChanges: true }, function (snapshot) {
          const records = snapshot.docs.map(function (doc) {
            return Object.assign({ id: doc.id }, normalizeFirestoreValue(doc.data()));
          }).sort(function (a, b) {
            return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
          });
          onData(records, {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites
          });
        }, onError);
      },
      save(record) {
        const user = auth.currentUser;
        if (!user) return Promise.reject(new Error('Debes iniciar sesión.'));
        if (!record || !record.gps) return Promise.reject(new Error('El parte requiere ubicación GPS.'));

        const payload = Object.assign({}, record, {
          createdByUid: user.uid,
          createdByEmail: user.email || '',
          createdByName: user.displayName || user.email || 'Usuario',
          createdAtServer: serverTimestamp(),
          gps: Object.assign({}, record.gps, {
            capturedAtServer: serverTimestamp()
          })
        });

        return collection.doc(record.id).set(payload);
      },
      remove(id) {
        if (!auth.currentUser) return Promise.reject(new Error('Debes iniciar sesión.'));
        return collection.doc(id).delete();
      }
    };

    auth.onAuthStateChanged(function (user) {
      window.LubaydCurrentUser = user || null;
      if (window.LubaydRegistrationInProgress) return;
      window.dispatchEvent(new CustomEvent('lubayd-auth-changed', { detail: { user: user || null } }));
    });

    window.dispatchEvent(new CustomEvent('lubayd-firebase-ready'));
  } catch (error) {
    console.error('Firebase:', error);
    window.LubaydAuth = { available: false, error: error, errorMessage: authErrorMessage };
    window.LubaydCloud = { available: false, error: error };
    window.dispatchEvent(new CustomEvent('lubayd-firebase-error', { detail: error }));
  }
})();
