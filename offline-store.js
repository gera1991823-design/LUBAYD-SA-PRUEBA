/* Lubayd SA V20.4 - almacenamiento offline, PIN local y cola de sincronizacion */
(function () {
  'use strict';

  const DB_NAME = 'lubayd-sa-offline-v20-3';
  const DB_VERSION = 1;
  const STORES = {
    queue: 'sync_queue',
    attendance: 'attendance_local',
    profiles: 'offline_profiles',
    settings: 'settings'
  };
  let databasePromise = null;

  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no esta disponible en este dispositivo.'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORES.queue)) {
          const store = db.createObjectStore(STORES.queue, { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('dateKey', 'dateKey', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.attendance)) {
          const store = db.createObjectStore(STORES.attendance, { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('dateKey', 'dateKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.profiles)) {
          db.createObjectStore(STORES.profiles, { keyPath: 'uid' });
        }
        if (!db.objectStoreNames.contains(STORES.settings)) {
          db.createObjectStore(STORES.settings, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento offline.'));
      request.onblocked = () => reject(new Error('Cierra otras pestanas de Lubayd SA y vuelve a intentarlo.'));
    });
    return databasePromise;
  }

  async function withStore(storeName, mode, callback) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = callback(store, transaction);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Error en el almacenamiento local.'));
      transaction.onabort = () => reject(transaction.error || new Error('La operacion local fue cancelada.'));
    });
  }

  async function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo leer el almacenamiento local.'));
    });
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function toIso(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function normalizeMark(mark) {
    if (!mark) return null;
    return {
      at: toIso(mark.at || mark.atClient),
      atClient: toIso(mark.atClient || mark.at),
      serverAt: toIso(mark.serverAt),
      photoId: mark.photoId || '',
      gps: mark.gps ? clone(mark.gps) : null,
      device: mark.device || '',
      clientMutationId: mark.clientMutationId || '',
      syncStatus: mark.syncStatus || 'synced',
      syncError: mark.syncError || '',
      offlineCaptured: Boolean(mark.offlineCaptured)
    };
  }

  function normalizeAttendance(record) {
    if (!record) return null;
    return {
      id: record.id || `${record.userId}_${record.dateKey}`,
      userId: record.userId || '',
      userName: record.userName || '',
      userEmail: record.userEmail || '',
      dateKey: record.dateKey || '',
      entrada: normalizeMark(record.entrada),
      salida: normalizeMark(record.salida),
      createdAt: toIso(record.createdAt) || record.createdAtClient || new Date().toISOString(),
      updatedAt: toIso(record.updatedAt) || record.updatedAtClient || new Date().toISOString(),
      localOnly: Boolean(record.localOnly)
    };
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  async function derivePin(pin, salt, iterations) {
    if (!window.crypto?.subtle) throw new Error('Este navegador no permite proteger el PIN offline.');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    }, key, 256);
    return bytesToBase64(new Uint8Array(bits));
  }

  function notify() {
    window.dispatchEvent(new CustomEvent('lubayd-offline-state-changed'));
  }

  async function get(storeName, key) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).get(key));
  }

  async function put(storeName, value) {
    await withStore(storeName, 'readwrite', store => store.put(clone(value)));
    return value;
  }

  async function remove(storeName, key) {
    await withStore(storeName, 'readwrite', store => store.delete(key));
  }

  async function getAll(storeName) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async function saveProfile(user, profile) {
    if (!user?.uid) throw new Error('No hay un usuario valido para preparar el modo offline.');
    const existing = await get(STORES.profiles, user.uid) || {};
    const saved = {
      ...existing,
      uid: user.uid,
      nombre: profile?.nombre || user.displayName || user.email?.split('@')[0] || 'Usuario',
      email: profile?.email || user.email || '',
      role: profile?.role || 'operador',
      active: profile?.active !== false,
      preparedAt: new Date().toISOString()
    };
    await put(STORES.profiles, saved);
    notify();
    return saved;
  }

  async function listProfiles(options) {
    const onlyWithPin = options?.onlyWithPin !== false;
    const profiles = await getAll(STORES.profiles);
    return profiles
      .filter(profile => profile.active !== false && (!onlyWithPin || Boolean(profile.pinHash)))
      .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
  }

  async function getProfile(uid) {
    return get(STORES.profiles, uid);
  }

  async function setPin(uid, pin) {
    if (!/^\d{4,6}$/.test(String(pin || ''))) throw new Error('El PIN debe tener entre 4 y 6 numeros.');
    const profile = await getProfile(uid);
    if (!profile) throw new Error('Primero inicia sesion con internet para preparar este dispositivo.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 120000;
    const pinHash = await derivePin(String(pin), salt, iterations);
    profile.pinSalt = bytesToBase64(salt);
    profile.pinHash = pinHash;
    profile.pinIterations = iterations;
    profile.pinUpdatedAt = new Date().toISOString();
    await put(STORES.profiles, profile);
    notify();
    return true;
  }

  async function removePin(uid) {
    const profile = await getProfile(uid);
    if (!profile) return;
    delete profile.pinSalt;
    delete profile.pinHash;
    delete profile.pinIterations;
    delete profile.pinUpdatedAt;
    await put(STORES.profiles, profile);
    notify();
  }

  async function hasPin(uid) {
    const profile = await getProfile(uid);
    return Boolean(profile?.pinHash && profile?.pinSalt);
  }

  async function verifyPin(uid, pin) {
    const profile = await getProfile(uid);
    if (!profile?.pinHash || !profile.pinSalt) return false;
    const candidate = await derivePin(String(pin || ''), base64ToBytes(profile.pinSalt), profile.pinIterations || 120000);
    return candidate === profile.pinHash;
  }

  async function getAttendance(id) {
    return get(STORES.attendance, id);
  }

  async function saveAttendance(record) {
    const normalized = normalizeAttendance(record);
    await put(STORES.attendance, normalized);
    notify();
    return normalized;
  }

  async function mergeRemoteAttendance(record) {
    const remote = normalizeAttendance(record);
    const local = await getAttendance(remote.id);
    if (local?.entrada?.syncStatus && local.entrada.syncStatus !== 'synced') remote.entrada = local.entrada;
    if (local?.salida?.syncStatus && local.salida.syncStatus !== 'synced') remote.salida = local.salida;
    remote.localOnly = Boolean(
      remote.entrada?.syncStatus && remote.entrada.syncStatus !== 'synced' ||
      remote.salida?.syncStatus && remote.salida.syncStatus !== 'synced'
    );
    return saveAttendance(remote);
  }

  async function listAttendance(dateKey) {
    const records = await getAll(STORES.attendance);
    return records.filter(record => !dateKey || record.dateKey === dateKey);
  }

  async function removeAttendance(id) {
    await remove(STORES.attendance, id);
    notify();
  }

  async function enqueueAttendanceMark(payload) {
    const required = ['attendanceId', 'userId', 'dateKey', 'type', 'photoId', 'photoData', 'mark'];
    required.forEach(key => {
      if (!payload?.[key]) throw new Error(`Falta informacion offline: ${key}.`);
    });
    if (!['entrada', 'salida'].includes(payload.type)) throw new Error('Tipo de marca no valido.');
    const id = `${payload.attendanceId}_${payload.type}`;
    const existingQueue = await get(STORES.queue, id);
    if (existingQueue && ['pending', 'syncing', 'error'].includes(existingQueue.status)) {
      throw new Error(payload.type === 'entrada' ? 'La llegada ya esta guardada en este dispositivo.' : 'La salida ya esta guardada en este dispositivo.');
    }

    const current = await getAttendance(payload.attendanceId) || {
      id: payload.attendanceId,
      userId: payload.userId,
      userName: payload.userName || '',
      userEmail: payload.userEmail || '',
      dateKey: payload.dateKey,
      entrada: null,
      salida: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      localOnly: true
    };
    if (payload.type === 'entrada' && current.entrada?.at) throw new Error('La llegada de hoy ya esta registrada.');
    if (payload.type === 'salida' && !current.entrada?.at) throw new Error('Primero debes registrar la llegada.');
    if (payload.type === 'salida' && current.salida?.at) throw new Error('La salida de hoy ya esta registrada.');

    const localMark = normalizeMark({ ...payload.mark, syncStatus: 'pending', syncError: '' });
    current[payload.type] = localMark;
    current.updatedAt = new Date().toISOString();
    current.localOnly = true;

    const queueItem = {
      id,
      attendanceId: payload.attendanceId,
      userId: payload.userId,
      userName: payload.userName || '',
      userEmail: payload.userEmail || '',
      dateKey: payload.dateKey,
      type: payload.type,
      photoId: payload.photoId,
      photoData: payload.photoData,
      mark: localMark,
      status: 'pending',
      attempts: 0,
      lastError: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORES.attendance, STORES.queue], 'readwrite');
      transaction.objectStore(STORES.attendance).put(clone(current));
      transaction.objectStore(STORES.queue).put(clone(queueItem));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar la marca en el telefono.'));
      transaction.onabort = () => reject(transaction.error || new Error('La marca offline fue cancelada.'));
    });
    notify();
    return { record: current, queueItem };
  }

  async function getQueueItem(id) {
    return get(STORES.queue, id);
  }

  async function listQueue(options) {
    const items = await getAll(STORES.queue);
    return items
      .filter(item => !options?.userId || item.userId === options.userId)
      .filter(item => !options?.statuses || options.statuses.includes(item.status))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function pendingCount(userId) {
    const items = await listQueue({ userId, statuses: ['pending', 'syncing', 'error'] });
    return items.length;
  }

  async function updateQueueItem(id, changes) {
    const item = await getQueueItem(id);
    if (!item) return null;
    Object.assign(item, clone(changes), { updatedAt: new Date().toISOString() });
    await put(STORES.queue, item);
    notify();
    return item;
  }

  async function markSynced(id, remoteRecord) {
    const item = await getQueueItem(id);
    if (!item) return;
    const current = await getAttendance(item.attendanceId);
    if (remoteRecord) {
      const normalized = normalizeAttendance(remoteRecord);
      for (const type of ['entrada', 'salida']) {
        if (normalized?.[type]) {
          normalized[type].syncStatus = 'synced';
          normalized[type].syncError = '';
        }
        if (type !== item.type && current?.[type]?.syncStatus && current[type].syncStatus !== 'synced') {
          normalized[type] = current[type];
        }
      }
      normalized.localOnly = Boolean(
        normalized.entrada?.syncStatus && normalized.entrada.syncStatus !== 'synced' ||
        normalized.salida?.syncStatus && normalized.salida.syncStatus !== 'synced'
      );
      await put(STORES.attendance, normalized);
    } else if (current?.[item.type]) {
      current[item.type].syncStatus = 'synced';
      current[item.type].syncError = '';
      current.localOnly = Boolean(
        current.entrada?.syncStatus && current.entrada.syncStatus !== 'synced' ||
        current.salida?.syncStatus && current.salida.syncStatus !== 'synced'
      );
      current.updatedAt = new Date().toISOString();
      await put(STORES.attendance, normalizeAttendance(current));
    }
    await remove(STORES.queue, id);
    notify();
  }

  async function markError(id, error) {
    const item = await updateQueueItem(id, {
      status: 'error',
      attempts: (await getQueueItem(id))?.attempts + 1 || 1,
      lastError: error?.message || String(error || 'Error desconocido')
    });
    if (!item) return;
    const current = await getAttendance(item.attendanceId);
    if (current?.[item.type]) {
      current[item.type].syncStatus = 'error';
      current[item.type].syncError = item.lastError;
      await saveAttendance(current);
    }
  }

  async function retryErrors(userId) {
    const items = await listQueue({ userId, statuses: ['error'] });
    await Promise.all(items.map(item => updateQueueItem(item.id, { status: 'pending', lastError: '' })));
    notify();
  }

  async function clearUserData(uid) {
    const db = await openDatabase();
    const [queue, attendance] = await Promise.all([listQueue({ userId: uid }), listAttendance()]);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORES.queue, STORES.attendance, STORES.profiles], 'readwrite');
      queue.forEach(item => transaction.objectStore(STORES.queue).delete(item.id));
      attendance.filter(record => record.userId === uid).forEach(record => transaction.objectStore(STORES.attendance).delete(record.id));
      transaction.objectStore(STORES.profiles).delete(uid);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('No se pudieron eliminar los datos locales.'));
    });
    notify();
  }

  window.LubaydOffline = {
    available: 'indexedDB' in window,
    openDatabase,
    saveProfile,
    listProfiles,
    getProfile,
    setPin,
    removePin,
    hasPin,
    verifyPin,
    getAttendance,
    saveAttendance,
    mergeRemoteAttendance,
    listAttendance,
    removeAttendance,
    enqueueAttendanceMark,
    getQueueItem,
    listQueue,
    pendingCount,
    updateQueueItem,
    markSynced,
    markError,
    retryErrors,
    clearUserData,
    normalizeAttendance
  };
})();
