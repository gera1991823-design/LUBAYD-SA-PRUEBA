/* Lubayd SA V22.1.1 - asistencia con captura estable */
(function () {
  'use strict';
  const { $, escapeHtml, formatDate, formatTime, formatGps, toast, localDateKey, setBusy, emit } = window.Lubayd;
  let records = [];
  let current = null;

  function manager() { return ['admin', 'supervisor'].includes(window.Lubayd.state.profile?.role); }
  function ownToday() {
    const userId = window.Lubayd.state.user?.uid;
    return records.find(record => record.userId === userId && record.dateKey === localDateKey()) || null;
  }
  function pointCard(point, label) {
    if (!point?.at) return '';
    const photo = point.photo ? `<img class="record-thumb" src="${point.photo}" alt="Foto de ${escapeHtml(label)}">` : '';
    return `<div class="event-row"><div><strong>${escapeHtml(label)} · ${formatTime(point.at)}</strong><span>${escapeHtml(formatGps(point.gps))}</span></div>${photo}</div>`;
  }
  function renderCurrent() {
    current = ownToday();
    const item = current?.payload || {};
    const entry = item.entry;
    const exit = item.exit;
    if (!entry?.at) {
      $('#attendanceStatus').textContent = 'Sin registrar';
      $('#attendanceTimes').textContent = 'Todavia no registraste la llegada.';
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
    if (!records.length) {
      list.className = 'record-list empty';
      list.textContent = 'Sin registros.';
      renderCurrent();
      return;
    }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const status = item.exit?.at ? 'Finalizado' : item.entry?.at ? 'Trabajando' : 'Sin registrar';
      const badgeClass = record.status === 'synced' ? '' : record.status;
      return `<article class="record-card evidence-record"><header><div><h4>${escapeHtml(record.userName || item.userName || 'Usuario')}</h4><p>${formatDate(record.dateKey)} · ${status}</p></div><span class="status-badge ${badgeClass}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header>${pointCard(item.entry, 'Ingreso')}${pointCard(item.exit, 'Salida')}${record.lastError ? `<p class="record-error">${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
    renderCurrent();
    emit('lubayd-module-updated', { module: 'attendance', records, current });
  }
  async function refresh() {
    if (!window.Lubayd.state.user) return;
    records = await window.LubaydData.list('attendance', { onlyMine: !manager(), limit: 150 });
    renderList();
  }
  async function register(action) {
    const button = action === 'entry' ? $('#attendanceEntryButton') : $('#attendanceExitButton');
    try {
      const evidence = await window.LubaydEvidence.capture({
        title: action === 'entry' ? 'Registrar llegada' : 'Registrar salida',
        subtitle: 'Primero se obtiene la ubicacion y luego debes tomar una fotografia.',
        draftKey: `capture_attendance_${action}_${window.Lubayd.state.user.uid}_${localDateKey()}`
      });
      setBusy(button, true, action === 'entry' ? 'Guardando llegada' : 'Guardando salida');
      const dateKey = localDateKey();
      const id = `attendance_${window.Lubayd.state.user.uid}_${dateKey}`;
      const point = {
        at: new Date().toISOString(),
        gps: evidence.gps,
        photo: evidence.photo,
        capturedAtClient: evidence.capturedAtClient
      };
      if (action === 'exit') {
        const record = await window.LubaydOffline.get('records', id).catch(() => null);
        if (!record?.payload?.entry?.at) throw new Error('Primero debes registrar la llegada.');
        if (new Date(point.at) <= new Date(record.payload.entry.at)) throw new Error('La salida debe ser posterior a la llegada.');
      }
      await window.LubaydData.save('attendance', { dateKey, [action]: point }, { id });
      toast(action === 'entry' ? 'Llegada registrada' : 'Salida registrada', 'El registro quedo guardado en el telefono y se sincronizara cuando haya internet.');
      await refresh();
    } catch (error) {
      if (error?.code !== 'cancelled') toast('No se pudo registrar', error.message || String(error));
    } finally {
      setBusy(button, false);
    }
  }
  function init() {
    $('#attendanceEntryButton').addEventListener('click', () => register('entry'));
    $('#attendanceExitButton').addEventListener('click', () => register('exit'));
    window.addEventListener('lubayd-session-ready', refresh);
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'attendance') refresh(); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'attendance') refresh(); });
  }
  window.LubaydAttendance = { refresh, getRecords: () => records.slice(), getCurrent: () => current };
  init();
})();
