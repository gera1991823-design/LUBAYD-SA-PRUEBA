/* Lubayd SA V20.8 - acceso local, asistencia y partes completos sin conexión */
(function () {
  'use strict';

  const DB_NAME = 'lubayd-sa-v20-1-offline';
  const DB_VERSION = 3;
  const SESSION_DURATION_MS = 60 * 60 * 1000;
  const STORES = {
    profiles: 'profiles',
    attendance: 'attendance',
    photos: 'photos',
    queue: 'queue',
    settings: 'settings',
    partQueue: 'part_queue'
  };
  let databasePromise = null;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
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
        if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORES.partQueue)) {
          const store = db.createObjectStore(STORES.partQueue, { keyPath: 'recordId' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          databasePromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error('No se pudo abrir el almacenamiento offline.'));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error('Cierra otras pestañas de Lubayd SA y vuelve a intentarlo.'));
      };
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

  function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function sha256Hex(value) {
    if (!window.crypto?.subtle) throw new Error('Este navegador no permite proteger el dispositivo.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
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

  async function getSetting(key) {
    const row = await get(STORES.settings, key);
    return row?.value;
  }

  async function setSetting(key, value) {
    await put(STORES.settings, { key, value: clone(value), updatedAt: nowIso() });
    return value;
  }

  async function removeSetting(key) {
    await remove(STORES.settings, key);
  }

  function normalizedProfile(user, profile, current) {
    return {
      ...(current || {}),
      uid: profile?.uid || user?.uid || current?.uid || '',
      nombre: profile?.nombre || user?.displayName || user?.email?.split('@')[0] || current?.nombre || 'Usuario',
      email: profile?.email || user?.email || current?.email || '',
      role: profile?.role || current?.role || 'operador',
      active: profile?.active !== false,
      preparedAt: current?.preparedAt || nowIso(),
      updatedAtLocal: nowIso()
    };
  }

  async function saveProfile(user, profile) {
    const uid = profile?.uid || user?.uid;
    if (!uid) throw new Error('No hay un usuario válido para preparar este teléfono.');
    const current = await get(STORES.profiles, uid) || {};
    const saved = normalizedProfile(user, { ...profile, uid }, current);
    await put(STORES.profiles, saved);
    emitChange();
    return saved;
  }

  async function provisionProfile(profile, pin, options) {
    if (!profile?.uid) throw new Error('El usuario no tiene un identificador válido.');
    if (profile.role !== 'operador') throw new Error('El acceso offline de marcación solo se prepara para operadores.');
    if (profile.active === false) throw new Error('El usuario está desactivado.');
    const current = await get(STORES.profiles, profile.uid) || {};
    const saved = normalizedProfile(null, profile, current);
    saved.preparedByUid = options?.preparedByUid || '';
    saved.preparedByName = options?.preparedByName || '';
    saved.preparedAt = nowIso();
    await put(STORES.profiles, saved);
    await setPin(profile.uid, pin);
    emitChange();
    return getProfile(profile.uid);
  }

  async function listProfiles(options) {
    const onlyWithPin = options?.onlyWithPin !== false;
    const onlyOperators = options?.onlyOperators !== false;
    const profiles = await getAll(STORES.profiles);
    return profiles
      .filter(profile => profile.active !== false)
      .filter(profile => !onlyOperators || profile.role === 'operador')
      .filter(profile => !onlyWithPin || Boolean(profile.pinHash))
      .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
  }

  function getProfile(uid) {
    return get(STORES.profiles, uid);
  }

  async function setPin(uid, pin) {
    const cleanPin = String(pin || '').trim();
    if (cleanPin.length < 4 || cleanPin.length > 64) throw new Error('La clave offline debe tener entre 4 y 64 caracteres.');
    const profile = await getProfile(uid);
    if (!profile) throw new Error('Primero prepara el usuario en este dispositivo.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 150000;
    profile.pinSalt = bytesToBase64(salt);
    profile.pinHash = await derivePin(cleanPin, salt, iterations);
    profile.pinIterations = iterations;
    profile.pinUpdatedAt = nowIso();
    profile.failedPinAttempts = 0;
    profile.lockedUntil = '';
    await put(STORES.profiles, profile);
    emitChange();
    return true;
  }

  async function verifyPin(uid, pin) {
    const profile = await getProfile(uid);
    if (!profile?.pinHash || !profile.pinSalt || profile.active === false) return false;
    const lockedUntil = new Date(profile.lockedUntil || 0).getTime();
    if (lockedUntil > Date.now()) {
      const seconds = Math.ceil((lockedUntil - Date.now()) / 1000);
      throw new Error(`Demasiados intentos. Espera ${seconds} segundos.`);
    }
    const candidate = await derivePin(String(pin || ''), base64ToBytes(profile.pinSalt), profile.pinIterations || 150000);
    const valid = candidate === profile.pinHash;
    if (valid) {
      profile.failedPinAttempts = 0;
      profile.lockedUntil = '';
      profile.lastOfflineLoginAt = nowIso();
    } else {
      profile.failedPinAttempts = Number(profile.failedPinAttempts || 0) + 1;
      if (profile.failedPinAttempts >= 5) {
        profile.lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        profile.failedPinAttempts = 0;
      }
    }
    await put(STORES.profiles, profile);
    return valid;
  }

  async function removePin(uid) {
    const profile = await getProfile(uid);
    if (!profile) return;
    delete profile.pinHash;
    delete profile.pinSalt;
    delete profile.pinIterations;
    delete profile.pinUpdatedAt;
    delete profile.failedPinAttempts;
    delete profile.lockedUntil;
    await put(STORES.profiles, profile);
    emitChange();
  }

  async function updateProfileState(uid, patch) {
    const profile = await getProfile(uid);
    if (!profile) return null;
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'active')) profile.active = patch.active === true;
    if (patch?.role) profile.role = String(patch.role);
    if (patch?.nombre) profile.nombre = String(patch.nombre);
    if (patch?.email) profile.email = String(patch.email);
    profile.updatedAtLocal = nowIso();
    await put(STORES.profiles, profile);
    if (profile.active === false || profile.role !== 'operador') {
      const session = await getSetting('active_session');
      if (session?.uid === uid) await clearActiveSession();
    }
    emitChange();
    return profile;
  }

  async function removeProvisionedProfile(uid) {
    const pending = await pendingCount(uid);
    if (pending) throw new Error('No puedes quitar este usuario mientras tenga marcas pendientes de sincronización.');
    await remove(STORES.profiles, uid);
    emitChange();
  }

  async function hasPin(uid) {
    const profile = await getProfile(uid);
    return Boolean(profile?.pinHash && profile?.pinSalt);
  }

  async function createSession(uid, mode, durationMs) {
    const profile = await getProfile(uid);
    if (!profile || profile.active === false) throw new Error('El usuario local no está habilitado.');
    const duration = Math.max(60 * 1000, Math.min(Number(durationMs || SESSION_DURATION_MS), SESSION_DURATION_MS));
    const session = {
      uid,
      mode: mode === 'online' ? 'online' : 'offline',
      startedAt: nowIso(),
      expiresAt: new Date(Date.now() + duration).toISOString(),
      nonce: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)))
    };
    await setSetting('active_session', session);
    emitChange();
    return session;
  }

  async function getActiveSession() {
    const session = await getSetting('active_session');
    if (!session?.uid || !session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      if (session) await clearActiveSession();
      return null;
    }
    const profile = await getProfile(session.uid);
    if (!profile || profile.active === false || (session.mode === 'offline' && !profile.pinHash)) {
      await clearActiveSession();
      return null;
    }
    return { ...session, profile };
  }

  async function clearActiveSession() {
    await removeSetting('active_session').catch(() => {});
    emitChange();
  }

  async function ensureDeviceIdentity(deviceName) {
    let identity = await getSetting('device_identity');
    if (!identity?.deviceId || !identity?.deviceToken) {
      const randomId = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
      const randomToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      identity = {
        deviceId: `device_${randomId}`,
        deviceToken: randomToken,
        deviceName: String(deviceName || navigator.userAgent || 'Dispositivo Lubayd').slice(0, 100),
        createdAt: nowIso(),
        enrolled: false
      };
      await setSetting('device_identity', identity);
    } else if (deviceName && identity.deviceName !== deviceName) {
      identity.deviceName = String(deviceName).slice(0, 100);
      await setSetting('device_identity', identity);
    }
    return clone(identity);
  }

  async function getDeviceIdentity() {
    return clone(await getSetting('device_identity') || null);
  }

  async function getDeviceEnrollmentPayload(deviceName) {
    const identity = await ensureDeviceIdentity(deviceName);
    const allowedUserIds = (await listProfiles({ onlyWithPin: true, onlyOperators: true })).map(profile => profile.uid);
    return {
      deviceId: identity.deviceId,
      deviceToken: identity.deviceToken,
      tokenHash: await sha256Hex(identity.deviceToken),
      deviceName: identity.deviceName,
      allowedUserIds
    };
  }

  async function markDeviceEnrolled(data) {
    const identity = await ensureDeviceIdentity(data?.deviceName);
    identity.enrolled = true;
    identity.enrolledAt = nowIso();
    identity.allowedUserIds = clone(data?.allowedUserIds || []);
    identity.lastEnrollmentByUid = data?.preparedByUid || '';
    await setSetting('device_identity', identity);
    emitChange();
    return identity;
  }

  async function markDeviceRevoked() {
    const identity = await getDeviceIdentity();
    if (!identity) return null;
    identity.enrolled = false;
    identity.revokedAt = nowIso();
    await setSetting('device_identity', identity);
    emitChange();
    return identity;
  }

  const OFFLINE_SYNC_URL = 'https://southamerica-east1-lubayd-sa.cloudfunctions.net/syncOfflineAttendance';

  async function syncQueueItemWithDevice(item, identity) {
    if (!identity?.deviceId || !identity?.deviceToken) throw new Error('Este dispositivo no fue preparado por un administrador.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(OFFLINE_SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: identity.deviceId, deviceToken: identity.deviceToken, item }),
        signal: controller.signal
      });
      let result = {};
      try { result = await response.json(); } catch (_) { result = {}; }
      if (!response.ok || result.ok !== true) throw new Error(result.error || `No se pudo sincronizar la marca (${response.status}).`);
      return result.record || null;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La sincronización demoró demasiado. Vuelve a intentar.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
      localUpdatedAt: record.localUpdatedAt || nowIso()
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
    remote.localUpdatedAt = nowIso();
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
    await put(STORES.photos, { ...clone(photo), savedAt: nowIso() });
    return photo;
  }

  function getPhoto(id) {
    return get(STORES.photos, id);
  }

  async function enqueueMark(payload) {
    const type = payload?.type === 'exit' ? 'exit' : 'entry';
    const required = ['attendanceId', 'userId', 'dateKey', 'photoId', 'imageData', 'capturedAt'];
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
      localUpdatedAt: nowIso()
    };
    if (type === 'entry' && current.entryAt) throw new Error('La llegada de hoy ya está registrada.');
    if (type === 'exit' && !current.entryAt) throw new Error('Primero debes registrar la llegada.');
    if (type === 'exit' && current.exitAt) throw new Error('La salida de hoy ya está registrada.');

    const mutationId = payload.clientMutationId || `${payload.userId}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const prefix = type === 'entry' ? 'entry' : 'exit';
    current[`${prefix}At`] = payload.capturedAt;
    current[`${prefix}AtClient`] = payload.capturedAt;
    current[`${prefix}PhotoId`] = payload.photoId;
    current[`${prefix}Gps`] = payload.gps ? clone(payload.gps) : null;
    current[`${prefix}ClientMutationId`] = mutationId;
    current[`${prefix}SyncStatus`] = 'pending';
    current[`${prefix}SyncError`] = '';
    current[`${prefix}OfflineCaptured`] = Boolean(payload.offlineCaptured);
    current.status = type === 'exit' ? 'finalizado' : 'trabajando';
    current.localUpdatedAt = nowIso();

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
      gps: payload.gps ? clone(payload.gps) : null,
      clientMutationId: mutationId,
      offlineCaptured: Boolean(payload.offlineCaptured),
      status: 'pending',
      attempts: 0,
      lastError: '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORES.attendance, STORES.photos, STORES.queue], 'readwrite');
      transaction.objectStore(STORES.attendance).put(clone(current));
      transaction.objectStore(STORES.photos).put({ id: payload.photoId, imageData: payload.imageData, mimeType: 'image/jpeg', ownerId: payload.userId, attendanceId: payload.attendanceId, kind: type, savedAt: nowIso() });
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
    Object.assign(item, clone(changes), { updatedAt: nowIso() });
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
    item.updatedAt = nowIso();
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


  const OFFLINE_PART_SYNC_URL = 'https://southamerica-east1-lubayd-sa.cloudfunctions.net/syncOfflinePart';

  async function enqueuePartOperation(payload) {
    const operation = payload?.operation === 'delete' ? 'delete' : 'upsert';
    const recordId = String(payload?.recordId || payload?.record?.id || '').trim();
    const userId = String(payload?.userId || payload?.record?.createdByUid || '').trim();
    if (!recordId || !userId) throw new Error('El parte no tiene identificadores válidos.');
    const current = await get(STORES.partQueue, recordId);
    if (operation === 'delete' && current?.operation === 'upsert' && current.status !== 'synced') {
      await remove(STORES.partQueue, recordId);
      emitChange();
      return null;
    }
    const item = {
      recordId,
      userId,
      operation,
      record: operation === 'upsert' ? clone(payload.record || {}) : { id: recordId, createdByUid: userId },
      status: 'pending',
      attempts: Number(current?.attempts || 0),
      lastError: '',
      createdAt: current?.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    await put(STORES.partQueue, item);
    emitChange();
    return item;
  }

  function getPartQueueItem(recordId) {
    return get(STORES.partQueue, recordId);
  }

  async function listPartQueue(options) {
    const items = await getAll(STORES.partQueue);
    return items
      .filter(item => !options?.userId || item.userId === options.userId)
      .filter(item => !options?.statuses || options.statuses.includes(item.status))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function updatePartQueue(recordId, changes) {
    const item = await getPartQueueItem(recordId);
    if (!item) return null;
    Object.assign(item, clone(changes || {}), { updatedAt: nowIso() });
    await put(STORES.partQueue, item);
    emitChange();
    return item;
  }

  async function removePartQueue(recordId) {
    await remove(STORES.partQueue, recordId).catch(() => {});
    emitChange();
  }

  async function markPartSynced(recordId) {
    await removePartQueue(recordId);
  }

  async function markPartError(recordId, error) {
    const item = await getPartQueueItem(recordId);
    if (!item) return;
    item.status = 'error';
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastError = error?.message || String(error || 'Error desconocido');
    item.updatedAt = nowIso();
    await put(STORES.partQueue, item);
    emitChange();
  }

  async function syncPartQueueItemWithDevice(item, identity, options = {}) {
    const idToken = String(options?.idToken || '').trim();
    const hasDeviceCredential = Boolean(identity?.deviceId && identity?.deviceToken);
    if (!idToken && !hasDeviceCredential) throw new Error('Inicia sesión con el mismo operador o prepara este dispositivo para sincronizar.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      const response = await fetch(OFFLINE_PART_SYNC_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          deviceId: identity?.deviceId || '',
          deviceToken: identity?.deviceToken || '',
          item
        }),
        signal: controller.signal
      });
      let result = {};
      try { result = await response.json(); } catch (_) { result = {}; }
      if (!response.ok || result.ok !== true) throw new Error(result.error || `No se pudo sincronizar el parte (${response.status}).`);
      return result.record || null;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La sincronización del parte demoró demasiado.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  window.LubaydOffline = {
    available: 'indexedDB' in window,
    sessionDurationMs: SESSION_DURATION_MS,
    openDatabase,
    saveProfile,
    provisionProfile,
    listProfiles,
    getProfile,
    setPin,
    verifyPin,
    removePin,
    updateProfileState,
    removeProvisionedProfile,
    hasPin,
    createSession,
    getActiveSession,
    clearActiveSession,
    ensureDeviceIdentity,
    getDeviceIdentity,
    getDeviceEnrollmentPayload,
    markDeviceEnrolled,
    markDeviceRevoked,
    sha256Hex,
    syncQueueItemWithDevice,
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
    pruneSyncedAttendance,
    enqueuePartOperation,
    getPartQueueItem,
    listPartQueue,
    updatePartQueue,
    removePartQueue,
    markPartSynced,
    markPartError,
    syncPartQueueItemWithDevice
  };
})();
