/* Lubayd SA V21.0.1 - acceso offline con correo y contraseña cifrada */
(function () {
  'use strict';

  // Esta base es independiente. No modifica las bases que guardan partes,
  // asistencia, fotos, combustible ni sus colas pendientes.
  const DB_NAME = 'lubayd-sa-offline-auth-v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'profiles';
  const SESSION_KEY = 'lubayd-offline-session-v1';
  const SESSION_MAX_MS = 60 * 60 * 1000;
  const ITERATIONS = 210000;
  let databasePromise = null;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador no dispone de IndexedDB.'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'uid' });
          store.createIndex('email', 'email', { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento offline.'));
      request.onblocked = () => reject(new Error('Cierra otras pestañas de Lubayd y vuelve a intentarlo.'));
    });
    return databasePromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo leer el almacenamiento local.'));
    });
  }

  async function getByEmail(email) {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    return requestResult(transaction.objectStore(STORE_NAME).index('email').get(normalizeEmail(email)));
  }

  async function put(value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(clone(value));
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el acceso offline.'));
      transaction.onabort = () => reject(transaction.error || new Error('La operación local fue cancelada.'));
    });
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  async function deriveSecret(secret, salt, iterations) {
    if (!window.crypto?.subtle) throw new Error('Este dispositivo no permite cifrar el acceso offline.');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    }, key, 256);
    return new Uint8Array(bits);
  }

  function constantTimeEqual(left, right) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
  }

  async function savePasswordCredential(user, profile, password) {
    if (!user?.uid) throw new Error('No hay un usuario válido para preparar el modo offline.');
    if (!password || String(password).length < 6) throw new Error('La contraseña no es válida para preparar el acceso offline.');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const verifier = await deriveSecret(password, salt, ITERATIONS);
    const saved = {
      uid: user.uid,
      email: normalizeEmail(profile?.email || user.email),
      nombre: profile?.nombre || user.displayName || user.email?.split('@')[0] || 'Usuario',
      role: profile?.role || 'operador',
      active: profile?.active !== false,
      passwordSalt: bytesToBase64(salt),
      passwordVerifier: bytesToBase64(verifier),
      passwordIterations: ITERATIONS,
      preparedAt: new Date().toISOString(),
      failedAttempts: 0,
      lockedUntil: null
    };
    await put(saved);
    window.dispatchEvent(new CustomEvent('lubayd-offline-state-changed'));
    return saved;
  }

  async function verifyPassword(email, password) {
    const profile = await getByEmail(email);
    if (!profile?.passwordSalt || !profile.passwordVerifier) return { valid: false, reason: 'not-prepared', profile };
    if (profile.active === false) return { valid: false, reason: 'inactive', profile };

    const lockedUntil = profile.lockedUntil ? new Date(profile.lockedUntil).getTime() : 0;
    if (lockedUntil > Date.now()) return { valid: false, reason: 'locked', profile };

    const candidate = await deriveSecret(password, base64ToBytes(profile.passwordSalt), profile.passwordIterations || ITERATIONS);
    const expected = base64ToBytes(profile.passwordVerifier);
    const valid = constantTimeEqual(candidate, expected);

    if (valid) {
      profile.failedAttempts = 0;
      profile.lockedUntil = null;
      profile.lastOfflineLoginAt = new Date().toISOString();
      await put(profile);
      return { valid: true, profile };
    }

    profile.failedAttempts = Number(profile.failedAttempts || 0) + 1;
    if (profile.failedAttempts >= 5) {
      profile.lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      profile.failedAttempts = 0;
    }
    await put(profile);
    return { valid: false, reason: profile.lockedUntil ? 'locked' : 'wrong-password', profile };
  }

  async function loginWithPassword(email, password) {
    const result = await verifyPassword(email, password);
    if (!result.valid) {
      if (result.reason === 'not-prepared') {
        throw new Error('Este usuario todavía no está preparado en este teléfono. Conecta internet e inicia sesión una vez.');
      }
      if (result.reason === 'inactive') throw new Error('Esta cuenta está desactivada.');
      if (result.reason === 'locked') throw new Error('Acceso bloqueado por varios intentos. Espera 5 minutos.');
      throw new Error('Correo o contraseña incorrectos.');
    }

    const session = {
      uid: result.profile.uid,
      email: result.profile.email,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_MAX_MS).toISOString()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { profile: result.profile, session };
  }

  function getSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (!session?.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch (_) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  const api = {
    available: 'indexedDB' in window && Boolean(window.crypto?.subtle),
    openDatabase,
    savePasswordCredential,
    verifyPassword,
    loginWithPassword,
    getProfileByEmail: getByEmail,
    getSession,
    clearSession
  };

  window.LubaydOfflineAuth = api;

  // Agrega solamente las funciones nuevas y conserva las colas y métodos
  // de offline-store.js de la aplicación.
  window.LubaydOffline = window.LubaydOffline || {};
  window.LubaydOffline.savePasswordCredential = savePasswordCredential;
  window.LubaydOffline.verifyPassword = verifyPassword;
  window.LubaydOffline.loginWithPassword = loginWithPassword;
  window.LubaydOffline.getProfileByEmail = getByEmail;
})();
