/* Lubayd SA V22.0.0 - capa de datos y sincronizacion */
(function () {
  'use strict';
  const { state, uid, clone, emit, localDateKey } = window.Lubayd;
  const COLLECTIONS = { part: 'partes', attendance: 'asistencias', break: 'descansos', fuel: 'combustible_flujo_movimientos' };
  let syncing = false;

  function sessionIdentity() {
    if (!state.user || !state.profile) throw new Error('Debes iniciar sesión.');
    return {
      userId: state.user.uid,
      userName: state.profile.nombre || state.user.displayName || state.user.email || 'Usuario',
      userEmail: state.user.email || state.profile.email || ''
    };
  }
  function isManager() { return ['admin', 'supervisor'].includes(state.profile?.role); }
  function operationalPayload(payload) {
    const identity = sessionIdentity();
    return Object.assign({}, clone(payload || {}), identity, {
      createdByUid: identity.userId,
      createdByName: identity.userName,
      createdByEmail: identity.userEmail
    });
  }
  async function save(type, payload, options = {}) {
    if (!COLLECTIONS[type]) throw new Error('Tipo de registro no válido.');
    const identity = sessionIdentity();
    const id = options.id || uid(type);
    const existing = await window.LubaydOffline.get('records', id).catch(() => null);
    const now = new Date().toISOString();
    const mergedPayload = Object.assign({}, existing?.payload || {}, operationalPayload(payload));
    const record = {
      id,
      type,
      userId: identity.userId,
      userName: identity.userName,
      userEmail: identity.userEmail,
      dateKey: payload.dateKey || existing?.dateKey || localDateKey(),
      payload: mergedPayload,
      status: 'pending',
      createdAtClient: existing?.createdAtClient || now,
      updatedAtClient: now,
      attempts: existing?.attempts || 0
    };
    await window.LubaydOffline.queueRecord(record);
    if (navigator.onLine) syncOne(id).catch(error => console.warn('[Lubayd] Sincronización inmediata:', error));
    return clone(record);
  }
  function functionUnavailable(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code.includes('not-found') || code.includes('unavailable') || code.includes('internal') || message.includes('not found') || message.includes('no está disponible');
  }
  async function directFallback(entry) {
    const cloud = window.LubaydCloud;
    const current = cloud?.currentUser?.();
    if (!current || current.uid !== entry.userId || entry.type === 'fuel') throw new Error('Se requiere la Function de sincronización para este registro.');
    const collection = COLLECTIONS[entry.type];
    const payload = Object.assign({}, clone(entry.payload), {
      id: entry.id,
      recordType: entry.type,
      userId: entry.userId,
      dateKey: entry.dateKey,
      createdAtClient: entry.createdAtClient,
      updatedAtClient: entry.updatedAtClient,
      syncedByUid: current.uid,
      syncedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await cloud.collection(collection).doc(entry.id).set(payload, { merge: entry.type !== 'part' });
    return { ok: true, fallback: true };
  }
  async function syncOne(id) {
    if (!navigator.onLine) throw new Error('No hay conexión.');
    let entry = await window.LubaydOffline.markSyncing(id);
    if (!entry) return { ok: true, missing: true };
    try {
      const authorization = await window.LubaydOffline.deviceAuthorization(entry.userId);
      let result;
      try {
        result = await window.LubaydCloud.call('syncOfflineRecord', { record: entry, device: authorization });
      } catch (functionError) {
        if (!functionUnavailable(functionError)) throw functionError;
        console.warn('[Lubayd] Function no disponible, intentando ruta directa:', functionError);
        result = await directFallback(entry);
      }
      await window.LubaydOffline.markSynced(id, result);
      if (entry.type === 'fuel' && result?.state) await window.LubaydOffline.setCache('fuel_state', result.state);
      emit('lubayd-data-synced', { type: entry.type, id, result });
      return result;
    } catch (error) {
      await window.LubaydOffline.markError(id, error);
      throw error;
    }
  }
  async function syncAll(options = {}) {
    if (syncing) return { running: true, total: 0, synced: 0, errors: [] };
    if (!navigator.onLine) throw new Error('No hay conexión a internet.');
    syncing = true;
    emit('lubayd-sync-state', { syncing: true });
    let entries = [];
    let synced = 0;
    const errors = [];
    try {
      const userId = options.allUsers ? null : state.user?.uid;
      entries = await window.LubaydOffline.pendingQueue(userId);
      for (const entry of entries) {
        try { await syncOne(entry.id); synced += 1; }
        catch (error) { errors.push({ id: entry.id, message: error.message || String(error) }); }
      }
      return { total: entries.length, synced, errors };
    } finally {
      syncing = false;
      emit('lubayd-sync-state', { syncing: false, total: entries.length, synced, errors });
    }
  }
  function cloudRecord(type, doc) {
    const data = window.LubaydCloud.normalize(doc.data() || {});
    return {
      id: doc.id,
      type,
      userId: data.userId || data.createdByUid || '',
      userName: data.userName || data.createdByName || '',
      userEmail: data.userEmail || data.createdByEmail || '',
      dateKey: data.dateKey || '',
      payload: data,
      status: 'synced',
      createdAtClient: data.createdAtClient || data.updatedAtClient || data.syncedAt || '',
      updatedAtClient: data.updatedAtClient || data.createdAtClient || ''
    };
  }
  async function loadCloud(type, options = {}) {
    if (!navigator.onLine || !window.LubaydCloud?.db || state.offlineSession) return [];
    let query = window.LubaydCloud.collection(COLLECTIONS[type]);
    if (!isManager() && type !== 'fuel') {
      const field = type === 'part' ? 'createdByUid' : 'userId';
      query = query.where(field, '==', state.user.uid);
    }
    if (options.dateKey) query = query.where('dateKey', '==', options.dateKey);
    const snapshot = await query.limit(Number(options.limit || 100)).get();
    const records = snapshot.docs.map(doc => cloudRecord(type, doc));
    for (const record of records) {
      const local = await window.LubaydOffline.get('records', record.id).catch(() => null);
      if (!local || local.status === 'synced') await window.LubaydOffline.saveRecord(record);
    }
    return records;
  }
  async function list(type, options = {}) {
    if (options.refresh !== false) {
      try { await loadCloud(type, options); } catch (error) { console.warn(`[Lubayd] Carga ${type}:`, error); }
    }
    return window.LubaydOffline.listRecords(type, {
      userId: options.onlyMine && state.user ? state.user.uid : null,
      dateKey: options.dateKey || null
    });
  }
  async function pendingCount() { return window.LubaydOffline.pendingCount(state.user?.uid); }

  function defaultFuelState() { return { tankLiters: 0, trailerLiters: 0, machines: {}, updatedAtClient: new Date().toISOString() }; }
  async function fuelState(refresh = true) {
    let current = await window.LubaydOffline.getCache('fuel_state', defaultFuelState());
    if (refresh && navigator.onLine) {
      try {
        const authorization = state.user ? await window.LubaydOffline.deviceAuthorization(state.user.uid) : null;
        const result = await window.LubaydCloud.call('getFuelFlowState', { device: authorization });
        if (result?.state) {
          current = result.state;
          await window.LubaydOffline.setCache('fuel_state', current);
        }
      } catch (error) { console.warn('[Lubayd] Estado de combustible:', error); }
    }
    return Object.assign(defaultFuelState(), clone(current || {}));
  }
  function applyFuelMovement(current, movement) {
    const next = Object.assign(defaultFuelState(), clone(current || {}));
    next.machines = Object.assign({}, next.machines || {});
    const liters = Number(movement.liters);
    if (!(liters > 0)) throw new Error('Los litros deben ser mayores que cero.');
    switch (movement.action) {
      case 'tank_load': next.tankLiters += liters; break;
      case 'trailer_load':
        if (next.tankLiters < liters) throw new Error('El tanque general no tiene saldo suficiente.');
        next.tankLiters -= liters; next.trailerLiters += liters; break;
      case 'machine_delivery':
        if (!movement.machine) throw new Error('Selecciona una máquina.');
        if (next.trailerLiters < liters) throw new Error('El tráiler no tiene saldo suficiente.');
        next.trailerLiters -= liters; next.machines[movement.machine] = Number(next.machines[movement.machine] || 0) + liters; break;
      case 'tank_adjust': next.tankLiters = liters; break;
      case 'trailer_adjust': next.trailerLiters = liters; break;
      default: throw new Error('Movimiento de combustible no válido.');
    }
    next.tankLiters = Math.round(next.tankLiters * 100) / 100;
    next.trailerLiters = Math.round(next.trailerLiters * 100) / 100;
    next.updatedAtClient = new Date().toISOString();
    return next;
  }
  async function saveFuel(movement) {
    const current = await fuelState(false);
    const optimistic = applyFuelMovement(current, movement);
    await window.LubaydOffline.setCache('fuel_state', optimistic);
    const record = await save('fuel', Object.assign({}, movement, { dateKey: movement.dateKey || localDateKey(), localStateAfter: optimistic }));
    emit('lubayd-fuel-state-changed', { state: optimistic });
    return record;
  }

  window.addEventListener('online', () => {
    if (state.user) syncAll().catch(error => console.warn('[Lubayd] Reintento online:', error));
  });
  window.LubaydData = { COLLECTIONS, save, saveFuel, list, loadCloud, syncOne, syncAll, pendingCount, fuelState, applyFuelMovement, isManager, get syncing() { return syncing; } };
})();
