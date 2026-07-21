/* Lubayd SA V20.6 - almacenamiento local de asistencia y acceso por PIN */
(function () {
  'use strict';

  const DB_NAME = 'lubayd-sa-v20-1-offline';
  const DB_VERSION = 1;
  const STORES = {
    profiles: 'profiles',
    attendance: 'attendance',
    photos: 'photos',
    queue: 'queue'
  };
  let databasePromise = null;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Este dispositivo no dispone de almacenamiento offline.'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORES.profiles)) db.createObjectStore(STORES.profiles, { keyPath: 'uid' });
        if (!db.objectStoreNames.contains(STORES.attendance)) {
          const store = db.createObjectStore(STORES.attendance, { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('dateKey', 'dateKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.photos)) db.createObjectStore(STORES.photos, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.queue)) {
          const store = db.createObjectStore(STORES.queue, { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento offline.'));
      request.onblocked = () => reject(new Error('Cierra otras pestañas de Lubayd SA y vuelve a intentar.'));
    });
    return databasePromise;
  }

  async function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo leer el almacenamiento local.'));
    });
  }

  async function get(storeName, key) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).get(key));
  }

  async function getAll(storeName) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async function put(storeName, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(clone(value));
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar la información local.'));
      transaction.onabort = () => reject(transaction.error || new Error('La operación local fue cancelada.'));
    });
  }

  async function remove(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo eliminar la información local.'));
    });
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
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return bytesToBase64(new Uint8Array(bits));
  }

  function emitChange() {
    window.dispatchEvent(new CustomEvent('lubayd-offline-state-changed'));
  }

  async function saveProfile(user, profile) {
    if (!user?.uid) throw new Error('No hay un usuario válido para preparar este teléfono.');
    const current = await get(STORES.profiles, user.uid) || {};
    const saved = {
      ...current,
      uid: user.uid,
      nombre: profile?.nombre || user.displayName || user.email?.split('@')[0] || 'Usuario',
      email: profile?.email || user.email || '',
      role: profile?.role || 'operador',
      active: profile?.active !== false,
      preparedAt: new Date().toISOString()
    };
    await put(STORES.profiles, saved);
    emitChange();
    return saved;
  }

  async function listProfiles(options) {
    const onlyWithPin = options?.onlyWithPin !== false;
    const profiles = await getAll(STORES.profiles);
    return profiles
      .filter(profile => profile.active !== false && (!onlyWithPin || Boolean(profile.pinHash)))
      .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
  }

  function getProfile(uid) {
    return get(STORES.profiles, uid);
  }

  async function setPin(uid, pin) {
    const cleanPin = String(pin || '').trim();
    if (!/^\d{4,6}$/.test(cleanPin)) throw new Error('El PIN debe tener entre 4 y 6 números.');
    const profile = await getProfile(uid);
    if (!profile) throw new Error('Primero inicia sesión con internet en este dispositivo.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 120000;
    profile.pinSalt = bytesToBase64(salt);
    profile.pinHash = await derivePin(cleanPin, salt, iterations);
    profile.pinIterations = iterations;
    profile.pinUpdatedAt = new Date().toISOString();
    await put(STORES.profiles, profile);
    emitChange();
    return true;
  }

  async function verifyPin(uid, pin) {
    const profile = await getProfile(uid);
    if (!profile?.pinHash || !profile.pinSalt) return false;
    const candidate = await derivePin(String(pin || ''), base64ToBytes(profile.pinSalt), profile.pinIterations || 120000);
    return candidate === profile.pinHash;
  }

  async function removePin(uid) {
    const profile = await getProfile(uid);
    if (!profile) return;
    delete profile.pinHash;
    delete profile.pinSalt;
    delete profile.pinIterations;
    delete profile.pinUpdatedAt;
    await put(STORES.profiles, profile);
    emitChange();
  }

  async function hasPin(uid) {
    const profile = await getProfile(uid);
    return Boolean(profile?.pinHash && profile?.pinSalt);
  }

  function normalizeRecord(record) {
    if (!record) return null;
    return {
      ...clone(record),
      id: record.id || `${record.userId}_${record.dateKey}`,
      userId: record.userId || '',
      userName: record.userName || '',
      userEmail: record.userEmail || '',
      dateKey: record.dateKey || '',
      entrySyncStatus: record.entrySyncStatus || (record.entryAt ? 'synced' : ''),
      exitSyncStatus: record.exitSyncStatus || (record.exitAt ? 'synced' : ''),
      localUpdatedAt: record.localUpdatedAt || new Date().toISOString()
    };
  }

  function getAttendance(id) {
    return get(STORES.attendance, id);
  }

  async function saveAttendance(record) {
    const normalized = normalizeRecord(record);
    await put(STORES.attendance, normalized);
    emitChange();
    return normalized;
  }

  async function listAttendance(options) {
    const records = await getAll(STORES.attendance);
    return records
      .filter(record => !options?.userId || record.userId === options.userId)
      .filter(record => !options?.dateKey || record.dateKey === options.dateKey)
      .sort((a, b) => String(b.dateKey || '').localeCompare(String(a.dateKey || '')) || String(a.userName || '').localeCompare(String(b.userName || ''), 'es'));
  }

  async function mergeRemoteRecord(record) {
    const remote = normalizeRecord(record);
    const local = await getAttendance(remote.id);
    if (local?.entrySyncStatus && local.entrySyncStatus !== 'synced') {
      ['entryAt', 'entryAtClient', 'entryPhotoId', 'entryGps', 'entryClientMutationId', 'entrySyncStatus', 'entrySyncError', 'entryOfflineCaptured'].forEach(field => { remote[field] = local[field]; });
    } else if (remote.entryAt) remote.entrySyncStatus = 'synced';
    if (local?.exitSyncStatus && local.exitSyncStatus !== 'synced') {
      ['exitAt', 'exitAtClient', 'exitPhotoId', 'exitGps', 'exitClientMutationId', 'exitSyncStatus', 'exitSyncError', 'exitOfflineCaptured'].forEach(field => { remote[field] = local[field]; });
    } else if (remote.exitAt) remote.exitSyncStatus = 'synced';
    remote.localUpdatedAt = new Date().toISOString();
    await put(STORES.attendance, remote);
    return remote;
  }

  async function mergeRemoteRecords(records) {
    for (const record of records || []) await mergeRemoteRecord(record);
    emitChange();
    return listAttendance();
  }

  async function savePhoto(photo) {
    if (!photo?.id || !photo.imageData) throw new Error('La fotografía local no es válida.');
    await put(STORES.photos, { ...clone(photo), savedAt: new Date().toISOString() });
    return photo;
  }

  function getPhoto(id) {
    return get(STORES.photos, id);
  }

  async function enqueueMark(payload) {
    const type = payload?.type === 'exit' ? 'exit' : 'entry';
    const required = ['attendanceId', 'userId', 'dateKey', 'photoId', 'imageData', 'capturedAt', 'gps'];
    required.forEach(key => { if (!payload?.[key]) throw new Error(`Falta información offline: ${key}.`); });
    const queueId = `${payload.attendanceId}_${type}`;
    const previousQueue = await get(STORES.queue, queueId);
    if (previousQueue && ['pending', 'syncing', 'error'].includes(previousQueue.status)) {
      throw new Error(type === 'entry' ? 'La llegada ya está guardada en este teléfono.' : 'La salida ya está guardada en este teléfono.');
    }

    const current = await getAttendance(payload.attendanceId) || {
      id: payload.attendanceId,
      userId: payload.userId,
      userName: payload.userName || '',
      userEmail: payload.userEmail || '',
      dateKey: payload.dateKey,
      status: 'trabajando',
      createdAtClient: payload.capturedAt,
      localUpdatedAt: new Date().toISOString()
    };
    if (type === 'entry' && current.entryAt) throw new Error('La llegada de hoy ya está registrada.');
    if (type === 'exit' && !current.entryAt) throw new Error('Primero debes registrar la llegada.');
    if (type === 'exit' && current.exitAt) throw new Error('La salida de hoy ya está registrada.');

    const mutationId = payload.clientMutationId || `${payload.userId}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const prefix = type === 'entry' ? 'entry' : 'exit';
    current[`${prefix}At`] = payload.capturedAt;
    current[`${prefix}AtClient`] = payload.capturedAt;
    current[`${prefix}PhotoId`] = payload.photoId;
    current[`${prefix}Gps`] = clone(payload.gps);
    current[`${prefix}ClientMutationId`] = mutationId;
    current[`${prefix}SyncStatus`] = 'pending';
    current[`${prefix}SyncError`] = '';
    current[`${prefix}OfflineCaptured`] = Boolean(payload.offlineCaptured);
    current.status = type === 'exit' ? 'finalizado' : 'trabajando';
    current.localUpdatedAt = new Date().toISOString();

    const queueItem = {
      id: queueId,
      attendanceId: payload.attendanceId,
      userId: payload.userId,
      userName: payload.userName || '',
      userEmail: payload.userEmail || '',
      dateKey: payload.dateKey,
      type,
      photoId: payload.photoId,
      imageData: payload.imageData,
      capturedAt: payload.capturedAt,
      gps: clone(payload.gps),
      clientMutationId: mutationId,
      offlineCaptured: Boolean(payload.offlineCaptured),
      status: 'pending',
      attempts: 0,
      lastError: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORES.attendance, STORES.photos, STORES.queue], 'readwrite');
      transaction.objectStore(STORES.attendance).put(clone(current));
      transaction.objectStore(STORES.photos).put({ id: payload.photoId, imageData: payload.imageData, mimeType: 'image/jpeg', ownerId: payload.userId, attendanceId: payload.attendanceId, kind: type, savedAt: new Date().toISOString() });
      transaction.objectStore(STORES.queue).put(clone(queueItem));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar la marca en el teléfono.'));
      transaction.onabort = () => reject(transaction.error || new Error('La marca offline fue cancelada.'));
    });
    emitChange();
    return { record: current, queueItem };
  }

  async function listQueue(options) {
    const items = await getAll(STORES.queue);
    return items
      .filter(item => !options?.userId || item.userId === options.userId)
      .filter(item => !options?.statuses || options.statuses.includes(item.status))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function pendingCount(userId) {
    return (await listQueue({ userId, statuses: ['pending', 'syncing', 'error'] })).length;
  }

  async function updateQueue(id, changes) {
    const item = await get(STORES.queue, id);
    if (!item) return null;
    Object.assign(item, clone(changes), { updatedAt: new Date().toISOString() });
    await put(STORES.queue, item);
    emitChange();
    return item;
  }

  async function markSynced(id, remoteRecord) {
    const item = await get(STORES.queue, id);
    if (!item) return;
    const current = await getAttendance(item.attendanceId);
    if (current) {
      const prefix = item.type === 'entry' ? 'entry' : 'exit';
      current[`${prefix}SyncStatus`] = 'synced';
      current[`${prefix}SyncError`] = '';
      await put(STORES.attendance, current);
    }
    if (remoteRecord) await mergeRemoteRecord(remoteRecord);
    await remove(STORES.queue, id);
    emitChange();
  }

  async function pruneSyncedAttendance(remoteIds, options) {
    const keep = new Set(remoteIds || []);
    const records = await listAttendance(options || {});
    for (const record of records) {
      const pending = [record.entrySyncStatus, record.exitSyncStatus].some(status => status && status !== 'synced');
      if (!pending && !keep.has(record.id)) await remove(STORES.attendance, record.id);
    }
    emitChange();
  }

  async function markError(id, error) {
    const item = await get(STORES.queue, id);
    if (!item) return;
    const message = error?.message || String(error || 'Error desconocido');
    item.status = 'error';
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastError = message;
    item.updatedAt = new Date().toISOString();
    await put(STORES.queue, item);
    const current = await getAttendance(item.attendanceId);
    if (current) {
      const prefix = item.type === 'entry' ? 'entry' : 'exit';
      current[`${prefix}SyncStatus`] = 'error';
      current[`${prefix}SyncError`] = message;
      await put(STORES.attendance, current);
    }
    emitChange();
  }

  async function retryErrors(userId) {
    const items = await listQueue({ userId, statuses: ['error'] });
    for (const item of items) await updateQueue(item.id, { status: 'pending', lastError: '' });
    emitChange();
  }

  window.LubaydOffline = {
    available: 'indexedDB' in window,
    openDatabase,
    saveProfile,
    listProfiles,
    getProfile,
    setPin,
    verifyPin,
    removePin,
    hasPin,
    getAttendance,
    saveAttendance,
    listAttendance,
    mergeRemoteRecord,
    mergeRemoteRecords,
    savePhoto,
    getPhoto,
    enqueueMark,
    listQueue,
    pendingCount,
    updateQueue,
    markSynced,
    markError,
    retryErrors,
    pruneSyncedAttendance
  };
})();
