/* Lubayd SA V22.1.1 - descansos con captura estable */
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
  function durationText(start, end) {
    if (!start) return '0 h 00 min';
    const milliseconds = Math.max(0, new Date(end || Date.now()).getTime() - new Date(start).getTime());
    const minutes = Math.floor(milliseconds / 60000);
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  }
  function pointCard(point, label) {
    if (!point?.at) return '';
    const photo = point.photo ? `<img class="record-thumb" src="${point.photo}" alt="Foto de ${escapeHtml(label)}">` : '';
    return `<div class="event-row"><div><strong>${escapeHtml(label)} · ${formatTime(point.at)}</strong><span>${escapeHtml(formatGps(point.gps))}</span></div>${photo}</div>`;
  }
  function renderCurrent() {
    current = ownToday();
    const item = current?.payload || {};
    if (!item.start?.at) {
      $('#breakStatus').textContent = 'Sin registrar';
      $('#breakTimes').textContent = 'Todavia no iniciaste el descanso.';
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
    if (!records.length) {
      list.className = 'record-list empty';
      list.textContent = 'Sin registros.';
      renderCurrent();
      return;
    }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const stateLabel = item.end?.at ? 'Completado' : item.start?.at ? 'En descanso' : 'Sin registrar';
      const badgeClass = record.status === 'synced' ? '' : record.status;
      return `<article class="record-card evidence-record"><header><div><h4>${escapeHtml(record.userName || item.userName || 'Usuario')}</h4><p>${formatDate(record.dateKey)} · ${stateLabel} · ${durationText(item.start?.at, item.end?.at)}</p></div><span class="status-badge ${badgeClass}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header>${pointCard(item.start, 'Inicio')}${pointCard(item.end, 'Fin')}${record.lastError ? `<p class="record-error">${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
    renderCurrent();
    emit('lubayd-module-updated', { module: 'breaks', records, current });
  }
  async function refresh() {
    if (!window.Lubayd.state.user) return;
    records = await window.LubaydData.list('break', { onlyMine: !manager(), limit: 150 });
    renderList();
  }
  async function register(action) {
    const button = action === 'start' ? $('#breakStartButton') : $('#breakEndButton');
    try {
      const evidence = await window.LubaydEvidence.capture({
        title: action === 'start' ? 'Iniciar descanso' : 'Finalizar descanso',
        subtitle: 'La marca requiere ubicacion GPS y fotografia.',
        draftKey: `capture_break_${action}_${window.Lubayd.state.user.uid}_${localDateKey()}`
      });
      setBusy(button, true, action === 'start' ? 'Guardando inicio' : 'Guardando fin');
      const dateKey = localDateKey();
      const id = `break_${window.Lubayd.state.user.uid}_${dateKey}`;
      const point = {
        at: new Date().toISOString(),
        gps: evidence.gps,
        photo: evidence.photo,
        capturedAtClient: evidence.capturedAtClient
      };
      if (action === 'end') {
        const record = await window.LubaydOffline.get('records', id).catch(() => null);
        if (!record?.payload?.start?.at) throw new Error('Primero debes iniciar el descanso.');
        if (new Date(point.at) <= new Date(record.payload.start.at)) throw new Error('El fin debe ser posterior al inicio.');
      }
      await window.LubaydData.save('break', { dateKey, [action]: point }, { id });
      toast(action === 'start' ? 'Descanso iniciado' : 'Descanso finalizado', 'El registro quedo guardado en el telefono y se sincronizara cuando haya internet.');
      await refresh();
    } catch (error) {
      if (error?.code !== 'cancelled') toast('No se pudo registrar', error.message || String(error));
    } finally {
      setBusy(button, false);
    }
  }
  function init() {
    $('#breakStartButton').addEventListener('click', () => register('start'));
    $('#breakEndButton').addEventListener('click', () => register('end'));
    window.addEventListener('lubayd-session-ready', refresh);
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'break') refresh(); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'break') refresh(); });
  }
  window.LubaydBreaks = { refresh, getRecords: () => records.slice(), getCurrent: () => current, durationText };
  init();
})();
