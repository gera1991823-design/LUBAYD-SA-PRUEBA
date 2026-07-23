/* Lubayd SA V22.0.0 - descansos offline */
(function () {
  'use strict';
  const { $, escapeHtml, formatDate, formatTime, getGps, fileToDataUrl, toast, localDateKey, setBusy, emit } = window.Lubayd;
  let records = [];
  let current = null;
  let pendingAction = '';
  function manager() { return ['admin', 'supervisor'].includes(window.Lubayd.state.profile?.role); }
  function ownToday() {
    const userId = window.Lubayd.state.user?.uid;
    return records.find(record => record.userId === userId && record.dateKey === localDateKey()) || null;
  }
  function durationText(start, end) {
    if (!start) return '0 h 00 min';
    const milliseconds = Math.max(0, new Date(end || Date.now()).getTime() - new Date(start).getTime());
    const minutes = Math.floor(milliseconds / 60000);
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  }
  function renderCurrent() {
    current = ownToday();
    const item = current?.payload || {};
    if (!item.start?.at) {
      $('#breakStatus').textContent = 'Sin registrar';
      $('#breakTimes').textContent = 'Todavía no iniciaste el descanso.';
    } else if (!item.end?.at) {
      $('#breakStatus').textContent = 'En descanso';
      $('#breakTimes').textContent = `Inicio ${formatTime(item.start.at)} · ${durationText(item.start.at)}`;
    } else {
      $('#breakStatus').textContent = 'Completado';
      $('#breakTimes').textContent = `Inicio ${formatTime(item.start.at)} · fin ${formatTime(item.end.at)} · ${durationText(item.start.at, item.end.at)}`;
    }
    $('#breakStartButton').disabled = Boolean(item.start?.at);
    $('#breakEndButton').disabled = !item.start?.at || Boolean(item.end?.at);
  }
  function renderList() {
    const list = $('#breakList');
    if (!records.length) { list.className = 'record-list empty'; list.textContent = 'Sin registros.'; return; }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const stateLabel = item.end?.at ? 'Completado' : item.start?.at ? 'En descanso' : 'Sin registrar';
      const badgeClass = record.status === 'synced' ? '' : record.status;
      return `<article class="record-card"><header><div><h4>${escapeHtml(record.userName || item.userName || 'Usuario')}</h4><p>${formatDate(record.dateKey)} · ${stateLabel}</p></div><span class="status-badge ${badgeClass}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header><div class="record-meta"><span>Inicio ${formatTime(item.start?.at)}</span><span>Fin ${formatTime(item.end?.at)}</span><span>${durationText(item.start?.at, item.end?.at)}</span></div>${record.lastError ? `<p>${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
    renderCurrent();
    emit('lubayd-module-updated', { module: 'breaks', records, current });
  }
  async function refresh() {
    if (!window.Lubayd.state.user) return;
    records = await window.LubaydData.list('break', { onlyMine: !manager(), limit: 150 });
    renderList();
  }
  function choosePhoto(action) {
    pendingAction = action;
    const input = $('#breakPhotoInput');
    input.value = '';
    input.click();
  }
  async function processPhoto(file) {
    if (!pendingAction || !file) return;
    const action = pendingAction;
    pendingAction = '';
    const button = action === 'start' ? $('#breakStartButton') : $('#breakEndButton');
    setBusy(button, true, action === 'start' ? 'Iniciando descanso' : 'Finalizando descanso');
    try {
      const [photo, gps] = await Promise.all([fileToDataUrl(file), getGps()]);
      const dateKey = localDateKey();
      const id = `break_${window.Lubayd.state.user.uid}_${dateKey}`;
      const point = { at: new Date().toISOString(), gps, photo, capturedAtClient: new Date().toISOString() };
      if (action === 'end') {
        const record = await window.LubaydOffline.get('records', id).catch(() => null);
        if (!record?.payload?.start?.at) throw new Error('Primero debes iniciar el descanso.');
        if (new Date(point.at) <= new Date(record.payload.start.at)) throw new Error('El fin debe ser posterior al inicio.');
      }
      await window.LubaydData.save('break', { dateKey, [action]: point }, { id });
      toast(action === 'start' ? 'Descanso iniciado' : 'Descanso finalizado', navigator.onLine ? 'Se sincronizará automáticamente.' : 'Quedó guardado en el teléfono.');
      await refresh();
    } catch (error) {
      toast('No se pudo registrar', error.message || String(error));
    } finally { setBusy(button, false); }
  }
  function init() {
    $('#breakStartButton').addEventListener('click', () => choosePhoto('start'));
    $('#breakEndButton').addEventListener('click', () => choosePhoto('end'));
    $('#breakPhotoInput').addEventListener('change', event => processPhoto(event.target.files?.[0]));
    window.addEventListener('lubayd-session-ready', refresh);
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'break') refresh(); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'break') refresh(); });
  }
  window.LubaydBreaks = { refresh, getRecords: () => records.slice(), getCurrent: () => current, durationText };
  init();
})();
