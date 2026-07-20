/* Lubayd SA V20.2 - Aplicación principal */
(function () {
  'use strict';

  const VERSION = '20.2.0';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const state = {
    user: null,
    profile: null,
    parts: [],
    partsUnsubscribe: null,
    users: [],
    currentPartGps: null,
    toastTimer: null,
    deferredInstall: null,
    waitingWorker: null
  };

  const db = () => window.LubaydFirebase?.db;
  const FieldValue = () => window.LubaydFirebase?.FieldValue;
  const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayKey = () => localDateKey(new Date());
  const isManager = () => ['admin', 'supervisor'].includes(state.profile?.role);
  const isAdmin = () => state.profile?.role === 'admin';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function formatNumber(value, digits) {
    return new Intl.NumberFormat('es-UY', { maximumFractionDigits: digits ?? 0 }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return new Intl.DateTimeFormat('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
    return new Intl.DateTimeFormat('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function initials(name) {
    const parts = String(name || 'U').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  function toast(title, text) {
    const element = $('#toast');
    $('#toastTitle').textContent = title;
    $('#toastText').textContent = text || '';
    element.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.add('hidden'), 4200);
  }

  window.LubaydUI = { toast, escapeHtml, formatDateTime };

  function setAuthMessage(text, success) {
    const message = $('#authMessage');
    message.textContent = text || '';
    message.className = `form-message${success ? ' success' : ''}`;
  }

  function setAuthBusy(form, busy, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? `${label}…` : button.dataset.label;
  }

  function showAuthTab(tab) {
    $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
    $('#loginForm').classList.toggle('active', tab === 'login');
    $('#registerForm').classList.toggle('active', tab === 'register');
    setAuthMessage('');
  }

  function bindAuth() {
    $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showAuthTab(button.dataset.authTab)));
    $('#loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setAuthBusy(form, true, 'Ingresando');
      setAuthMessage('');
      try {
        await window.LubaydFirebase.login($('#loginEmail').value, $('#loginPassword').value);
      } catch (error) {
        setAuthMessage(window.LubaydFirebase.authErrorMessage(error));
      } finally {
        setAuthBusy(form, false, 'Ingresando');
      }
    });
    $('#registerForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if ($('#registerPassword').value !== $('#registerConfirm').value) {
        setAuthMessage('Las contraseñas no coinciden.');
        return;
      }
      setAuthBusy(form, true, 'Creando usuario');
      setAuthMessage('');
      try {
        await window.LubaydFirebase.register($('#registerName').value, $('#registerEmail').value, $('#registerPassword').value);
      } catch (error) {
        setAuthMessage(window.LubaydFirebase.authErrorMessage(error));
      } finally {
        setAuthBusy(form, false, 'Creando usuario');
      }
    });
    $('#resetPasswordButton').addEventListener('click', async () => {
      const email = $('#loginEmail').value.trim();
      if (!email) {
        setAuthMessage('Escribe tu correo para recibir el enlace de recuperación.');
        $('#loginEmail').focus();
        return;
      }
      try {
        await window.LubaydFirebase.resetPassword(email);
        setAuthMessage('Se envió el correo para restablecer la contraseña.', true);
      } catch (error) {
        setAuthMessage(window.LubaydFirebase.authErrorMessage(error));
      }
    });
  }

  async function logout() {
    try { await window.LubaydFirebase.logout(); } catch (error) { toast('No se pudo cerrar sesión', error.message || String(error)); }
  }

  function updateRoleVisibility() {
    $$('.manager-only').forEach(element => element.classList.toggle('hidden', !isManager()));
    $$('[data-view="users"]').forEach(element => element.classList.toggle('hidden', !isAdmin()));
    $('#view-users').classList.toggle('hidden', !isAdmin());
  }

  function updateUserInterface() {
    const name = state.profile?.nombre || state.user?.displayName || state.user?.email || 'Usuario';
    const roleLabels = { admin: 'Administrador', supervisor: 'Supervisor', operador: 'Operador' };
    $('#sidebarInitials').textContent = initials(name);
    $('#sidebarUserName').textContent = name;
    $('#sidebarUserRole').textContent = roleLabels[state.profile?.role] || state.profile?.role || 'Operador';
    $('#dashboardGreeting').textContent = `Hola, ${name.split(/\s+/)[0]}`;
    $('#dashboardDate').textContent = new Intl.DateTimeFormat('es-UY', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
    $('#settingsUserText').textContent = `${name} · ${state.user?.email || ''} · ${roleLabels[state.profile?.role] || state.profile?.role}`;
    updateRoleVisibility();
  }

  const viewMeta = {
    dashboard: ['CENTRO DE OPERACIONES', 'Inicio'],
    partes: ['REGISTRO OPERATIVO', 'Partes diarios'],
    attendance: ['CONTROL HORARIO', 'Asistencia'],
    chat: ['COMUNICACIÓN INTERNA', 'Mensajes'],
    users: ['ADMINISTRACIÓN', 'Usuarios'],
    settings: ['PREFERENCIAS', 'Configuración']
  };

  function showView(name) {
    if (!state.user) return;
    if (name === 'users' && !isAdmin()) {
      toast('Acceso restringido', 'Solo el administrador puede gestionar usuarios.');
      return;
    }
    const view = $(`#view-${name}`);
    if (!view) return;
    $$('.view').forEach(item => item.classList.toggle('active', item === view));
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    const [eyebrow, title] = viewMeta[name] || viewMeta.dashboard;
    $('#pageEyebrow').textContent = eyebrow;
    $('#pageTitle').textContent = title;
    if (name === 'users' && isAdmin()) loadUsers();
    if (name === 'attendance') {
      window.LubaydAttendance?.refreshMyAttendance?.();
      if (isManager()) window.LubaydAttendance?.refreshManagerAttendance?.({ silent: true });
    }
    if (name === 'chat') window.LubaydChat?.loadContacts?.();
    history.replaceState(null, '', `${location.pathname}${name === 'dashboard' ? '' : `?view=${encodeURIComponent(name)}`}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindNavigation() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  }

  function getGps() {
    if (!navigator.geolocation) return Promise.reject(new Error('El dispositivo no dispone de GPS.'));
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      capturedAtClient: new Date().toISOString()
    }), error => reject(new Error(error.code === 1 ? 'Debes permitir la ubicación.' : 'No se pudo obtener la ubicación.')), { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 }));
  }

  async function capturePartGps() {
    const button = $('#capturePartGpsButton');
    button.disabled = true;
    button.textContent = 'Obteniendo…';
    $('#partGpsState').textContent = 'Consultando el GPS del dispositivo…';
    try {
      state.currentPartGps = await getGps();
      $('#partGpsState').textContent = `Ubicación lista: ${state.currentPartGps.latitude.toFixed(5)}, ${state.currentPartGps.longitude.toFixed(5)} · ±${Math.round(state.currentPartGps.accuracy)} m.`;
    } catch (error) {
      state.currentPartGps = null;
      $('#partGpsState').textContent = error.message || String(error);
    } finally {
      button.disabled = false;
      button.textContent = 'Obtener ubicación';
    }
  }

  function calculatePartValues() {
    const hours = Math.max(0, (Number($('#partHourEnd').value) || 0) - (Number($('#partHourStart').value) || 0));
    const trees = Math.max(0, (Number($('#partTreesEnd').value) || 0) - (Number($('#partTreesStart').value) || 0));
    return { hours, trees };
  }

  async function savePart(event) {
    event.preventDefault();
    if (!state.user) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Guardando…';
    $('#partMessage').textContent = '';
    try {
      if (!state.currentPartGps) await capturePartGps();
      if (!state.currentPartGps) throw new Error('No se pudo obtener la ubicación requerida.');
      const values = calculatePartValues();
      const ref = db().collection('partes').doc();
      await ref.set({
        createdByUid: state.user.uid,
        createdByName: state.profile?.nombre || state.user.displayName || state.user.email,
        createdByEmail: state.user.email || '',
        dateKey: $('#partDate').value,
        machine: $('#partMachine').value.trim(),
        forest: $('#partForest').value.trim(),
        shift: $('#partShift').value,
        hourStart: Number($('#partHourStart').value) || 0,
        hourEnd: Number($('#partHourEnd').value) || 0,
        hours: values.hours,
        treesStart: Number($('#partTreesStart').value) || 0,
        treesEnd: Number($('#partTreesEnd').value) || 0,
        trees: values.trees,
        fuel: Number($('#partFuel').value) || 0,
        notes: $('#partNotes').value.trim(),
        gps: Object.assign({}, state.currentPartGps),
        createdAt: FieldValue().serverTimestamp(),
        createdAtClient: new Date().toISOString()
      });
      event.currentTarget.reset();
      $('#partDate').value = todayKey();
      state.currentPartGps = null;
      $('#partGpsState').textContent = 'Ubicación todavía no capturada.';
      $('#partMessage').textContent = 'Parte guardado correctamente.';
      $('#partMessage').className = 'form-message success';
      toast('Parte guardado', 'El registro quedó sincronizado con Firestore.');
    } catch (error) {
      $('#partMessage').textContent = error.message || String(error);
      $('#partMessage').className = 'form-message';
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function subscribeParts() {
    state.partsUnsubscribe?.();
    if (!state.user || !db()) return;
    let query = db().collection('partes');
    if (!isManager()) query = query.where('createdByUid', '==', state.user.uid);
    state.partsUnsubscribe = query.onSnapshot(snapshot => {
      state.parts = snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data())).sort((a, b) => {
        const av = a.createdAt?.toMillis?.() || new Date(a.createdAtClient || a.dateKey || 0).getTime();
        const bv = b.createdAt?.toMillis?.() || new Date(b.createdAtClient || b.dateKey || 0).getTime();
        return bv - av;
      });
      renderParts();
      renderDashboard();
    }, error => {
      console.error('Partes:', error);
      $('#partsList').className = 'card-list empty-state';
      $('#partsList').textContent = `No se pudieron cargar los partes: ${error.message || error}`;
    });
  }

  function partCard(part) {
    return `<article class="part-card"><header><div><h4>${escapeHtml(part.machine || 'Máquina')}</h4><p>${escapeHtml(part.forest || 'Monte')} · ${formatDate(part.dateKey)}</p></div><span class="status-pill online">Sincronizado</span></header><footer><span>${formatNumber(part.hours, 1)} h</span><span>${formatNumber(part.trees)} árboles</span><span>${formatNumber(part.fuel, 1)} L</span><span>${escapeHtml(part.createdByName || '')}</span></footer></article>`;
  }

  function renderParts() {
    const list = $('#partsList');
    if (!state.parts.length) {
      list.className = 'card-list empty-state';
      list.textContent = 'Sin registros.';
      return;
    }
    list.className = 'card-list';
    list.innerHTML = state.parts.slice(0, 30).map(partCard).join('');
  }

  function renderDashboard() {
    const records = window.LubaydAttendance?.getRecords?.() || [];
    const current = window.LubaydAttendance?.getCurrent?.();
    const attendance = isManager() ? records : (current ? [current] : []);
    const present = attendance.filter(item => item.entrada?.at).length;
    const working = attendance.filter(item => item.entrada?.at && !item.salida?.at).length;
    const finished = attendance.filter(item => item.salida?.at).length;
    const todayParts = state.parts.filter(item => item.dateKey === todayKey());
    $('#metricPresent').textContent = present;
    $('#metricWorking').textContent = working;
    $('#metricFinished').textContent = finished;
    $('#metricParts').textContent = todayParts.length;

    const attendanceBox = $('#dashboardAttendance');
    if (!attendance.length) {
      attendanceBox.className = 'compact-list empty-state';
      attendanceBox.textContent = 'Sin marcas para mostrar.';
    } else {
      attendanceBox.className = 'compact-list';
      attendanceBox.innerHTML = attendance.slice(0, 5).map(item => `<div class="compact-item"><div><strong>${escapeHtml(item.userName || item.userEmail || 'Usuario')}</strong><small>${item.salida?.at ? 'Jornada finalizada' : 'Trabajando'}</small></div><time>${item.entrada?.at ? formatDateTime(item.entrada.at).split(' ').slice(-1)[0] : '--:--'}</time></div>`).join('');
    }

    const partsBox = $('#dashboardParts');
    if (!state.parts.length) {
      partsBox.className = 'compact-list empty-state';
      partsBox.textContent = 'Sin partes para mostrar.';
    } else {
      partsBox.className = 'compact-list';
      partsBox.innerHTML = state.parts.slice(0, 5).map(item => `<div class="compact-item"><div><strong>${escapeHtml(item.machine || 'Máquina')}</strong><small>${escapeHtml(item.forest || '')} · ${formatNumber(item.trees)} árboles</small></div><time>${formatDate(item.dateKey)}</time></div>`).join('');
    }
  }

  async function loadUsers() {
    if (!isAdmin() || !db()) return;
    const list = $('#usersList');
    list.className = 'user-admin-list empty-state';
    list.textContent = 'Cargando usuarios…';
    try {
      const snapshot = await db().collection('usuarios').get();
      state.users = snapshot.docs.map(doc => Object.assign({ uid: doc.id }, doc.data())).sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
      renderUsers();
    } catch (error) {
      list.textContent = `No se pudieron cargar los usuarios: ${error.message || error}`;
    }
  }

  function renderUsers() {
    const list = $('#usersList');
    if (!state.users.length) {
      list.className = 'user-admin-list empty-state';
      list.textContent = 'No hay usuarios.';
      return;
    }
    list.className = 'user-admin-list';
    list.innerHTML = state.users.map(user => `<article class="user-row" data-user-id="${escapeHtml(user.uid)}"><header><div><h3>${escapeHtml(user.nombre || user.email || 'Usuario')}</h3><p>${escapeHtml(user.email || '')}</p></div><span class="contact-avatar">${escapeHtml(initials(user.nombre || user.email))}</span></header><div class="controls"><select data-user-role ${user.uid === state.user.uid ? 'disabled' : ''}><option value="operador" ${user.role === 'operador' ? 'selected' : ''}>Operador</option><option value="supervisor" ${user.role === 'supervisor' ? 'selected' : ''}>Supervisor</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select><label class="toggle"><input type="checkbox" data-user-active ${user.active !== false ? 'checked' : ''} ${user.uid === state.user.uid ? 'disabled' : ''}> Activo</label></div></article>`).join('');
  }

  async function updateUser(uid, changes) {
    if (!isAdmin()) return;
    try {
      await db().collection('usuarios').doc(uid).update(Object.assign({}, changes, { updatedAt: FieldValue().serverTimestamp() }));
      toast('Usuario actualizado', 'Los permisos se aplicarán en el próximo acceso.');
      await loadUsers();
    } catch (error) {
      toast('No se pudo actualizar', error.message || String(error));
    }
  }

  function updatePushUI(detail) {
    const stateInfo = detail || window.LubaydPush?.state?.() || {};
    const text = $('#pushStatusText');
    const iosHint = $('#iosInstallHint');
    iosHint.classList.toggle('hidden', !(stateInfo.ios && !stateInfo.standalone));
    if (stateInfo.ios && !stateInfo.standalone) text.textContent = 'En Safari normal no se activan. Instala la PWA y ábrela desde el icono.';
    else if (stateInfo.enabled && stateInfo.permission === 'granted') text.textContent = 'Notificaciones activadas en este dispositivo.';
    else if (stateInfo.permission === 'denied') text.textContent = 'Las notificaciones están bloqueadas en los ajustes del dispositivo.';
    else if (stateInfo.supported === false) text.textContent = 'Este navegador no admite notificaciones push web.';
    else text.textContent = 'Las notificaciones todavía no están activadas.';
    $('#enablePushButton').disabled = Boolean(stateInfo.enabled) || (stateInfo.ios && !stateInfo.standalone);
    $('#disablePushButton').disabled = !stateInfo.enabled;
  }

  async function enablePush() {
    const button = $('#enablePushButton');
    button.disabled = true;
    button.textContent = 'Activando…';
    try {
      await window.LubaydPush.enable();
      toast('Notificaciones activadas', 'El dispositivo quedó registrado en push_tokens.');
    } catch (error) {
      toast('No se pudieron activar', error.message || String(error));
    } finally {
      button.textContent = 'Activar notificaciones';
      updatePushUI(window.LubaydPush.state());
    }
  }

  async function disablePush() {
    try {
      await window.LubaydPush.disable();
      toast('Notificaciones desactivadas', 'El token de este dispositivo fue eliminado.');
    } catch (error) {
      toast('No se pudieron desactivar', error.message || String(error));
    }
  }

  async function forceUpdate() {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await Promise.all(registrations.map(registration => registration.update().catch(() => null)));
    location.reload();
  }

  function setConnectionStatus() {
    const badge = $('#connectionBadge');
    if (navigator.onLine) {
      badge.textContent = 'En línea';
      badge.className = 'status-pill online';
    } else {
      badge.textContent = 'Sin conexión';
      badge.className = 'status-pill warning';
    }
  }

  function bindApplicationEvents() {
    $('#logoutButton').addEventListener('click', logout);
    $('#settingsLogoutButton').addEventListener('click', logout);
    $('#capturePartGpsButton').addEventListener('click', capturePartGps);
    $('#partForm').addEventListener('submit', savePart);
    $('#refreshPartsButton').addEventListener('click', () => { subscribeParts(); toast('Partes actualizados', 'Se volvió a consultar Firestore.'); });
    $('#refreshUsersButton').addEventListener('click', loadUsers);
    $('#usersList').addEventListener('change', event => {
      const row = event.target.closest('[data-user-id]');
      if (!row) return;
      if (event.target.matches('[data-user-role]')) updateUser(row.dataset.userId, { role: event.target.value });
      if (event.target.matches('[data-user-active]')) updateUser(row.dataset.userId, { active: event.target.checked });
    });
    $('#enablePushButton').addEventListener('click', enablePush);
    $('#disablePushButton').addEventListener('click', disablePush);
    $('#forceUpdateButton').addEventListener('click', forceUpdate);
    $('#applyUpdateButton').addEventListener('click', () => state.waitingWorker?.postMessage({ type: 'SKIP_WAITING' }));
    $('#installButton').addEventListener('click', async () => {
      if (!state.deferredInstall) return;
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
      state.deferredInstall = null;
      $('#installButton').classList.add('hidden');
    });
    window.addEventListener('lubayd-attendance-updated', renderDashboard);
    window.addEventListener('lubayd-push-state', event => updatePushUI(event.detail));
    window.addEventListener('online', setConnectionStatus);
    window.addEventListener('offline', setConnectionStatus);
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.deferredInstall = event;
      $('#installButton').classList.remove('hidden');
    });
  }

  async function handleAuthState(user, profile, error) {
    state.partsUnsubscribe?.();
    state.partsUnsubscribe = null;
    state.user = null;
    state.profile = null;
    window.LubaydCurrentProfile = null;

    if (error) {
      document.body.classList.remove('auth-ready');
      document.body.classList.add('auth-pending');
      setAuthMessage(window.LubaydFirebase.authErrorMessage(error));
      return;
    }
    if (!user) {
      document.body.classList.remove('auth-ready');
      document.body.classList.add('auth-pending');
      setAuthMessage('');
      window.dispatchEvent(new CustomEvent('lubayd-signed-out'));
      return;
    }
    if (profile?.active === false) {
      await window.LubaydFirebase.logout();
      setAuthMessage('Esta cuenta está desactivada. Contacta al administrador.');
      return;
    }
    state.user = user;
    state.profile = profile || { role: 'operador', active: true };
    window.LubaydCurrentProfile = state.profile;
    document.body.classList.remove('auth-pending');
    document.body.classList.add('auth-ready');
    updateUserInterface();
    $('#partDate').value = todayKey();
    subscribeParts();
    window.dispatchEvent(new CustomEvent('lubayd-auth-ready', { detail: { user, profile: state.profile } }));
    const requested = new URLSearchParams(location.search).get('view') || 'dashboard';
    showView(requested === 'users' && !isAdmin() ? 'dashboard' : requested);
    updatePushUI(window.LubaydPush?.state?.());
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      if (registration.waiting) {
        state.waitingWorker = registration.waiting;
        $('#updateBanner').classList.remove('hidden');
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            state.waitingWorker = registration.waiting || worker;
            $('#updateBanner').classList.remove('hidden');
          }
        });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    } catch (error) {
      console.error('Service worker:', error);
    }
  }

  bindAuth();
  bindNavigation();
  bindApplicationEvents();
  setConnectionStatus();
  registerServiceWorker();
  window.addEventListener('lubayd-auth-state', event => handleAuthState(event.detail.user, event.detail.profile, event.detail.error));
  if (window.LubaydLastAuthState) {
    const detail = window.LubaydLastAuthState;
    queueMicrotask(() => handleAuthState(detail.user, detail.profile, detail.error));
  }
  window.LubaydApp = { version: VERSION, showView, renderDashboard, forceUpdate };
})();
