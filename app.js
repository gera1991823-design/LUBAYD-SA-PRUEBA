/* Lubayd SA V22.4.0 - aplicación principal responsive y diagnósticos */
(function () {
  'use strict';
  const { $, $$, state, config, initials, formatDateTime, escapeHtml, toast, emit, localDateKey, formatNumber, getGps, formatGps, setBusy } = window.Lubayd;
  const viewTitles = {
    dashboard: ['RESUMEN GENERAL', 'Dashboard'],
    asistencia: ['CONTROL HORARIO', 'Asistencia'],
    combustible: ['CONTROL DE SALDOS', 'Combustible'],
    partes: ['OPERACIÓN', 'Parte diario'],
    administracion: ['ADMINISTRACIÓN', 'Control del sistema'],
    chat: ['COMUNICACIÓN', 'Mensajes'],
    configuracion: ['SINCRONIZACIÓN', 'Modo sin conexión']
  };
  let updateReloading = false;
  let maintenancePromise = null;
  const VIEW_KEY = 'lubayd_last_view_v22_4';
  const UI_SESSION_KEY = 'lubayd_ui_session_v22_4';
  const LEGACY_UI_SESSION_KEYS = ['lubayd_ui_session_v22_3', 'lubayd_ui_session_v22_2'];
  const ACCESS_MODE_KEY = 'lubayd_access_mode_v22_4';
  const LOCAL_MARKS_CLEAR_KEY = 'lubayd_marks_local_cleared_v22_2';
  const CLOUD_MARKS_CLEAR_KEY = 'lubayd_marks_cloud_cleared_v22_2';

  function roleLabel(role) { return ({ admin: 'Administrador', supervisor: 'Supervisor', operador: 'Operador' })[role] || 'Operador'; }
  function safeUser(user) {
    if (!user) return null;
    return { uid: user.uid || '', email: user.email || '', displayName: user.displayName || '' };
  }
  function rememberSession(detail) {
    if (!detail?.user || !detail?.profile) return;
    const session = {
      user: safeUser(detail.user),
      profile: detail.profile,
      offline: Boolean(detail.offline),
      mode: detail.offline ? 'offline' : 'online',
      expiresAt: detail.session?.expiresAt || new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(UI_SESSION_KEY, JSON.stringify(session));
  }
  function clearRememberedSession() {
    localStorage.removeItem(UI_SESSION_KEY);
    LEGACY_UI_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
    document.documentElement.classList.remove('lubayd-session-hint', 'lubayd-session-restoring');
    delete document.documentElement.dataset.bootView;
  }
  function finishBoot() {
    document.documentElement.classList.remove('lubayd-session-restoring');
  }
  async function clearMarksMaintenance() {
    if (maintenancePromise) return maintenancePromise;
    maintenancePromise = (async () => {
      if (!localStorage.getItem(LOCAL_MARKS_CLEAR_KEY)) {
        const result = await window.LubaydOffline.clearRecordTypes(['attendance', 'break']);
        localStorage.setItem(LOCAL_MARKS_CLEAR_KEY, new Date().toISOString());
        await Promise.all([
          window.LubaydAttendance?.refresh?.(),
          window.LubaydBreaks?.refresh?.()
        ]);
        emit('lubayd-module-updated', { module: 'marks-cleanup', result });
      }
      if (state.profile?.role === 'admin' && navigator.onLine && !state.offlineSession && !localStorage.getItem(CLOUD_MARKS_CLEAR_KEY)) {
        try {
          const result = await window.LubaydCloud.call('adminClearMarks', { migrationId: 'clear_marks_v22_2_0' });
          localStorage.setItem(CLOUD_MARKS_CLEAR_KEY, new Date().toISOString());
          const total = Number(result?.deleted?.total || 0);
          toast('Registros de marcas eliminados', total ? `${total} documento(s) fueron eliminados.` : 'La limpieza ya estaba realizada.');
          window.LubaydAdmin?.loadOperationalRecords?.();
        } catch (error) {
          console.warn('[Lubayd] Limpieza de marcas en la nube:', error);
        }
      }
    })().finally(() => { maintenancePromise = null; });
    return maintenancePromise;
  }
  function applyRoleVisibility() {
    const admin = state.profile?.role === 'admin' && !state.offlineSession;
    const canOperate = ['admin', 'supervisor', 'operador'].includes(state.profile?.role);
    $$('.admin-only').forEach(element => element.classList.toggle('hidden', !admin));
    $$('.operator-only').forEach(element => element.classList.toggle('hidden', !canOperate));
    $$('.online-only').forEach(element => element.classList.toggle('hidden', state.offlineSession || !navigator.onLine));
  }
  function showView(name) {
    if (!state.user) return;
    if (name === 'administracion' && state.profile?.role !== 'admin') name = 'dashboard';
    if (name === 'chat' && (state.offlineSession || !navigator.onLine)) {
      toast('Mensajes no disponibles', 'El chat requiere conexión e inicio de sesión online.');
      name = 'dashboard';
    }
    if (!$(`#view-${name}`)) name = 'dashboard';
    $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    const title = viewTitles[name] || viewTitles.dashboard;
    $('#pageEyebrow').textContent = title[0];
    $('#pageTitle').textContent = title[1];
    state.currentView = name;
    localStorage.setItem(VIEW_KEY, name);
    const url = new URL(location.href);
    if (name === 'dashboard') url.searchParams.delete('view');
    else url.searchParams.set('view', name);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    $('#sidebar').classList.remove('open');
    if (name === 'chat') window.LubaydChat?.loadContacts?.();
    if (name === 'administracion') { window.LubaydAdmin?.loadUsers?.(); window.LubaydAdmin?.loadCatalogs?.(); window.LubaydAdmin?.loadOperationalRecords?.(); }
    if (name === 'configuracion') updateOfflineStatus();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  async function updatePending() {
    const pending = state.user ? await window.LubaydData.pendingCount().catch(() => 0) : 0;
    ['#pendingBadge','#metricPending','#dashboardPending'].forEach(selector => { const element = $(selector); if (element) element.textContent = pending; });
    $('#syncButton').disabled = !navigator.onLine || pending === 0 || window.LubaydData.syncing;
    if ($('#dashboardSyncButton')) $('#dashboardSyncButton').disabled = !navigator.onLine || pending === 0 || window.LubaydData.syncing;
    if ($('#syncSettingsButton')) $('#syncSettingsButton').disabled = !navigator.onLine || pending === 0 || window.LubaydData.syncing;
    return pending;
  }
  function updateNetwork() {
    const online = navigator.onLine;
    const offlineMode = Boolean(state.offlineSession);
    const pill = $('#networkPill');
    pill.classList.toggle('online', online && !offlineMode);
    pill.classList.toggle('offline', !online);
    pill.classList.toggle('mode-offline', offlineMode);
    $('#networkTitle').textContent = offlineMode ? 'Modo offline' : online ? 'Online' : 'Sin conexión';
    $('#networkText').textContent = offlineMode
      ? (online ? 'Internet disponible' : 'Guardando en este teléfono')
      : (online ? 'Sincronización disponible' : 'Esperando conexión');
    applyRoleVisibility();
    updatePending();
  }
  async function updateOfflineStatus() {
    if (!state.user) return;
    const status = await window.LubaydOffline.status(state.user.uid).catch(() => ({ indexedDb: false }));
    const checks = [['#checkProfile','Perfil local',status.profile],['#checkCredential','Acceso offline',status.credential],['#checkDevice','Dispositivo autorizado',status.device],['#checkStorage','Almacenamiento local',status.indexedDb]];
    checks.forEach(([selector,label,ok]) => { const element=$(selector); if (!element) return; element.textContent=`${ok?'✓':'○'} ${label}`; element.classList.toggle('ok',Boolean(ok)); });
    const storageMb = status.storage?.quota ? `${(Number(status.storage.usage || 0) / 1048576).toFixed(1)} MB de ${(Number(status.storage.quota || 0) / 1048576).toFixed(0)} MB` : 'Sin datos';
    const rows = [
      ['Perfil descargado', status.profile], ['Contraseña protegida', status.credential], ['Teléfono autorizado', status.device],
      ['IndexedDB disponible', status.indexedDb], ['Almacenamiento persistente', Boolean(status.storage?.persistent)],
      ['Espacio utilizado', storageMb], ['Registros pendientes', status.pending || 0], ['Preparado el', status.preparedAt ? formatDateTime(status.preparedAt) : '—']
    ];
    $('#offlineDetails').innerHTML = rows.map(([label,value]) => `<div><strong>${escapeHtml(label)}</strong><br><span>${typeof value === 'boolean' ? (value ? 'Sí' : 'No') : escapeHtml(value)}</span></div>`).join('');
  }
  async function renderDashboard() {
    if (!state.user) return;
    const parts = window.LubaydParts?.getRecords?.() || [];
    const attendanceRecords = window.LubaydAttendance?.getRecords?.() || [];
    const attendance = window.LubaydAttendance?.getCurrent?.();
    const rest = window.LubaydBreaks?.getCurrent?.();
    const fuel = window.LubaydFuel?.getState?.() || { tankLiters:0,trailerLiters:0,machines:{} };
    const today = localDateKey();
    const todayParts = parts.filter(record => record.dateKey === today).length;
    const todayAttendance = attendanceRecords.filter(record => record.dateKey === today).length;
    $('#metricParts').textContent = todayParts;
    $('#metricAttendanceCount').textContent = todayAttendance;
    const attendanceItem = attendance?.payload || {};
    const attendanceText = attendanceItem.exit?.at ? 'Finalizada' : attendanceItem.entry?.at ? 'Trabajando' : 'Sin marcar';
    $('#metricAttendance').textContent = attendanceText;
    $('#dashboardAttendanceState').textContent = attendanceText;
    const breakItem = rest?.payload || {};
    $('#metricBreak').textContent = breakItem.end?.at ? 'Completado' : breakItem.start?.at ? 'En descanso' : 'Sin registrar';
    const machinesTotal = Object.values(fuel.machines || {}).reduce((sum,value)=>sum+Number(value||0),0);
    $('#metricFuel').textContent = `${formatNumber(machinesTotal,1)} L`;
    $('#dashboardFuelTank').textContent = `${formatNumber(fuel.tankLiters,1)} L`;
    $('#dashboardFuelTrailer').textContent = `${formatNumber(fuel.trailerLiters,1)} L`;
    $('#dashboardFuelMachines').textContent = `${formatNumber(machinesTotal,1)} L`;
    await updatePending();
    const all = await window.LubaydOffline.listRecords(null, { userId: state.profile?.role === 'operador' ? state.user.uid : null }).catch(() => []);
    const labels = { part: 'Parte diario', attendance: 'Asistencia', break: 'Descanso', fuel: 'Combustible' };
    const recent = all.slice(0, 5);
    const container = $('#recentActivity');
    if (!recent.length) { container.className = 'record-list compact empty'; container.textContent = 'Todavía no hay registros.'; }
    else {
      container.className = 'record-list compact';
      container.innerHTML = recent.map(record => `<article class="record-card"><header><div><h4>${escapeHtml(labels[record.type] || record.type)}</h4><p>${formatDateTime(record.updatedAtClient || record.createdAtClient)}</p></div><span class="status-badge ${record.status === 'synced' ? '' : record.status}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header></article>`).join('');
    }
    const lastSync = localStorage.getItem('lubayd_last_sync_v22_1');
    $('#lastSyncLabel').textContent = lastSync ? formatDateTime(lastSync) : 'Sin datos';
    if (state.currentView === 'configuracion') updateOfflineStatus();
  }
  async function synchronize() {
    const buttons = [$('#syncButton'),$('#dashboardSyncButton'),$('#syncSettingsButton')].filter(Boolean);
    buttons.forEach(button => window.Lubayd.setBusy(button, true, 'Sincronizando'));
    try {
      const result = await window.LubaydData.syncAll();
      if (result.errors.length) toast('Sincronización parcial', `${result.synced} enviados y ${result.errors.length} con error.`);
      else {
        localStorage.setItem('lubayd_last_sync_v22_1', new Date().toISOString());
        toast('Sincronización completa', `${result.synced} registro(s) enviados.`);
      }
    } catch (error) { toast('No se pudo sincronizar', error.message || String(error)); }
    finally { buttons.forEach(button => window.Lubayd.setBusy(button, false)); await updatePending(); renderDashboard(); }
  }
  function enterSession(detail) {
    if (!detail?.user || !detail?.profile) return;
    state.user = detail.user;
    state.profile = detail.profile;
    state.offlineSession = Boolean(detail.offline);
    const accessMode = state.offlineSession ? 'offline' : 'online';
    localStorage.setItem(ACCESS_MODE_KEY, accessMode);
    window.LubaydLastSession = detail;
    rememberSession(detail);
    document.documentElement.classList.add('lubayd-session-hint');
    $('#authScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    $('#offlineSessionBanner').classList.toggle('hidden', !state.offlineSession);
    const name = state.profile.nombre || state.user.displayName || state.user.email || 'Usuario';
    $('#sidebarAvatar').textContent = initials(name);
    $('#sidebarName').textContent = name;
    $('#sidebarRole').textContent = `${roleLabel(state.profile.role)} · ${state.offlineSession ? 'Offline' : 'Online'}`;
    applyRoleVisibility();
    updateNetwork();
    const requested = new URLSearchParams(location.search).get('view') || localStorage.getItem(VIEW_KEY) || window.__LUBAYD_BOOT_VIEW || 'dashboard';
    showView(requested);
    finishBoot();
    updateOfflineStatus();
    renderDashboard();
    setTimeout(() => clearMarksMaintenance().catch(error => console.warn('[Lubayd] Mantenimiento:', error)), 100);
    if (navigator.onLine) setTimeout(async () => { const pending = await updatePending(); if (pending > 0) synchronize().catch(() => {}); }, 800);
  }
  function endSession() {
    state.user = null;
    state.profile = null;
    state.offlineSession = false;
    window.LubaydLastSession = null;
    clearRememberedSession();
    $('#appShell').classList.add('hidden');
    $('#authScreen').classList.remove('hidden');
    $('#offlineSessionBanner').classList.add('hidden');
    $('#loginPassword').value = '';
    window.LubaydAuth.updateConnection();
  }
  async function testGps() {
    const button = $('#testGpsButton');
    const message = $('#settingsMessage');
    setBusy(button, true, 'Probando GPS');
    message.textContent = 'Buscando ubicación...';
    message.className = 'form-message';
    try {
      const gps = await getGps({ forceFresh: true, onStatus: status => { message.textContent = status; } });
      message.textContent = `GPS correcto: ${formatGps(gps)}`;
      message.className = 'form-message success';
    } catch (error) {
      message.textContent = error.message || String(error);
      message.className = 'form-message';
    } finally {
      setBusy(button, false);
    }
  }

  async function forceUpdate() {
    const message = $('#settingsMessage'); message.textContent = 'Actualizando archivos de la aplicación…'; message.className = 'form-message success';
    try {
      const registration = state.serviceWorkerRegistration || await navigator.serviceWorker.getRegistration();
      await registration?.update?.();
      if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      else { const keys = await caches.keys(); await Promise.all(keys.filter(key => key.toLowerCase().includes('lubayd')).map(key => caches.delete(key))); location.reload(); }
    } catch (error) { message.textContent = error.message || String(error); message.className = 'form-message'; }
  }
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js?v=22.4.0', { scope: './' });
      state.serviceWorkerRegistration = registration;
      if (registration.waiting) { state.waitingWorker = registration.waiting; $('#updateBanner').classList.remove('hidden'); }
      registration.addEventListener('updatefound', () => { const worker = registration.installing; worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { state.waitingWorker = registration.waiting || worker; $('#updateBanner').classList.remove('hidden'); } }); });
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateReloading) return; updateReloading = true; location.reload(); });
    } catch (error) { console.warn('[Lubayd] Service Worker:', error); }
  }
  async function restoreSession() {
    const remembered = window.__LUBAYD_BOOT_SESSION;
    const selectedMode = localStorage.getItem(ACCESS_MODE_KEY) || window.__LUBAYD_BOOT_MODE || remembered?.mode || (remembered?.offline ? 'offline' : remembered ? 'online' : '');

    if (selectedMode === 'offline') {
      const local = window.LubaydOffline.currentSession();
      if (local) {
        const user = { uid: local.uid, email: local.email, displayName: local.profile?.nombre || '', isOffline: true };
        const detail = { user, profile: local.profile, offline: true, mode: 'offline', source: 'offline-session', session: local };
        enterSession(detail);
        return;
      }
      localStorage.removeItem(ACCESS_MODE_KEY);
      endSession();
      window.LubaydAuth?.setMode?.('offline');
      return;
    }

    const cloudUser = await window.LubaydCloud?.waitForAuthState?.(8000).catch(() => null);
    if (state.user) { finishBoot(); return; }
    if (cloudUser) {
      try {
        const profile = await window.LubaydCloud.profileFor(cloudUser);
        const detail = { user: cloudUser, profile, offline: false, mode: 'online', source: 'startup' };
        enterSession(detail);
        return;
      } catch (error) {
        console.warn('[Lubayd] Sesión online persistida:', error);
      }
    }
    localStorage.removeItem(ACCESS_MODE_KEY);
    endSession();
    window.LubaydAuth?.setMode?.(selectedMode === 'offline' ? 'offline' : 'online');
  }
  function bind() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    $$('[data-view-target]').forEach(button => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
    $('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    [$('#syncButton'),$('#dashboardSyncButton'),$('#syncSettingsButton')].filter(Boolean).forEach(button => button.addEventListener('click', synchronize));
    $('#refreshOfflineButton').addEventListener('click', updateOfflineStatus);
    $('#testGpsButton').addEventListener('click', testGps);
    $('#forceUpdateButton').addEventListener('click', forceUpdate);
    $('#applyUpdateButton').addEventListener('click', () => state.waitingWorker?.postMessage?.({ type: 'SKIP_WAITING' }));
    window.addEventListener('online', async () => {
      updateNetwork();
      if (!state.user) return;
      const ready = await window.LubaydCloud?.ensureReady?.(18000).catch(() => false);
      if (!ready) return;
      const pending = await updatePending().catch(() => 0);
      if (pending > 0) synchronize().catch(() => {});
    });
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('lubayd-session-ready', event => { const detail = event.detail || {}; const mode = localStorage.getItem(ACCESS_MODE_KEY); if (mode === 'offline' && !detail.offline) return; if (mode === 'online' && detail.offline) return; enterSession(detail); }); window.addEventListener('lubayd-session-ended', endSession);
    window.addEventListener('lubayd-queue-changed', () => { updatePending(); renderDashboard(); });
    window.addEventListener('lubayd-module-updated', renderDashboard);
    window.addEventListener('lubayd-sync-state', event => { [$('#syncButton'),$('#dashboardSyncButton'),$('#syncSettingsButton')].filter(Boolean).forEach(button => button.disabled = event.detail.syncing || !navigator.onLine); });
  }
  function init() { bind(); updateNetwork(); registerServiceWorker(); restoreSession(); }
  window.LubaydApp = { enterSession, endSession, showView, renderDashboard, updatePending, updateOfflineStatus, synchronize, testGps, forceUpdate, clearMarksMaintenance };
  init();
})();
