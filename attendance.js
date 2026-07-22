/* Lubayd SA V21.3.0 - asistencia offline */
(function () {
  'use strict';
  const { $, escapeHtml, formatDate, formatTime, formatDateTime, getGps, fileToDataUrl, toast, localDateKey, setBusy, emit } = window.Lubayd;
  let records = [];
  let current = null;
  let pendingAction = '';
  function manager() { return ['admin', 'supervisor'].includes(window.Lubayd.state.profile?.role); }
  function ownToday() {
    const userId = window.Lubayd.state.user?.uid;
    return records.find(record => record.userId === userId && record.dateKey === localDateKey()) || null;
  }
  function renderCurrent() {
    current = ownToday();
    const item = current?.payload || {};
    const entry = item.entry;
    const exit = item.exit;
    if (!entry?.at) {
      $('#attendanceStatus').textContent = 'Sin registrar';
      $('#attendanceTimes').textContent = 'Todavía no registraste la llegada.';
    } else if (!exit?.at) {
      $('#attendanceStatus').textContent = 'Trabajando';
      $('#attendanceTimes').textContent = `Llegada ${formatTime(entry.at)} · salida pendiente`;
    } else {
      $('#attendanceStatus').textContent = 'Jornada finalizada';
      $('#attendanceTimes').textContent = `Llegada ${formatTime(entry.at)} · salida ${formatTime(exit.at)}`;
    }
    $('#attendanceEntryButton').disabled = Boolean(entry?.at);
    $('#attendanceExitButton').disabled = !entry?.at || Boolean(exit?.at);
  }
  function renderList() {
    const list = $('#attendanceList');
    if (!records.length) { list.className = 'record-list empty'; list.textContent = 'Sin registros.'; return; }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const status = item.exit?.at ? 'Finalizado' : item.entry?.at ? 'Trabajando' : 'Sin registrar';
      const badgeClass = record.status === 'synced' ? '' : record.status;
      return `<article class="record-card"><header><div><h4>${escapeHtml(record.userName || item.userName || 'Usuario')}</h4><p>${formatDate(record.dateKey)} · ${status}</p></div><span class="status-badge ${badgeClass}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header><div class="record-meta"><span>Entrada ${formatTime(item.entry?.at)}</span><span>Salida ${formatTime(item.exit?.at)}</span>${item.entry?.gps ? `<span>GPS ±${Math.round(item.entry.gps.accuracy || 0)} m</span>` : ''}</div>${record.lastError ? `<p>${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
    renderCurrent();
    emit('lubayd-module-updated', { module: 'attendance', records, current });
  }
  async function refresh() {
    if (!window.Lubayd.state.user) return;
    records = await window.LubaydData.list('attendance', { onlyMine: !manager(), limit: 150 });
    renderList();
  }
  function choosePhoto(action) {
    pendingAction = action;
    const input = $('#attendancePhotoInput');
    input.value = '';
    input.click();
  }
  async function processPhoto(file) {
    if (!pendingAction || !file) return;
    const action = pendingAction;
    pendingAction = '';
    const button = action === 'entry' ? $('#attendanceEntryButton') : $('#attendanceExitButton');
    setBusy(button, true, action === 'entry' ? 'Registrando llegada' : 'Registrando salida');
    try {
      const [photo, gps] = await Promise.all([fileToDataUrl(file), getGps()]);
      const dateKey = localDateKey();
      const id = `attendance_${window.Lubayd.state.user.uid}_${dateKey}`;
      const point = { at: new Date().toISOString(), gps, photo, capturedAtClient: new Date().toISOString() };
      if (action === 'exit') {
        const record = await window.LubaydOffline.get('records', id).catch(() => null);
        if (!record?.payload?.entry?.at) throw new Error('Primero debes registrar la llegada.');
        if (new Date(point.at) <= new Date(record.payload.entry.at)) throw new Error('La salida debe ser posterior a la llegada.');
      }
      await window.LubaydData.save('attendance', { dateKey, [action]: point }, { id });
      toast(action === 'entry' ? 'Llegada registrada' : 'Salida registrada', navigator.onLine ? 'Se sincronizará automáticamente.' : 'Quedó guardada en el teléfono.');
      await refresh();
    } catch (error) {
      toast('No se pudo registrar', error.message || String(error));
    } finally { setBusy(button, false); }
  }
  function init() {
    $('#attendanceEntryButton').addEventListener('click', () => choosePhoto('entry'));
    $('#attendanceExitButton').addEventListener('click', () => choosePhoto('exit'));
    $('#attendancePhotoInput').addEventListener('change', event => processPhoto(event.target.files?.[0]));
    window.addEventListener('lubayd-session-ready', refresh);
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'attendance') refresh(); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'attendance') refresh(); });
  }
  window.LubaydAttendance = { refresh, getRecords: () => records.slice(), getCurrent: () => current };
  init();
})();
