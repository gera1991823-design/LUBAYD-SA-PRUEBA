/* Lubayd SA V21.3.0 - flujo de combustible offline */
(function () {
  'use strict';
  const { $, escapeHtml, formatDateTime, formatNumber, fileToDataUrl, getGps, localDateKey, setBusy, toast, emit } = window.Lubayd;
  let records = [];
  let currentState = { tankLiters: 0, trailerLiters: 0, machines: {} };
  const labels = {
    tank_load: 'Ingreso al tanque',
    trailer_load: 'Carga al tráiler',
    machine_delivery: 'Entrega a máquina',
    tank_adjust: 'Ajuste de tanque',
    trailer_adjust: 'Ajuste de tráiler'
  };
  function renderState() {
    $('#fuelTank').textContent = `${formatNumber(currentState.tankLiters, 1)} L`;
    $('#fuelTrailer').textContent = `${formatNumber(currentState.trailerLiters, 1)} L`;
    const machinesTotal = Object.values(currentState.machines || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    $('#fuelMachinesTotal').textContent = `${formatNumber(machinesTotal, 1)} L`;
    emit('lubayd-module-updated', { module: 'fuel', state: currentState, records });
  }
  function renderList() {
    const list = $('#fuelList');
    if (!records.length) { list.className = 'record-list empty'; list.textContent = 'Sin movimientos.'; return; }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const badgeClass = record.status === 'synced' ? '' : record.status;
      const detail = item.action === 'machine_delivery' ? ` · ${escapeHtml(item.machine || '')}` : '';
      return `<article class="record-card"><header><div><h4>${escapeHtml(labels[item.action] || item.action || 'Movimiento')}${detail}</h4><p>${formatDateTime(item.createdAtClient || record.createdAtClient)}</p></div><span class="status-badge ${badgeClass}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header><div class="record-meta"><span>${formatNumber(item.liters,1)} L</span><span>${escapeHtml(record.userName || item.userName || '')}</span>${item.notes ? `<span>${escapeHtml(item.notes)}</span>` : ''}</div>${record.lastError ? `<p>${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
  }
  async function refresh(refreshServer = true) {
    if (!window.Lubayd.state.user) return;
    currentState = await window.LubaydData.fuelState(refreshServer);
    records = await window.LubaydData.list('fuel', { refresh: refreshServer, limit: 150 });
    renderState();
    renderList();
  }
  function updateAction() {
    const showMachine = $('#fuelAction').value === 'machine_delivery';
    $('#fuelMachineLabel').classList.toggle('hidden', !showMachine);
    $('#fuelMachine').required = showMachine;
  }
  async function submit(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, 'Guardando');
    $('#fuelMessage').textContent = '';
    try {
      const file = $('#fuelPhoto').files?.[0];
      const [photo, gps] = await Promise.all([fileToDataUrl(file), getGps()]);
      const action = $('#fuelAction').value;
      const movement = {
        action,
        machine: action === 'machine_delivery' ? $('#fuelMachine').value.trim() : '',
        liters: Number($('#fuelLiters').value),
        notes: $('#fuelNotes').value.trim(),
        photo,
        gps,
        dateKey: localDateKey(),
        createdAtClient: new Date().toISOString()
      };
      await window.LubaydData.saveFuel(movement);
      event.currentTarget.reset();
      updateAction();
      $('#fuelMessage').textContent = navigator.onLine ? 'Movimiento guardado. Se está sincronizando.' : 'Movimiento guardado en el teléfono.';
      $('#fuelMessage').className = 'form-message success';
      toast('Combustible registrado', navigator.onLine ? 'Se validará contra el saldo del servidor.' : 'Quedó pendiente hasta recuperar internet.');
      await refresh(false);
    } catch (error) {
      $('#fuelMessage').textContent = error.message || String(error);
      $('#fuelMessage').className = 'form-message';
    } finally { setBusy(button, false); }
  }
  function init() {
    $('#fuelAction').addEventListener('change', updateAction);
    $('#fuelForm').addEventListener('submit', submit);
    $('#refreshFuelButton').addEventListener('click', () => refresh(true));
    window.addEventListener('lubayd-session-ready', () => refresh(true));
    window.addEventListener('lubayd-fuel-state-changed', event => { currentState = event.detail.state; renderState(); });
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'fuel') refresh(false); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'fuel') refresh(true); });
    updateAction();
  }
  window.LubaydFuel = { refresh, getState: () => Object.assign({}, currentState), getRecords: () => records.slice() };
  init();
})();
