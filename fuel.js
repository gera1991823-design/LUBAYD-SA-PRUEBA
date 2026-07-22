/* Lubayd SA V21.0 - combustible por flujo: tanque general -> trailer -> maquinas */
(function () {
  'use strict';

  const VERSION = '21.0.0';
  const TIME_ZONE = 'America/Montevideo';
  const MAX_PHOTO_DATA_LENGTH = 480000;
  const MACHINE_CACHE_KEY = 'lubayd_fuel_flow_machines_v21';
  const DONUT_COLORS = ['#138b50', '#2f79ce', '#e3a41c', '#8b5cf6', '#e35d6a', '#0b7a74'];
  const DEFAULT_MACHINES = [
    { id: 'machine_1', code: 'Máquina 1', model: 'Equipo forestal', status: 'activa' },
    { id: 'machine_2', code: 'Máquina 2', model: 'Equipo forestal', status: 'activa' },
    { id: 'machine_3', code: 'Máquina 3', model: 'Equipo forestal', status: 'activa' }
  ];

  const state = {
    flow: emptyFlowState(),
    serverFlow: null,
    movements: [],
    queue: [],
    machines: loadCachedMachines(),
    selectedDate: dateKey(),
    typeFilter: 'all',
    modalKind: 'tank_receipt',
    photoDataUrl: '',
    syncPromise: null,
    cloudUnsubscribe: null,
    machineUnsubscribe: null,
    refreshTimer: null
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const roundLiters = value => Math.round(num(value) * 100) / 100;
  const liters = value => `${new Intl.NumberFormat('es-UY', { maximumFractionDigits: 2 }).format(roundLiters(value))} L`;
  const role = () => window.LubaydCurrentProfile?.role || 'operador';
  const isOperator = () => role() === 'operador';
  const isManager = () => ['admin', 'supervisor'].includes(role());
  const isOffline = () => Boolean(window.LubaydOfflineSession);
  const onlineUser = () => window.firebase?.auth?.().currentUser || null;
  const randomId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  function zonedParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  }

  function dateKey(date = new Date()) {
    const parts = zonedParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function timeKey(date = new Date()) {
    const parts = zonedParts(date);
    return `${parts.hour}:${parts.minute}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
    return new Intl.DateTimeFormat('es-UY', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ');
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: TIME_ZONE,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
  }

  function emptyFlowState() {
    return {
      id: 'local',
      version: 21,
      tankBalance: 0,
      trailerBalance: 0,
      tankReceivedTotal: 0,
      tankToTrailerTotal: 0,
      trailerLoadedTotal: 0,
      trailerDeliveredTotal: 0,
      machineTotals: {},
      lastMovementId: '',
      lastMovementAt: '',
      serverConfirmed: false
    };
  }

  function normalizeFlowState(value) {
    const source = value || {};
    const machineTotals = {};
    Object.entries(source.machineTotals || {}).forEach(([key, item]) => {
      machineTotals[key] = {
        machineId: String(item?.machineId || key),
        machineName: String(item?.machineName || key),
        machineModel: String(item?.machineModel || ''),
        liters: roundLiters(item?.liters),
        lastAt: String(item?.lastAt || '')
      };
    });
    return {
      ...emptyFlowState(),
      ...source,
      tankBalance: Math.max(0, roundLiters(source.tankBalance)),
      trailerBalance: Math.max(0, roundLiters(source.trailerBalance)),
      tankReceivedTotal: Math.max(0, roundLiters(source.tankReceivedTotal)),
      tankToTrailerTotal: Math.max(0, roundLiters(source.tankToTrailerTotal)),
      trailerLoadedTotal: Math.max(0, roundLiters(source.trailerLoadedTotal)),
      trailerDeliveredTotal: Math.max(0, roundLiters(source.trailerDeliveredTotal)),
      machineTotals
    };
  }

  function loadCachedMachines() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MACHINE_CACHE_KEY) || '[]');
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (_) {}
    return DEFAULT_MACHINES;
  }

  function cacheMachines(items) {
    const normalized = (items || []).map(item => ({
      id: String(item.id || item.code || randomId('machine')),
      code: String(item.code || item.name || item.model || 'Máquina'),
      model: String(item.model || ''),
      status: String(item.status || 'activa')
    })).filter(item => item.status !== 'inactiva');
    state.machines = normalized.length ? normalized : DEFAULT_MACHINES;
    try { localStorage.setItem(MACHINE_CACHE_KEY, JSON.stringify(state.machines)); } catch (_) {}
    fillMachineSelect();
    render();
  }

  function allMachines() {
    const map = new Map(state.machines.map(item => [item.id, item]));
    Object.values(state.flow.machineTotals || {}).forEach(item => {
      if (!map.has(item.machineId)) map.set(item.machineId, {
        id: item.machineId,
        code: item.machineName || item.machineId,
        model: item.machineModel || '',
        status: 'activa'
      });
    });
    return Array.from(map.values());
  }

  function machineById(machineId) {
    return allMachines().find(item => item.id === machineId) || null;
  }

  function notify(title, text, type = 'success') {
    if (typeof window.showToast === 'function') return window.showToast(title, text, type);
    const toast = $('#toast');
    if (!toast) return;
    $('#toastTitle').textContent = title;
    $('#toastText').textContent = text || '';
    toast.classList.remove('hidden');
    window.setTimeout(() => toast.classList.add('hidden'), 4200);
  }

  function syncBadge(status, error = '') {
    const value = status || 'pending';
    const label = value === 'synced' ? 'Sincronizado' : value === 'error' ? 'Error' : value === 'syncing' ? 'Sincronizando' : 'Pendiente';
    return `<span class="fuel-flow-sync-badge ${escapeHtml(value)}"${error ? ` title="${escapeHtml(error)}"` : ''}>${label}</span>`;
  }

  function movementMeta(kind) {
    const map = {
      tank_receipt: { label: 'Ingreso al tanque', short: 'Proveedor → Tanque', icon: 'i-tank', className: 'tank', origin: 'Proveedor', destination: 'Tanque general' },
      trailer_load: { label: 'Carga al tráiler', short: 'Tanque → Tráiler', icon: 'i-trailer', className: 'trailer', origin: 'Tanque general', destination: 'Tráiler' },
      machine_delivery: { label: 'Entrega a máquina', short: 'Tráiler → Máquina', icon: 'i-machine', className: 'machine', origin: 'Tráiler', destination: 'Máquina' },
      legacy_import: { label: 'Saldo importado', short: 'Versión anterior', icon: 'i-transfer', className: 'tank', origin: 'Histórico', destination: 'Tanque general' }
    };
    return map[kind] || map.tank_receipt;
  }

  function applyMovement(flowValue, record, strict = true) {
    const flow = normalizeFlowState(flowValue);
    const litersValue = roundLiters(record.liters);
    if (!(litersValue > 0)) throw new Error('Los litros deben ser mayores a cero.');
    const movement = { ...record, liters: litersValue };
    const tankBefore = flow.tankBalance;
    const trailerBefore = flow.trailerBalance;
    let tankAfter = tankBefore;
    let trailerAfter = trailerBefore;
    let machineTotalAfter = 0;

    if (record.kind === 'tank_receipt') {
      tankAfter = roundLiters(tankBefore + litersValue);
      flow.tankReceivedTotal = roundLiters(flow.tankReceivedTotal + litersValue);
    } else if (record.kind === 'trailer_load') {
      if (strict && litersValue > tankBefore + 0.0001) throw new Error(`No puedes cargar ${liters(litersValue)} porque en el tanque quedan ${liters(tankBefore)}.`);
      tankAfter = roundLiters(Math.max(0, tankBefore - litersValue));
      trailerAfter = roundLiters(trailerBefore + litersValue);
      flow.tankToTrailerTotal = roundLiters(flow.tankToTrailerTotal + litersValue);
      flow.trailerLoadedTotal = roundLiters(flow.trailerLoadedTotal + litersValue);
    } else if (record.kind === 'machine_delivery') {
      if (!record.machineId || !record.machineName) throw new Error('Selecciona la máquina que recibe el combustible.');
      if (strict && litersValue > trailerBefore + 0.0001) throw new Error(`No puedes entregar ${liters(litersValue)} porque en el tráiler quedan ${liters(trailerBefore)}.`);
      trailerAfter = roundLiters(Math.max(0, trailerBefore - litersValue));
      flow.trailerDeliveredTotal = roundLiters(flow.trailerDeliveredTotal + litersValue);
      const current = flow.machineTotals[record.machineId] || {
        machineId: record.machineId,
        machineName: record.machineName,
        machineModel: record.machineModel || '',
        liters: 0,
        lastAt: ''
      };
      machineTotalAfter = roundLiters(current.liters + litersValue);
      flow.machineTotals[record.machineId] = {
        ...current,
        machineName: record.machineName,
        machineModel: record.machineModel || current.machineModel || '',
        liters: machineTotalAfter,
        lastAt: record.dateTime || record.createdAt || ''
      };
    } else if (record.kind === 'legacy_import') {
      tankAfter = roundLiters(litersValue);
      flow.tankReceivedTotal = Math.max(flow.tankReceivedTotal, tankAfter);
    } else {
      throw new Error('Tipo de movimiento no admitido.');
    }

    flow.tankBalance = tankAfter;
    flow.trailerBalance = trailerAfter;
    flow.lastMovementId = record.id || flow.lastMovementId;
    flow.lastMovementAt = record.dateTime || record.createdAt || flow.lastMovementAt;
    flow.serverConfirmed = false;

    return {
      flow,
      movement: {
        ...movement,
        tankBefore,
        tankAfter,
        trailerBefore,
        trailerAfter,
        machineTotalAfter,
        originName: record.originName || movementMeta(record.kind).origin,
        destinationName: record.destinationName || (record.kind === 'machine_delivery' ? record.machineName : movementMeta(record.kind).destination)
      }
    };
  }

  async function refreshLocal() {
    if (!window.LubaydOffline?.listFuelFlowMovements) return;
    const [serverFlow, localFlow, localMovements, queue] = await Promise.all([
      window.LubaydOffline.getFuelFlowState('server').catch(() => null),
      window.LubaydOffline.getFuelFlowState('local').catch(() => null),
      window.LubaydOffline.listFuelFlowMovements(),
      window.LubaydOffline.listFuelFlowQueue({ statuses: ['pending', 'error', 'syncing'] })
    ]);

    state.serverFlow = serverFlow ? normalizeFlowState(serverFlow) : null;
    state.queue = queue;

    if (isManager() && !isOffline()) {
      state.flow = state.serverFlow || emptyFlowState();
      state.movements = localMovements.filter(item => item.serverConfirmed === true || item.syncStatus === 'synced');
    } else if (state.serverFlow) {
      let optimistic = normalizeFlowState(state.serverFlow);
      const pendingRecords = queue.map(item => item.record).filter(Boolean).sort((a, b) => String(a.dateTime || a.createdAt || '').localeCompare(String(b.dateTime || b.createdAt || '')));
      for (const record of pendingRecords) {
        try { optimistic = applyMovement(optimistic, record, false).flow; } catch (_) {}
      }
      state.flow = optimistic;
      state.movements = localMovements;
    } else {
      state.flow = normalizeFlowState(localFlow || emptyFlowState());
      state.movements = localMovements;
    }

    state.movements.sort((a, b) => String(b.dateTime || b.createdAt || '').localeCompare(String(a.dateTime || a.createdAt || '')));
    render();
  }

  function render() {
    const root = $('#fuelFlowContent');
    if (!root) return;
    const flow = state.flow;
    const manager = isManager();
    $$('.fuel-operator-action').forEach(element => element.classList.toggle('hidden', !isOperator()));
    $('#fuelFlowReadOnlyNotice')?.classList.toggle('hidden', !manager);

    setText('#fuelFlowTankBalance', liters(flow.tankBalance));
    setText('#fuelFlowTrailerBalance', liters(flow.trailerBalance));
    setText('#fuelFlowTankReceived', liters(flow.tankReceivedTotal));
    setText('#fuelFlowToTrailer', liters(flow.tankToTrailerTotal));
    setText('#fuelFlowTrailerLoaded', liters(flow.trailerLoadedTotal));
    setText('#fuelFlowDelivered', liters(flow.trailerDeliveredTotal));
    setText('#fuelFlowTankUpdated', flow.lastMovementAt ? `Último movimiento: ${formatDateTime(flow.lastMovementAt)}` : 'Sin movimientos');
    setText('#fuelFlowTrailerUpdated', flow.lastMovementAt ? `Actualizado: ${formatDateTime(flow.lastMovementAt)}` : 'Sin movimientos');
    setText('#fuelFlowMachineGrandTotal', liters(flow.trailerDeliveredTotal));
    setText('#fuelFlowStatusToTrailer', liters(flow.tankToTrailerTotal));
    setText('#fuelFlowStatusToMachines', liters(flow.trailerDeliveredTotal));
    setText('#fuelFlowStatusTrailer', liters(flow.trailerBalance));
    setText('#fuelFlowStatusTank', liters(flow.tankBalance));
    setText('#fuelFlowPendingCount', String(state.queue.length));

    renderMachineCards();
    renderDaySummary();
    renderMovements();
    renderMachineChart();
    renderRecentPhotos();
    updateMovementPreview();
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function renderMachineCards() {
    const root = $('#fuelFlowMachineCards');
    if (!root) return;
    const list = allMachines();
    root.innerHTML = list.length ? list.map(machine => {
      const total = state.flow.machineTotals[machine.id]?.liters || 0;
      const dayTotal = state.movements.filter(item => item.kind === 'machine_delivery' && item.machineId === machine.id && item.dateKey === state.selectedDate).reduce((sum, item) => sum + num(item.liters), 0);
      const detail = `${machine.model || 'Equipo forestal'} · ${formatDate(state.selectedDate)}: ${liters(dayTotal)}`;
      return `<article class="fuel-flow-machine-item"><span class="fuel-flow-machine-avatar"><svg><use href="#i-machine"></use></svg></span><div><strong>${escapeHtml(machine.code || 'Máquina')}</strong><small>${escapeHtml(detail)}</small></div><b>${escapeHtml(liters(total))}</b></article>`;
    }).join('') : '<div class="fuel-flow-empty-small">No hay máquinas disponibles.</div>';
  }

  function selectedDayMovements() {
    return state.movements.filter(item => item.dateKey === state.selectedDate && (state.typeFilter === 'all' || item.kind === state.typeFilter));
  }

  function renderDaySummary() {
    const all = state.movements.filter(item => item.dateKey === state.selectedDate);
    const chronological = [...all].sort((a, b) => String(a.dateTime || a.createdAt || '').localeCompare(String(b.dateTime || b.createdAt || '')));
    const sum = kind => roundLiters(all.filter(item => item.kind === kind).reduce((total, item) => total + num(item.liters), 0));
    const count = kind => all.filter(item => item.kind === kind).length;
    const closingTank = chronological.length ? num(chronological[chronological.length - 1].tankAfter) : (state.selectedDate === dateKey() ? state.flow.tankBalance : 0);
    setText('#fuelFlowDayTitle', formatDate(state.selectedDate));
    setText('#fuelFlowDayReceipts', liters(sum('tank_receipt')));
    setText('#fuelFlowDayReceiptCount', `${count('tank_receipt')} movimiento${count('tank_receipt') === 1 ? '' : 's'}`);
    setText('#fuelFlowDayTrailer', liters(sum('trailer_load')));
    setText('#fuelFlowDayTrailerCount', `${count('trailer_load')} movimiento${count('trailer_load') === 1 ? '' : 's'}`);
    setText('#fuelFlowDayMachines', liters(sum('machine_delivery')));
    setText('#fuelFlowDayMachineCount', `${count('machine_delivery')} movimiento${count('machine_delivery') === 1 ? '' : 's'}`);
    setText('#fuelFlowDayTankBalance', liters(closingTank));
    setText('#fuelFlowMovementsTitle', `Movimientos · ${formatDate(state.selectedDate)}`);
  }

  function renderMovements() {
    const root = $('#fuelFlowMovements');
    if (!root) return;
    const list = selectedDayMovements();
    if (!list.length) {
      root.innerHTML = '<div class="fuel-flow-empty">Todavía no hay movimientos para esta fecha.</div>';
      return;
    }
    root.innerHTML = list.map(item => {
      const meta = movementMeta(item.kind);
      const destination = item.kind === 'machine_delivery' ? (item.machineName || item.destinationName || 'Máquina') : meta.destination;
      const balanceLabel = item.kind === 'machine_delivery' ? 'Saldo tráiler' : 'Saldo tanque';
      const balanceValue = item.kind === 'machine_delivery' ? item.trailerAfter : item.tankAfter;
      const out = item.kind !== 'tank_receipt';
      return `<article class="fuel-flow-movement">
        <div class="fuel-flow-movement-time"><strong>${escapeHtml(item.timeKey || '')}</strong><span>${escapeHtml(item.dateKey || '')}</span></div>
        <div class="fuel-flow-movement-kind ${meta.className}"><span><svg><use href="#${meta.icon}"></use></svg></span><div><strong>${escapeHtml(meta.label)}</strong><small>${escapeHtml(item.notes || meta.short)}</small></div></div>
        <div class="fuel-flow-route"><strong>${escapeHtml(item.originName || meta.origin)} → ${escapeHtml(destination)}</strong><small>${escapeHtml(item.createdByName || item.createdByEmail || 'Operador')}</small></div>
        <strong class="fuel-flow-liters ${out ? 'out' : ''}">${out ? '−' : '+'}${escapeHtml(liters(item.liters))}</strong>
        <div class="fuel-flow-balance-after"><span>${balanceLabel}</span><strong>${escapeHtml(liters(balanceValue))}</strong></div>
        <div class="fuel-flow-movement-actions">${syncBadge(item.syncStatus, item.syncError)}<button type="button" data-fuel-flow-photo-id="${escapeHtml(item.id)}" aria-label="Ver foto"><svg><use href="#i-camera"></use></svg></button></div>
      </article>`;
    }).join('');
  }

  function renderMachineChart() {
    const root = $('#fuelFlowMachineChart');
    if (!root) return;
    const entries = Object.values(state.flow.machineTotals || {}).filter(item => num(item.liters) > 0).sort((a, b) => num(b.liters) - num(a.liters));
    const total = entries.reduce((sum, item) => sum + num(item.liters), 0);
    let cursor = 0;
    const gradient = entries.length ? entries.map((item, index) => {
      const start = cursor;
      cursor += total ? (num(item.liters) / total) * 100 : 0;
      return `${DONUT_COLORS[index % DONUT_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    }).join(', ') : '#dce8e1 0 100%';
    root.innerHTML = `<div class="fuel-flow-donut" style="background:conic-gradient(${gradient})"><span>${escapeHtml(liters(total))}<small>Total</small></span></div><div class="fuel-flow-chart-legend">${entries.length ? entries.map((item, index) => `<div class="fuel-flow-legend-row"><i style="--legend-color:${DONUT_COLORS[index % DONUT_COLORS.length]}"></i><span>${escapeHtml(item.machineName || item.machineId)}</span><strong>${escapeHtml(liters(item.liters))}</strong></div>`).join('') : '<div class="fuel-flow-empty-small">Sin entregas a máquinas.</div>'}</div>`;
  }

  function renderRecentPhotos() {
    const root = $('#fuelFlowRecentPhotos');
    if (!root) return;
    const list = state.movements.filter(item => item.photoId || item.proofDataUrl).slice(0, 5);
    root.innerHTML = list.length ? list.map(item => `<div class="fuel-flow-photo-thumb" data-fuel-flow-thumb-id="${escapeHtml(item.id)}">${item.proofDataUrl ? `<img src="${item.proofDataUrl}" alt="Comprobante">` : '<span class="fuel-flow-photo-placeholder"><svg><use href="#i-camera"></use></svg></span>'}<button type="button" data-fuel-flow-photo-id="${escapeHtml(item.id)}" aria-label="Ver comprobante"></button></div>`).join('') : '<div class="fuel-flow-empty-small">No hay fotos todavía.</div>';
    if (list.length && onlineUser() && window.LubaydFuelFlowCloud?.getPhoto) window.setTimeout(() => hydrateRecentPhotos(list), 0);
  }

  async function hydrateRecentPhotos(list) {
    for (const item of list) {
      if (item.proofDataUrl || !item.photoId) continue;
      const container = document.querySelector(`[data-fuel-flow-thumb-id="${CSS.escape(item.id)}"]`);
      if (!container || container.querySelector('img')) continue;
      try {
        const dataUrl = await window.LubaydFuelFlowCloud.getPhoto(item.photoId);
        if (!dataUrl || !container.isConnected) continue;
        container.querySelector('.fuel-flow-photo-placeholder')?.remove();
        const image = document.createElement('img');
        image.src = dataUrl;
        image.alt = 'Comprobante';
        container.prepend(image);
      } catch (_) {}
    }
  }

  function fillMachineSelect() {
    const select = $('#fuelFlowMachineSelect');
    if (!select) return;
    const current = select.value;
    select.innerHTML = allMachines().map(machine => `<option value="${escapeHtml(machine.id)}">${escapeHtml(machine.code)}${machine.model ? ` · ${escapeHtml(machine.model)}` : ''}</option>`).join('');
    if (current && allMachines().some(item => item.id === current)) select.value = current;
  }

  function setMovementKind(kind) {
    const allowed = ['tank_receipt', 'trailer_load', 'machine_delivery'];
    state.modalKind = allowed.includes(kind) ? kind : 'tank_receipt';
    if ($('#fuelFlowMovementKind')) $('#fuelFlowMovementKind').value = state.modalKind;
    if ($('#fuelFlowMovementType')) $('#fuelFlowMovementType').value = state.modalKind;
    const meta = movementMeta(state.modalKind);
    const titles = {
      tank_receipt: ['INGRESO AL TANQUE', 'Registrar combustible recibido', 'Los litros se suman al tanque general.'],
      trailer_load: ['CARGA DEL TRÁILER', 'Cargar tráiler desde el tanque', 'Los litros se descuentan del tanque y se suman al tráiler.'],
      machine_delivery: ['ABASTECIMIENTO', 'Entregar combustible a una máquina', 'Los litros se descuentan del tráiler y se acumulan en la máquina elegida.']
    };
    const [kicker, title, help] = titles[state.modalKind];
    setText('#fuelFlowModalKicker', kicker);
    setText('#fuelFlowModalTitle', title);
    setText('#fuelFlowModalHelp', help);
    $('#fuelFlowMachineField')?.classList.toggle('hidden', state.modalKind !== 'machine_delivery');
    updateMovementPreview();
  }

  function openMovementModal(kind) {
    if (!isOperator()) return notify('Solo lectura', 'Los movimientos de combustible deben registrarlos los operadores.', 'error');
    const modal = $('#fuelFlowMovementModal');
    if (!modal) return;
    $('#fuelFlowMovementForm')?.reset();
    state.photoDataUrl = '';
    setPhotoPreview('');
    fillMachineSelect();
    setMovementKind(kind || 'tank_receipt');
    if ($('#fuelFlowMovementDate')) $('#fuelFlowMovementDate').value = dateKey();
    if ($('#fuelFlowMovementTime')) $('#fuelFlowMovementTime').value = timeKey();
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    window.setTimeout(() => $('#fuelFlowLiters')?.focus(), 100);
  }

  function closeMovementModal() {
    $('#fuelFlowMovementModal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.photoDataUrl = '';
    setPhotoPreview('');
  }

  function updateMovementPreview() {
    const root = $('#fuelFlowMovementPreview');
    if (!root) return;
    const amount = Math.max(0, num($('#fuelFlowLiters')?.value));
    const flow = state.flow;
    if (state.modalKind === 'tank_receipt') {
      root.innerHTML = `<div><span>Saldo tanque antes</span><strong>${escapeHtml(liters(flow.tankBalance))}</strong></div><div class="success"><span>Ingreso</span><strong>+${escapeHtml(liters(amount))}</strong></div><div class="success"><span>Saldo tanque después</span><strong>${escapeHtml(liters(flow.tankBalance + amount))}</strong></div>`;
    } else if (state.modalKind === 'trailer_load') {
      root.innerHTML = `<div><span>Saldo tanque</span><strong>${escapeHtml(liters(flow.tankBalance))}</strong></div><div class="warning"><span>Sale del tanque</span><strong>−${escapeHtml(liters(amount))}</strong></div><div class="success"><span>Saldo tráiler después</span><strong>${escapeHtml(liters(flow.trailerBalance + amount))}</strong></div>`;
    } else {
      const machine = machineById($('#fuelFlowMachineSelect')?.value);
      const current = state.flow.machineTotals[machine?.id]?.liters || 0;
      root.innerHTML = `<div><span>Saldo tráiler</span><strong>${escapeHtml(liters(flow.trailerBalance))}</strong></div><div class="warning"><span>Entrega</span><strong>−${escapeHtml(liters(amount))}</strong></div><div class="success"><span>Total ${escapeHtml(machine?.code || 'máquina')}</span><strong>${escapeHtml(liters(current + amount))}</strong></div>`;
    }
  }

  async function fileToCompressedDataUrl(file) {
    if (!file) throw new Error('Adjunta una fotografía del movimiento.');
    if (!String(file.type || '').startsWith('image/')) throw new Error('El comprobante debe ser una imagen.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo leer la fotografía.'));
        img.src = objectUrl;
      });
      const maxSide = 1100;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.72;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > MAX_PHOTO_DATA_LENGTH && quality > 0.32) {
        quality -= 0.08;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > MAX_PHOTO_DATA_LENGTH) throw new Error('La foto es demasiado pesada. Tómala con menor resolución.');
      return dataUrl;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function setPhotoPreview(dataUrl) {
    const preview = $('#fuelFlowPhotoPreview');
    if (!preview) return;
    if (!dataUrl) {
      preview.classList.remove('has-photo');
      preview.innerHTML = '<svg><use href="#i-camera"></use></svg><strong>Adjuntar comprobante o foto</strong><small>Toma una foto o selecciona una imagen</small>';
      return;
    }
    preview.classList.add('has-photo');
    preview.innerHTML = `<img src="${dataUrl}" alt="Comprobante seleccionado"><em>Foto lista</em>`;
  }

  async function handlePhotoInput(input) {
    try {
      state.photoDataUrl = await fileToCompressedDataUrl(input.files?.[0]);
      setPhotoPreview(state.photoDataUrl);
    } catch (error) {
      input.value = '';
      state.photoDataUrl = '';
      setPhotoPreview('');
      notify('No se pudo adjuntar', error.message || String(error), 'error');
    }
  }

  async function saveMovement(event) {
    event.preventDefault();
    if (!isOperator()) return notify('Solo lectura', 'Solo los operadores pueden registrar movimientos.', 'error');
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const user = window.LubaydCurrentUser;
    const profile = window.LubaydCurrentProfile || {};
    if (!user?.uid) return notify('Sesión requerida', 'Vuelve a iniciar sesión.', 'error');
    if (!state.photoDataUrl) return notify('Falta la fotografía', 'Todos los movimientos requieren una foto.', 'error');

    const kind = state.modalKind;
    const litersValue = roundLiters($('#fuelFlowLiters')?.value);
    const movementDate = $('#fuelFlowMovementDate')?.value || dateKey();
    const movementTime = $('#fuelFlowMovementTime')?.value || timeKey();
    const machine = kind === 'machine_delivery' ? machineById($('#fuelFlowMachineSelect')?.value) : null;
    const meta = movementMeta(kind);
    const record = {
      id: randomId(`fuel_flow_${kind}`),
      kind,
      liters: litersValue,
      dateKey: movementDate,
      timeKey: movementTime,
      dateTime: `${movementDate}T${movementTime}:00`,
      machineId: machine?.id || '',
      machineName: machine?.code || '',
      machineModel: machine?.model || '',
      originName: meta.origin,
      destinationName: kind === 'machine_delivery' ? machine?.code || 'Máquina' : meta.destination,
      proofDataUrl: state.photoDataUrl,
      photoId: '',
      notes: $('#fuelFlowNotes')?.value?.trim() || '',
      createdByUid: user.uid,
      createdByEmail: user.email || profile.email || '',
      createdByName: profile.nombre || user.displayName || user.email || 'Operador',
      createdAt: new Date().toISOString(),
      syncStatus: 'pending',
      syncError: '',
      serverConfirmed: false,
      offlineCaptured: isOffline()
    };

    let applied;
    try {
      applied = applyMovement(state.flow, record, true);
    } catch (error) {
      return notify('Movimiento no válido', error.message || String(error), 'error');
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await window.LubaydOffline.saveFuelFlowMovement(applied.movement);
      await window.LubaydOffline.saveFuelFlowState({ ...applied.flow, id: 'local', serverConfirmed: false }, 'local');
      await window.LubaydOffline.enqueueFuelFlowOperation({ recordId: applied.movement.id, userId: user.uid, record: applied.movement });
      closeMovementModal();
      await refreshLocal();
      notify('Movimiento guardado', isOffline() ? 'Quedó almacenado en este teléfono y se enviará cuando vuelva internet.' : 'Se está enviando al servidor.');
      syncFuelFlowQueue({ silent: true }).catch(() => {});
    } catch (error) {
      notify('No se pudo guardar', error.message || String(error), 'error');
    } finally {
      submit.disabled = false;
    }
  }

  async function fetchAndMergeCloudState() {
    const user = onlineUser();
    if (isOffline() || !user?.uid || !window.LubaydOffline?.fetchFuelFlowCloudState) return null;
    const idToken = await user.getIdToken(false);
    const data = await window.LubaydOffline.fetchFuelFlowCloudState(idToken);
    await window.LubaydOffline.mergeFuelFlowCloudData(data.state || emptyFlowState(), data.movements || []);
    await refreshLocal();
    return data;
  }

  async function syncFuelFlowQueue(options = {}) {
    if (state.syncPromise) return state.syncPromise;
    state.syncPromise = (async () => {
      if (!window.LubaydOffline?.listFuelFlowQueue) return { synced: 0, errors: 0 };
      const identity = await window.LubaydOffline.getDeviceIdentity?.().catch(() => null);
      const firebaseUser = onlineUser();
      const hasOnlineSession = Boolean(!isOffline() && firebaseUser?.uid);
      const deviceReady = Boolean(identity?.enrolled && identity.deviceId && identity.deviceToken);
      if (!hasOnlineSession && !deviceReady) return { synced: 0, errors: 0 };

      const priority = { tank_receipt: 0, trailer_load: 1, machine_delivery: 2 };
      const items = (await window.LubaydOffline.listFuelFlowQueue({ statuses: ['pending', 'error', 'syncing'] })).sort((a, b) => {
        const dateCompare = String(a.record?.dateTime || a.createdAt || '').localeCompare(String(b.record?.dateTime || b.createdAt || ''));
        if (dateCompare) return dateCompare;
        return (priority[a.record?.kind] ?? 9) - (priority[b.record?.kind] ?? 9);
      });
      if (!items.length) {
        if (hasOnlineSession) await fetchAndMergeCloudState().catch(() => {});
        return { synced: 0, errors: 0 };
      }

      const idToken = hasOnlineSession ? await firebaseUser.getIdToken(false) : '';
      let synced = 0;
      let errors = 0;
      for (const item of items) {
        try {
          await window.LubaydOffline.updateFuelFlowQueue(item.recordId, { status: 'syncing', lastError: '' });
          const result = await window.LubaydOffline.syncFuelFlowQueueItem(item, identity, { idToken });
          if (!result?.movement || result.movement.id !== item.recordId || !result?.state) throw new Error('El servidor no confirmó el movimiento.');
          await window.LubaydOffline.mergeFuelFlowCloudData(result.state, [result.movement]);
          await window.LubaydOffline.markFuelFlowSynced(item.recordId);
          synced += 1;
        } catch (error) {
          errors += 1;
          await window.LubaydOffline.markFuelFlowError(item.recordId, error);
          const local = await window.LubaydOffline.getFuelFlowMovement(item.recordId).catch(() => null);
          if (local) await window.LubaydOffline.saveFuelFlowMovement({ ...local, syncStatus: 'error', syncError: error.message || String(error), serverConfirmed: false });
        }
      }

      if (hasOnlineSession) await fetchAndMergeCloudState().catch(error => console.warn('Confirmación de combustible:', error));
      await refreshLocal();
      if (!options.silent && (synced || errors)) notify(errors ? 'Sincronización incompleta' : 'Combustible sincronizado', errors ? `${synced} movimiento(s) sincronizados y ${errors} pendientes.` : `${synced} movimiento(s) confirmados y visibles para administración.`, errors ? 'error' : 'success');
      return { synced, errors };
    })().finally(() => { state.syncPromise = null; });
    return state.syncPromise;
  }

  function startCloudSubscription() {
    state.cloudUnsubscribe?.();
    state.cloudUnsubscribe = null;
    if (isOffline() || !window.LubaydFuelFlowCloud?.available || !onlineUser()) return;
    try {
      state.cloudUnsubscribe = window.LubaydFuelFlowCloud.subscribe(async data => {
        await window.LubaydOffline.mergeFuelFlowCloudData(data.state || emptyFlowState(), data.movements || []);
        await refreshLocal();
      }, error => console.warn('Combustible cloud:', error));
    } catch (error) {
      console.warn('No se pudo iniciar combustible cloud:', error);
    }
  }

  function startMachineSubscription() {
    state.machineUnsubscribe?.();
    state.machineUnsubscribe = null;
    if (isOffline() || !window.LubaydOps?.available || !onlineUser()) {
      fillMachineSelect();
      return;
    }
    try {
      state.machineUnsubscribe = window.LubaydOps.subscribeCollection('maquinas', items => cacheMachines(items), error => console.warn('Catálogo de máquinas:', error));
    } catch (error) {
      console.warn('No se pudo cargar el catálogo de máquinas:', error);
      fillMachineSelect();
    }
  }

  async function openPhoto(movementId) {
    const movement = state.movements.find(item => item.id === movementId);
    let dataUrl = movement?.proofDataUrl || '';
    try {
      if (!dataUrl && movement?.photoId && window.LubaydFuelFlowCloud?.getPhoto && onlineUser()) dataUrl = await window.LubaydFuelFlowCloud.getPhoto(movement.photoId);
    } catch (error) {
      return notify('No se pudo abrir la foto', error.message || String(error), 'error');
    }
    if (!dataUrl) return notify('Sin fotografía', 'El comprobante no está disponible en este dispositivo.', 'error');
    $('#fuelPhotoTitle').textContent = `${movementMeta(movement.kind).label} · ${movement.dateKey || ''} ${movement.timeKey || ''}`;
    $('#fuelPhotoImage').src = dataUrl;
    $('#fuelPhotoModal')?.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closePhoto() {
    $('#fuelPhotoModal')?.classList.add('hidden');
    if ($('#fuelPhotoImage')) $('#fuelPhotoImage').src = '';
    document.body.classList.remove('modal-open');
  }

  function bindEvents() {
    $('#fuelFlowDate')?.addEventListener('change', event => {
      state.selectedDate = event.target.value || dateKey();
      render();
    });
    $('#fuelFlowTypeFilter')?.addEventListener('change', event => {
      state.typeFilter = event.target.value || 'all';
      renderMovements();
    });
    $('#fuelFlowSyncBtn')?.addEventListener('click', () => syncFuelFlowQueue({ silent: false }));
    $('#fuelFlowNewBtn')?.addEventListener('click', () => openMovementModal('tank_receipt'));
    $('#fuelFlowContent')?.addEventListener('click', event => {
      const action = event.target.closest('[data-fuel-flow-action]');
      if (action) openMovementModal(action.dataset.fuelFlowAction);
      const photo = event.target.closest('[data-fuel-flow-photo-id]');
      if (photo) openPhoto(photo.dataset.fuelFlowPhotoId);
    });
    $('#fuelFlowMovementType')?.addEventListener('change', event => setMovementKind(event.target.value));
    $('#fuelFlowLiters')?.addEventListener('input', updateMovementPreview);
    $('#fuelFlowMachineSelect')?.addEventListener('change', updateMovementPreview);
    $('#fuelFlowPhotoInput')?.addEventListener('change', event => handlePhotoInput(event.target));
    $('#fuelFlowMovementForm')?.addEventListener('submit', saveMovement);
    $$('[data-fuel-flow-close]').forEach(button => button.addEventListener('click', closeMovementModal));
    $('#fuelPhotoClose')?.addEventListener('click', closePhoto);
    $('#fuelPhotoModal .fuel-photo-backdrop')?.addEventListener('click', closePhoto);
  }

  async function initialize() {
    if ($('#fuelFlowDate') && !$('#fuelFlowDate').value) $('#fuelFlowDate').value = state.selectedDate;
    fillMachineSelect();
    await refreshLocal().catch(error => console.warn('Combustible local:', error));
    startMachineSubscription();
    startCloudSubscription();
    if (!isOffline()) {
      fetchAndMergeCloudState().catch(error => console.warn('Combustible servidor:', error));
      syncFuelFlowQueue({ silent: true }).catch(() => {});
    }
  }

  bindEvents();
  window.LubaydFuelUI = { show: initialize, refresh: refreshLocal, sync: syncFuelFlowQueue };
  window.LubaydSyncFuel = syncFuelFlowQueue;
  window.LubaydFuelFlowLogic = { applyMovement, emptyFlowState, normalizeFlowState };

  window.addEventListener('lubayd-profile-ready', initialize);
  window.addEventListener('lubayd-offline-profile-ready', initialize);
  window.addEventListener('lubayd-offline-signed-out', () => {
    state.cloudUnsubscribe?.();
    state.machineUnsubscribe?.();
    state.cloudUnsubscribe = null;
    state.machineUnsubscribe = null;
  });
  window.addEventListener('lubayd-offline-state-changed', () => refreshLocal().catch(() => {}));
  window.addEventListener('online', () => syncFuelFlowQueue({ silent: true }).catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncFuelFlowQueue({ silent: true }).catch(() => {});
  });
  state.refreshTimer = window.setInterval(() => {
    if (window.LubaydCurrentUser) syncFuelFlowQueue({ silent: true }).catch(() => {});
  }, 20000);

  if (window.LubaydCurrentUser) initialize();
})();
