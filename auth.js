/* Lubayd SA V22.4.0 - acceso Online y Offline siempre disponible */
(function () {
  'use strict';
  const { $, $$, normalizeEmail, setBusy, emit } = window.Lubayd;
  const EMAIL_KEY = 'lubayd_last_email_v22_4';
  const LEGACY_EMAIL_KEYS = ['lubayd_last_email_v22_3', 'lubayd_last_email_v22_1'];
  const ACCESS_MODE_KEY = 'lubayd_access_mode_v22_4';
  const LAST_MODE_KEY = 'lubayd_last_login_mode_v22_4';
  let selectedMode = localStorage.getItem(LAST_MODE_KEY) === 'offline' ? 'offline' : 'online';
  let offlineProfiles = [];

  function setMessage(text, success = false) {
    const element = $('#authMessage');
    if (!element) return;
    element.textContent = text || '';
    element.className = `form-message${success ? ' success' : ''}`;
  }
  async function loadOfflineUsers() {
    const select = $('#offlineUserSelect');
    const box = $('#offlineUserBox');
    const message = $('#offlineUserMessage');
    if (!select || !box) return [];
    offlineProfiles = await window.LubaydOffline?.listPreparedProfiles?.().catch(() => []) || [];
    select.innerHTML = '';
    if (offlineProfiles.length) {
      for (const profile of offlineProfiles) {
        const option = document.createElement('option');
        option.value = profile.email;
        option.textContent = `${profile.nombre} · ${profile.email}`;
        select.appendChild(option);
      }
      const saved = normalizeEmail($('#loginEmail')?.value || localStorage.getItem(EMAIL_KEY));
      const match = offlineProfiles.find(profile => normalizeEmail(profile.email) === saved) || offlineProfiles[0];
      select.value = match.email;
      $('#loginEmail').value = match.email;
      if (message) message.textContent = 'Ingresá con la misma contraseña usada en el acceso Online.';
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No hay usuarios offline preparados';
      select.appendChild(option);
      if (message) message.textContent = 'Conectate e ingresá Online una vez para habilitar este teléfono.';
    }
    refreshOfflineAvailability();
    return offlineProfiles;
  }
  function applyModeLayout() {
    const offline = selectedMode === 'offline';
    $('#offlineUserBox')?.classList.toggle('hidden', !offline);
    const emailLabel = $('#loginEmailLabel');
    if (emailLabel) emailLabel.classList.toggle('hidden', offline && offlineProfiles.length > 0);
    $('#resetPasswordButton')?.classList.toggle('hidden', offline);
  }
  function setMode(mode, persistChoice = true) {
    selectedMode = mode === 'offline' ? 'offline' : 'online';
    if (persistChoice) localStorage.setItem(LAST_MODE_KEY, selectedMode);
    $$('[data-login-mode]').forEach(button => {
      const active = button.dataset.loginMode === selectedMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    applyModeLayout();
    updateConnection();
    refreshOfflineAvailability();
  }
  async function refreshOfflineAvailability() {
    const note = $('#offlinePreparedNote');
    const offlineButton = $('[data-login-mode="offline"]');
    if (!note || !offlineButton) return;
    const email = normalizeEmail(selectedMode === 'offline' ? ($('#offlineUserSelect')?.value || $('#loginEmail')?.value) : $('#loginEmail')?.value);
    let prepared = offlineProfiles.some(profile => normalizeEmail(profile.email) === email);
    if (!prepared && email) {
      const local = await window.LubaydOffline?.findProfileByEmail?.(email).catch(() => null);
      prepared = Boolean(local?.hash && local?.salt);
    }
    offlineButton.classList.toggle('prepared', prepared || offlineProfiles.length > 0);
    note.classList.toggle('ready', prepared || offlineProfiles.length > 0);
    note.textContent = prepared || offlineProfiles.length > 0
      ? 'Acceso Offline listo en este dispositivo.'
      : 'Para usar Offline, ingresá Online una vez en este dispositivo.';
  }
  function updateConnection() {
    const online = navigator.onLine;
    const banner = $('#authConnectionBanner');
    if (banner) {
      banner.classList.toggle('online', online);
      banner.classList.toggle('offline', !online);
      const label = banner.querySelector('b');
      if (label) label.textContent = online ? 'Internet disponible' : 'Sin conexión · podés usar Offline';
    }
    const status = $('#loginModeStatus');
    const button = $('#loginButton');
    if (selectedMode === 'online') {
      if (status) status.textContent = online ? 'Acceso Online seleccionado.' : 'Sin internet. Elegí Offline para entrar.';
      if (button) { button.textContent = 'Ingresar Online'; button.disabled = !online; }
    } else {
      if (status) status.textContent = offlineProfiles.length ? 'Acceso Offline listo.' : 'Este teléfono todavía no tiene un usuario Offline preparado.';
      if (button) { button.textContent = 'Ingresar Offline'; button.disabled = offlineProfiles.length === 0 && !$('#loginEmail')?.value; }
    }
  }
  function showTab(name) {
    $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === name));
    $('#loginForm')?.classList.toggle('active', name === 'login');
    $('#registerForm')?.classList.toggle('active', name === 'register');
    setMessage('');
  }
  async function offlineLogin(email, password) {
    const record = await window.LubaydOffline.verifyCredential(email, password);
    const session = window.LubaydOffline.startSession(record);
    const user = { uid: record.uid, email: record.email, displayName: record.profile?.nombre || '', isOffline: true };
    const detail = { user, profile: record.profile, offline: true, mode: 'offline', source: 'offline-login', session };
    window.Lubayd.state.user = user;
    window.Lubayd.state.profile = record.profile;
    window.Lubayd.state.offlineSession = true;
    window.LubaydLastSession = detail;
    emit('lubayd-session-ready', detail);
    return detail;
  }
  async function handleLogin(event) {
    event.preventDefault();
    const button = $('#loginButton');
    const selectedEmail = selectedMode === 'offline' ? ($('#offlineUserSelect')?.value || $('#loginEmail').value) : $('#loginEmail').value;
    const email = normalizeEmail(selectedEmail);
    const password = $('#loginPassword').value;
    if (!email || !password) return setMessage('Escribí el usuario y la contraseña.');
    setBusy(button, true, selectedMode === 'online' ? 'Conectando' : 'Verificando');
    setMessage('');
    localStorage.setItem(EMAIL_KEY, email);
    try {
      if (selectedMode === 'online') {
        if (!navigator.onLine) throw new Error('No hay internet. Elegí Offline.');
        localStorage.setItem(ACCESS_MODE_KEY, 'online');
        await window.LubaydCloud.loginOnline(email, password);
        window.LubaydOffline.clearSession();
        await loadOfflineUsers();
      } else {
        localStorage.setItem(ACCESS_MODE_KEY, 'offline');
        await offlineLogin(email, password);
      }
    } catch (error) {
      if (!window.Lubayd.state.user) localStorage.removeItem(ACCESS_MODE_KEY);
      setMessage(window.LubaydCloud?.errorMessage?.(error) || error.message || String(error));
    } finally {
      setBusy(button, false);
      updateConnection();
    }
  }
  async function handleRegister(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const name = $('#registerName').value.trim();
    const email = normalizeEmail($('#registerEmail').value);
    const password = $('#registerPassword').value;
    if (password !== $('#registerConfirm').value) return setMessage('Las contraseñas no coinciden.');
    if (!navigator.onLine) return setMessage('Se necesita internet para crear una cuenta.');
    setBusy(button, true, 'Creando');
    try {
      await window.LubaydCloud.register(name, email, password);
      showTab('login'); setMode('online'); $('#loginEmail').value = email;
      setMessage('Cuenta creada. Un administrador debe habilitarla.', true);
    } catch (error) { setMessage(window.LubaydCloud?.errorMessage?.(error) || error.message || String(error)); }
    finally { setBusy(button, false); }
  }
  async function resetPassword() {
    const email = normalizeEmail($('#loginEmail').value);
    if (!email) return setMessage('Escribí tu correo.');
    if (!navigator.onLine) return setMessage('Se necesita internet para recuperar la contraseña.');
    try { await window.LubaydCloud.resetPassword(email); setMessage('Se envió el correo para restablecer la contraseña.', true); }
    catch (error) { setMessage(window.LubaydCloud?.errorMessage?.(error) || error.message || String(error)); }
  }
  async function logout() {
    window.LubaydOffline.clearSession();
    window.Lubayd.state.offlineSession = false;
    localStorage.removeItem(ACCESS_MODE_KEY);
    try { await window.LubaydCloud?.logout?.(); } catch (_) {}
    emit('lubayd-session-ended', {});
    await loadOfflineUsers();
    if (!navigator.onLine && offlineProfiles.length) setMode('offline', false);
  }
  async function init() {
    const savedEmail = localStorage.getItem(EMAIL_KEY) || LEGACY_EMAIL_KEYS.map(key => localStorage.getItem(key)).find(Boolean) || '';
    if (savedEmail) $('#loginEmail').value = savedEmail;
    $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.authTab)));
    $$('[data-login-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.loginMode)));
    $('#loginForm').addEventListener('submit', handleLogin);
    $('#registerForm').addEventListener('submit', handleRegister);
    $('#resetPasswordButton').addEventListener('click', resetPassword);
    $('#logoutButton').addEventListener('click', logout);
    $('#offlineUserSelect')?.addEventListener('change', event => { $('#loginEmail').value = event.target.value; localStorage.setItem(EMAIL_KEY, event.target.value); refreshOfflineAvailability(); });
    $('#loginEmail').addEventListener('input', () => { clearTimeout(init.emailTimer); init.emailTimer = setTimeout(refreshOfflineAvailability, 160); });
    window.addEventListener('online', () => { updateConnection(); window.LubaydCloud?.ensureReady?.().catch(() => {}); });
    window.addEventListener('offline', () => { updateConnection(); if (offlineProfiles.length) setMode('offline', false); });
    window.addEventListener('lubayd-session-ready', event => { window.LubaydLastSession = event.detail; });
    await loadOfflineUsers();
    if (!navigator.onLine && offlineProfiles.length) selectedMode = 'offline';
    setMode(selectedMode, false);
  }

  window.LubaydAuth = { offlineLogin, logout, updateConnection, setMessage, setMode, loadOfflineUsers, get selectedMode() { return selectedMode; } };
  init().catch(error => setMessage(error.message || String(error)));
})();
