/* Lubayd SA V21.3.0 - aplicacion principal */
(function () {
  'use strict';
  const { $, $$, state, config, initials, formatDateTime, escapeHtml, toast, emit, localDateKey } = window.Lubayd;
  const viewTitles = {
    dashboard: ['CENTRO OPERATIVO', 'Inicio'],
    partes: ['OPERACIÓN FORESTAL', 'Partes diarios'],
    asistencia: ['CONTROL HORARIO', 'Asistencia'],
    descansos: ['JORNADA', 'Descansos'],
    combustible: ['CONTROL DE SALDOS', 'Combustible'],
    chat: ['COMUNICACIÓN', 'Mensajes'],
    administracion: ['ADMINISTRACIÓN', 'Usuarios y catálogos'],
    configuracion: ['PREFERENCIAS', 'Configuración']
  };
  let updateReloading = false;

  function roleLabel(role) { return ({ admin: 'Administrador', supervisor: 'Supervisor', operador: 'Operador' })[role] || 'Operador'; }
  function applyRoleVisibility() {
    const admin = state.profile?.role === 'admin' && !state.offlineSession;
    const operator = state.profile?.role === 'operador';
    $$('.admin-only').forEach(element => element.classList.toggle('hidden', !admin));
    $$('.operator-only').forEach(element => element.classList.toggle('hidden', !operator));
    $$('.online-only').forEach(element => element.classList.toggle('hidden', state.offlineSession || !navigator.onLine));
  }
  function showView(name) {
    if (!state.user) return;
    if (name === 'administracion' && state.profile?.role !== 'admin') name = 'dashboard';
    if (name === 'chat' && (state.offlineSession || !navigator.onLine)) {
      toast('Mensajes no disponibles', 'El chat requiere conexión e inicio de sesión online.');
      name = 'dashboard';
    }
    const target = $(`#view-${name}`);
    if (!target) name = 'dashboard';
    $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    const title = viewTitles[name] || viewTitles.dashboard;
    $('#pageEyebrow').textContent = title[0];
    $('#pageTitle').textContent = title[1];
    state.currentView = name;
    sessionStorage.setItem('lubayd_last_view_v21_3', name);
    history.replaceState(null, '', `${location.pathname}${name === 'dashboard' ? '' : `?view=${encodeURIComponent(name)}`}`);
    $('#sidebar').classList.remove('open');
    if (name === 'chat') window.LubaydChat?.loadContacts?.();
    if (name === 'administracion') { window.LubaydAdmin?.loadUsers?.(); window.LubaydAdmin?.loadCatalogs?.(); }
    if (name === 'configuracion') updateOfflineStatus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function updatePending() {
    const pending = state.user ? await window.LubaydData.pendingCount().catch(() => 0) : 0;
    $('#pendingBadge').textContent = pending;
    $('#metricPending').textContent = pending;
    $('#syncButton').disabled = !navigator.onLine || pending === 0 || window.LubaydData.syncing;
    return pending;
  }
  function updateNetwork() {
    const online = navigator.onLine;
    const pill = $('#networkPill');
    pill.classList.toggle('online', online);
    pill.classList.toggle('offline', !online);
    $('#networkTitle').textContent = online ? 'Con conexión' : 'Sin conexión';
    $('#networkText').textContent = online ? 'Sincronización disponible' : 'Guardando en este teléfono';
    applyRoleVisibility();
    updatePending();
  }
  async function updateOfflineStatus() {
    if (!state.user) return;
    const status = await window.LubaydOffline.status(state.user.uid).catch(() => ({ indexedDb: false }));
    $('#checkProfile').textContent = `${status.profile ? '✓' : '○'} Perfil local`;
    $('#checkCredential').textContent = `${status.credential ? '✓' : '○'} Acceso offline`;
    $('#checkDevice').textContent = `${status.device ? '✓' : '○'} Dispositivo autorizado`;
    $('#checkStorage').textContent = `${status.indexedDb ? '✓' : '○'} Almacenamiento local`;
    ['#checkProfile','#checkCredential','#checkDevice','#checkStorage'].forEach(selector => $(selector).classList.toggle('ok', $(selector).textContent.startsWith('✓')));
    const rows = [
      ['Perfil descargado', status.profile],
      ['Contraseña protegida para acceso offline', status.credential],
      ['Teléfono autorizado para sincronizar', status.device],
      ['IndexedDB disponible', status.indexedDb],
      ['Registros pendientes', status.pending || 0],
      ['Preparado el', status.preparedAt ? formatDateTime(status.preparedAt) : '—']
    ];
    $('#offlineDetails').innerHTML = rows.map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><br><span>${typeof value === 'boolean' ? (value ? 'Sí' : 'No') : escapeHtml(value)}</span></div>`).join('');
  }
  async function renderDashboard() {
    if (!state.user) return;
    const parts = window.LubaydParts?.getRecords?.() || [];
    const attendance = window.LubaydAttendance?.getCurrent?.();
    const rest = window.LubaydBreaks?.getCurrent?.();
    const today = localDateKey();
    $('#metricParts').textContent = parts.filter(record => record.dateKey === today).length;
    const attendanceItem = attendance?.payload || {};
    $('#metricAttendance').textContent = attendanceItem.exit?.at ? 'Finalizada' : attendanceItem.entry?.at ? 'Trabajando' : 'Sin marcar';
    const breakItem = rest?.payload || {};
    $('#metricBreak').textContent = breakItem.end?.at ? 'Completado' : breakItem.start?.at ? 'En descanso' : 'Sin registrar';
    await updatePending();
    const all = await window.LubaydOffline.listRecords(null, { userId: state.profile?.role === 'operador' ? state.user.uid : null }).catch(() => []);
    const labels = { part: 'Parte diario', attendance: 'Asistencia', break: 'Descanso', fuel: 'Combustible' };
    const recent = all.slice(0, 8);
    const container = $('#recentActivity');
    if (!recent.length) { container.className = 'record-list empty'; container.textContent = 'Todavía no hay registros.'; }
    else {
      container.className = 'record-list';
      container.innerHTML = recent.map(record => `<article class="record-card"><header><div><h4>${escapeHtml(labels[record.type] || record.type)}</h4><p>${formatDateTime(record.updatedAtClient || record.createdAtClient)}</p></div><span class="status-badge ${record.status === 'synced' ? '' : record.status}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header></article>`).join('');
    }
    updateOfflineStatus();
  }
  async function synchronize() {
    const button = $('#syncButton');
    window.Lubayd.setBusy(button, true, 'Sincronizando');
    try {
      const result = await window.LubaydData.syncAll();
      if (result.errors.length) toast('Sincronización parcial', `${result.synced} enviados y ${result.errors.length} con error.`);
      else toast('Sincronización completa', `${result.synced} registro(s) enviados.`);
    } catch (error) { toast('No se pudo sincronizar', error.message || String(error)); }
    finally { window.Lubayd.setBusy(button, false); await updatePending(); renderDashboard(); }
  }
  function enterSession(detail) {
    if (!detail?.user || !detail?.profile) return;
    state.user = detail.user;
    state.profile = detail.profile;
    state.offlineSession = Boolean(detail.offline);
    window.LubaydLastSession = detail;
    $('#authScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    $('#offlineSessionBanner').classList.toggle('hidden', !state.offlineSession);
    const name = state.profile.nombre || state.user.displayName || state.user.email || 'Usuario';
    $('#sidebarAvatar').textContent = initials(name);
    $('#sidebarName').textContent = name;
    $('#sidebarRole').textContent = `${roleLabel(state.profile.role)}${state.offlineSession ? ' · Offline' : ''}`;
    $('#welcomeTitle').textContent = `Bienvenido, ${name.split(/\s+/)[0]}`;
    $('#todayLabel').textContent = new Intl.DateTimeFormat('es-UY', { timeZone: config.timeZone, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
    applyRoleVisibility();
    updateNetwork();
    const requested = new URLSearchParams(location.search).get('view') || sessionStorage.getItem('lubayd_last_view_v21_3') || 'dashboard';
    showView(requested);
    updateOfflineStatus();
    renderDashboard();
    if (navigator.onLine) setTimeout(async () => {
      const pending = await updatePending();
      if (pending > 0) synchronize().catch(() => {});
    }, 700);
  }
  function endSession() {
    state.user = null;
    state.profile = null;
    state.offlineSession = false;
    window.LubaydLastSession = null;
    $('#appShell').classList.add('hidden');
    $('#authScreen').classList.remove('hidden');
    $('#offlineSessionBanner').classList.add('hidden');
    $('#loginPassword').value = '';
    window.LubaydAuth.updateConnection();
  }
  async function forceUpdate() {
    const message = $('#settingsMessage');
    message.textContent = 'Actualizando archivos de la aplicación…';
    message.className = 'form-message success';
    try {
      const registration = state.serviceWorkerRegistration || await navigator.serviceWorker.getRegistration();
      await registration?.update?.();
      if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      else {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.toLowerCase().includes('lubayd')).map(key => caches.delete(key)));
        location.reload();
      }
    } catch (error) {
      message.textContent = error.message || String(error);
      message.className = 'form-message';
    }
  }
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js?v=21.3.0', { scope: './' });
      state.serviceWorkerRegistration = registration;
      if (registration.waiting) { state.waitingWorker = registration.waiting; $('#updateBanner').classList.remove('hidden'); }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            state.waitingWorker = registration.waiting || worker;
            $('#updateBanner').classList.remove('hidden');
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateReloading) return;
        updateReloading = true;
        location.reload();
      });
    } catch (error) { console.warn('[Lubayd] Service Worker:', error); }
  }
  async function restoreSession() {
    const local = window.LubaydOffline.currentSession();
    if (local) {
      const user = { uid: local.uid, email: local.email, displayName: local.profile?.nombre || '', isOffline: true };
      const detail = { user, profile: local.profile, offline: true, source: 'offline-session' };
      state.user = user;
      state.profile = local.profile;
      state.offlineSession = true;
      enterSession(detail);
      emit('lubayd-session-ready', detail);
      return;
    }
    const cloudUser = window.LubaydCloud?.currentUser?.();
    if (cloudUser) {
      try {
        const profile = await window.LubaydCloud.profileFor(cloudUser);
        const detail = { user: cloudUser, profile, offline: false, source: 'startup' };
        state.user = cloudUser;
        state.profile = profile;
        state.offlineSession = false;
        enterSession(detail);
        emit('lubayd-session-ready', detail);
      } catch (error) { console.warn('[Lubayd] Inicio persistido:', error); }
    }
  }
  function bind() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    $$('[data-view-target]').forEach(button => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
    $('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#syncButton').addEventListener('click', synchronize);
    $('#refreshOfflineButton').addEventListener('click', updateOfflineStatus);
    $('#forceUpdateButton').addEventListener('click', forceUpdate);
    $('#applyUpdateButton').addEventListener('click', () => { state.waitingWorker?.postMessage?.({ type: 'SKIP_WAITING' }); });
    window.addEventListener('online', () => { updateNetwork(); if (state.user) synchronize().catch(() => {}); });
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('lubayd-session-ready', event => enterSession(event.detail));
    window.addEventListener('lubayd-session-ended', endSession);
    window.addEventListener('lubayd-queue-changed', () => { updatePending(); renderDashboard(); });
    window.addEventListener('lubayd-module-updated', renderDashboard);
    window.addEventListener('lubayd-sync-state', event => { $('#syncButton').disabled = event.detail.syncing || !navigator.onLine; });
  }
  function init() {
    bind();
    updateNetwork();
    registerServiceWorker();
    restoreSession();
  }
  window.LubaydApp = { enterSession, endSession, showView, renderDashboard, updatePending, updateOfflineStatus, synchronize, forceUpdate };
  init();
})();
