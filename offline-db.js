/* Lubayd SA V22.1.0 - autenticacion y datos offline robustos */
(function () {
  'use strict';
  const { config, normalizeEmail, clone, uid } = window.Lubayd;
  const DB_NAME = 'lubayd-sa-v21-3';
  const DB_VERSION = 1;
  const SESSION_KEY = 'lubayd_offline_session_v22_1';
  const ITERATIONS = 210000;
  let dbPromise = null;

  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no está disponible en este dispositivo.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('profiles')) {
          const store = db.createObjectStore('profiles', { keyPath: 'uid' });
          store.createIndex('email', 'email', { unique: true });
        }
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('dateKey', 'dateKey', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAtClient', 'createdAtClient', { unique: false });
        }
        if (!db.objectStoreNames.contains('queue')) {
          const store = db.createObjectStore('queue', { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('createdAtClient', 'createdAtClient', { unique: false });
        }
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento local.'));
      request.onblocked = () => reject(new Error('Cierra otras pestañas de Lubayd SA y vuelve a intentar.'));
    });
    return dbPromise;
  }

  async function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Error de lectura local.'));
    });
  }

  async function run(storeName, mode, callback) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      Promise.resolve().then(() => callback(store, tx)).then(value => { result = value; }).catch(error => {
        try { tx.abort(); } catch (_) {}
        reject(error);
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Error de almacenamiento local.'));
      tx.onabort = () => reject(tx.error || new Error('La operación local fue cancelada.'));
    });
  }

  async function runMany(storeNames, mode, callback) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]));
      let result;
      Promise.resolve().then(() => callback(stores, tx)).then(value => { result = value; }).catch(error => {
        try { tx.abort(); } catch (_) {}
        reject(error);
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Error de almacenamiento local.'));
      tx.onabort = () => reject(tx.error || new Error('La operación local fue cancelada.'));
    });
  }

  const put = (store, value) => run(store, 'readwrite', objectStore => requestResult(objectStore.put(clone(value))));
  const get = (store, key) => run(store, 'readonly', objectStore => requestResult(objectStore.get(key)));
  const remove = (store, key) => run(store, 'readwrite', objectStore => requestResult(objectStore.delete(key)));
  const getAll = store => run(store, 'readonly', objectStore => requestResult(objectStore.getAll()));
  const getByIndex = (store, indexName, value) => run(store, 'readonly', objectStore => requestResult(objectStore.index(indexName).getAll(value)));

  function bytesToBase64(bytes) {
    let text = '';
    bytes.forEach(byte => { text += String.fromCharCode(byte); });
    return btoa(text);
  }
  function base64ToBytes(value) {
    const text = atob(value);
    return Uint8Array.from(text, character => character.charCodeAt(0));
  }
  async function passwordHash(password, salt, iterations) {
    if (!crypto.subtle) throw new Error('El cifrado local no está disponible en este navegador.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
    return new Uint8Array(bits);
  }
  function equalBytes(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
  }
  async function findProfileByEmail(email) {
    const normalized = normalizeEmail(email);
    return run('profiles', 'readonly', store => requestResult(store.index('email').get(normalized)));
  }
  async function saveCredential(user, profile, password) {
    if (!user?.uid || !user?.email || !password) throw new Error('No se pudo preparar el acceso offline.');
    const existing = await get('profiles', user.uid).catch(() => null);
    const salt = crypto.getRandomValues(new Uint8Array(24));
    const hash = await passwordHash(password, salt, ITERATIONS);
    const record = {
      uid: user.uid,
      email: normalizeEmail(user.email),
      profile: Object.assign({ uid: user.uid, email: user.email }, clone(profile || {})),
      salt: bytesToBase64(salt),
      hash: bytesToBase64(hash),
      iterations: ITERATIONS,
      deviceId: existing?.deviceId || uid('device'),
      deviceSecret: existing?.deviceSecret || '',
      deviceExpiresAt: existing?.deviceExpiresAt || '',
      preparedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await put('profiles', record);
    return clone(record);
  }
  async function verifyCredential(email, password) {
    const record = await findProfileByEmail(email);
    if (!record?.hash || !record?.salt) throw new Error('Este usuario todavía no fue preparado para trabajar sin conexión en este teléfono.');
    const calculated = await passwordHash(password, base64ToBytes(record.salt), Number(record.iterations || ITERATIONS));
    if (!equalBytes(calculated, base64ToBytes(record.hash))) throw new Error('Correo o contraseña incorrectos.');
    if (record.profile?.active === false) throw new Error('Esta cuenta está desactivada.');
    return clone(record);
  }
  async function saveDeviceAuthorization(uidValue, authorization) {
    const record = await get('profiles', uidValue);
    if (!record) throw new Error('No existe un perfil local para autorizar.');
    record.deviceId = authorization.deviceId || record.deviceId;
    record.deviceSecret = authorization.deviceSecret || record.deviceSecret;
    record.deviceExpiresAt = authorization.expiresAt || record.deviceExpiresAt;
    record.updatedAt = new Date().toISOString();
    await put('profiles', record);
    return clone(record);
  }
  async function deviceAuthorization(uidValue) {
    const record = await get('profiles', uidValue).catch(() => null);
    if (!record?.deviceId || !record?.deviceSecret) return null;
    if (record.deviceExpiresAt && new Date(record.deviceExpiresAt).getTime() <= Date.now()) return null;
    return { userId: record.uid, deviceId: record.deviceId, deviceSecret: record.deviceSecret };
  }
  function startSession(record) {
    const hours = Math.max(1, Number(config.offlineSessionHours || 12));
    const session = {
      uid: record.uid,
      email: record.email,
      profile: clone(record.profile),
      offline: true,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + hours * 3600000).toISOString()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }
  function currentSession() {
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
  function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

  async function saveRecord(record) {
    const normalized = Object.assign({}, clone(record), { updatedAtClient: new Date().toISOString() });
    await put('records', normalized);
    window.Lubayd.emit('lubayd-local-data-changed', { type: normalized.type, id: normalized.id });
    return normalized;
  }
  async function queueRecord(record) {
    const entry = Object.assign({}, clone(record), {
      status: 'pending',
      attempts: Number(record.attempts || 0),
      lastError: '',
      queuedAt: record.queuedAt || new Date().toISOString(),
      updatedAtClient: new Date().toISOString()
    });
    try {
      await runMany(['records', 'queue'], 'readwrite', stores => Promise.all([
        requestResult(stores.records.put(clone(entry))),
        requestResult(stores.queue.put(clone(entry)))
      ]));
    } catch (error) {
      if (String(error?.name || '').includes('QuotaExceeded')) {
        throw new Error('El telefono no tiene espacio suficiente para guardar la fotografia. Libera almacenamiento y vuelve a intentar.');
      }
      throw error;
    }
    window.Lubayd.emit('lubayd-local-data-changed', { type: entry.type, id: entry.id });
    window.Lubayd.emit('lubayd-queue-changed', { id: entry.id });
    return clone(entry);
  }
  async function markSyncing(id) {
    const entry = await get('queue', id);
    if (!entry) return null;
    entry.status = 'syncing';
    entry.attempts = Number(entry.attempts || 0) + 1;
    entry.updatedAtClient = new Date().toISOString();
    await put('queue', entry);
    const record = await get('records', id);
    if (record) { record.status = 'syncing'; await put('records', record); }
    return entry;
  }
  async function markSynced(id, serverResult) {
    const record = await get('records', id);
    if (record) {
      record.status = 'synced';
      record.syncedAt = new Date().toISOString();
      record.serverResult = clone(serverResult || null);
      record.lastError = '';
      await put('records', record);
    }
    await remove('queue', id).catch(() => {});
    window.Lubayd.emit('lubayd-queue-changed', { id, synced: true });
  }
  async function markError(id, error) {
    const entry = await get('queue', id);
    if (!entry) return;
    entry.status = 'error';
    entry.lastError = error?.message || String(error || 'Error de sincronización');
    entry.updatedAtClient = new Date().toISOString();
    await put('queue', entry);
    const record = await get('records', id);
    if (record) { record.status = 'error'; record.lastError = entry.lastError; await put('records', record); }
    window.Lubayd.emit('lubayd-queue-changed', { id, error: entry.lastError });
  }
  async function pendingQueue(userId) {
    const items = await getAll('queue');
    return items.filter(item => (!userId || item.userId === userId) && ['pending', 'error', 'syncing'].includes(item.status)).sort((a, b) => String(a.createdAtClient).localeCompare(String(b.createdAtClient)));
  }
  async function pendingCount(userId) { return (await pendingQueue(userId)).length; }
  async function resetInterrupted() {
    const items = await getAll('queue').catch(() => []);
    await Promise.all(items.filter(item => item.status === 'syncing').map(item => {
      item.status = 'pending';
      item.lastError = 'Sincronización interrumpida; se reintentará.';
      return put('queue', item);
    }));
  }
  async function listRecords(type, options = {}) {
    let items = type ? await getByIndex('records', 'type', type) : await getAll('records');
    if (options.userId) items = items.filter(item => item.userId === options.userId);
    if (options.dateKey) items = items.filter(item => item.dateKey === options.dateKey);
    return items.sort((a, b) => String(b.createdAtClient || b.updatedAtClient || '').localeCompare(String(a.createdAtClient || a.updatedAtClient || '')));
  }
  const setCache = (key, value) => put('cache', { key, value: clone(value), updatedAt: new Date().toISOString() });
  async function getCache(key, fallback = null) {
    const record = await get('cache', key).catch(() => null);
    return record ? clone(record.value) : fallback;
  }
  async function setSetting(key, value) { return put('settings', { key, value: clone(value), updatedAt: new Date().toISOString() }); }
  async function getSetting(key, fallback = null) {
    const record = await get('settings', key).catch(() => null);
    return record ? clone(record.value) : fallback;
  }
  async function requestPersistence() {
    if (!navigator.storage?.persist) return false;
    try { return await navigator.storage.persist(); } catch (_) { return false; }
  }
  async function storageInfo() {
    if (!navigator.storage?.estimate) return { usage: 0, quota: 0, persistent: false };
    const estimate = await navigator.storage.estimate().catch(() => ({}));
    const persistent = navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    return { usage: Number(estimate.usage || 0), quota: Number(estimate.quota || 0), persistent };
  }
  async function status(uidValue) {
    const profile = uidValue ? await get('profiles', uidValue).catch(() => null) : null;
    const storage = await storageInfo();
    return {
      indexedDb: true,
      profile: Boolean(profile),
      credential: Boolean(profile?.hash),
      device: Boolean(profile?.deviceId && profile?.deviceSecret),
      email: profile?.email || '',
      preparedAt: profile?.preparedAt || '',
      pending: await pendingCount(uidValue).catch(() => 0),
      storage
    };
  }

  open().then(async () => { await resetInterrupted(); await requestPersistence(); }).catch(error => console.error('[Lubayd Offline]', error));
  window.LubaydOffline = {
    available: Boolean(window.indexedDB && window.crypto?.subtle),
    open, put, get, remove, getAll, getByIndex, runMany,
    saveCredential, verifyCredential, findProfileByEmail, saveDeviceAuthorization, deviceAuthorization,
    startSession, currentSession, clearSession,
    saveRecord, queueRecord, markSyncing, markSynced, markError, pendingQueue, pendingCount, listRecords,
    setCache, getCache, setSetting, getSetting, requestPersistence, storageInfo, status
  };
})();
