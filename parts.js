/* Lubayd SA V21.3.0 - partes diarios */
(function () {
  'use strict';
  const { $, escapeHtml, formatDate, formatNumber, getGps, setBusy, toast, localDateKey, emit } = window.Lubayd;
  let records = [];
  function canViewAll() { return ['admin', 'supervisor'].includes(window.Lubayd.state.profile?.role); }
  function statusBadge(status) {
    const label = status === 'synced' ? 'Sincronizado' : status === 'error' ? 'Error' : 'Pendiente';
    return `<span class="status-badge ${status === 'synced' ? '' : status}">${label}</span>`;
  }
  function render() {
    const list = $('#partsList');
    if (!records.length) { list.className = 'record-list empty'; list.textContent = 'Sin registros.'; return; }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 80).map(record => {
      const item = record.payload || {};
      const hours = Math.max(0, Number(item.hourEnd || 0) - Number(item.hourStart || 0));
      const trees = Math.max(0, Number(item.treesEnd || 0) - Number(item.treesStart || 0));
      return `<article class="record-card"><header><div><h4>${escapeHtml(item.machine || 'Máquina')}</h4><p>${escapeHtml(item.forest || 'Monte')} · ${formatDate(record.dateKey)}</p></div>${statusBadge(record.status)}</header><div class="record-meta"><span>${formatNumber(hours,1)} h</span><span>${formatNumber(trees)} árboles</span><span>${formatNumber(item.fuel,1)} L</span><span>${escapeHtml(record.userName || item.createdByName || '')}</span></div>${record.lastError ? `<p>${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
    emit('lubayd-module-updated', { module: 'parts', records });
  }
  async function refresh() {
    if (!window.Lubayd.state.user) return;
    records = await window.LubaydData.list('part', { onlyMine: !canViewAll(), limit: 120 });
    render();
  }
  async function submit(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, 'Guardando');
    $('#partMessage').textContent = '';
    try {
      $('#partGpsText').textContent = 'Obteniendo ubicación…';
      const gps = await getGps();
      const hourStart = Number($('#partHourStart').value || 0);
      const hourEnd = Number($('#partHourEnd').value || 0);
      if (hourEnd < hourStart) throw new Error('El horómetro final no puede ser menor que el inicial.');
      const treesStart = Number($('#partTreesStart').value || 0);
      const treesEnd = Number($('#partTreesEnd').value || 0);
      if (treesEnd < treesStart) throw new Error('Los árboles finales no pueden ser menores que los iniciales.');
      await window.LubaydData.save('part', {
        dateKey: $('#partDate').value || localDateKey(),
        shift: $('#partShift').value,
        machine: $('#partMachine').value.trim(),
        forest: $('#partForest').value.trim(),
        hourStart, hourEnd,
        hours: hourEnd - hourStart,
        treesStart, treesEnd,
        trees: treesEnd - treesStart,
        fuel: Number($('#partFuel').value || 0),
        notes: $('#partNotes').value.trim(),
        gps
      });
      event.currentTarget.reset();
      $('#partDate').value = localDateKey();
      $('#partGpsText').textContent = 'La ubicación se solicitará al guardar.';
      $('#partMessage').textContent = navigator.onLine ? 'Parte guardado. Se está sincronizando.' : 'Parte guardado en el teléfono.';
      $('#partMessage').className = 'form-message success';
      toast('Parte guardado', navigator.onLine ? 'La sincronización se realizará automáticamente.' : 'Quedó pendiente hasta recuperar internet.');
      await refresh();
    } catch (error) {
      $('#partMessage').textContent = error.message || String(error);
      $('#partMessage').className = 'form-message';
      $('#partGpsText').textContent = 'La ubicación se solicitará al guardar.';
    } finally { setBusy(button, false); }
  }
  function init() {
    $('#partDate').value = localDateKey();
    $('#partForm').addEventListener('submit', submit);
    $('#refreshPartsButton').addEventListener('click', refresh);
    window.addEventListener('lubayd-session-ready', refresh);
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'part') refresh(); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'part') refresh(); });
  }
  window.LubaydParts = { refresh, getRecords: () => records.slice() };
  init();
})();
