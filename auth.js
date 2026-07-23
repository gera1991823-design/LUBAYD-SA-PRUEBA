/* Lubayd SA V22.3.0 - selección explícita de acceso online u offline */
(function () {
  'use strict';
  const { $, $$, normalizeEmail, setBusy, emit } = window.Lubayd;
  const EMAIL_KEY = 'lubayd_last_email_v22_3';
  const LEGACY_EMAIL_KEYS = ['lubayd_last_email_v22_1'];
  const ACCESS_MODE_KEY = 'lubayd_access_mode_v22_3';
  const LAST_MODE_KEY = 'lubayd_last_login_mode_v22_3';
  let selectedMode = localStorage.getItem(LAST_MODE_KEY) === 'offline' ? 'offline' : 'online';

  function setMessage(text, success = false) {
    const element = $('#authMessage');
    if (!element) return;
    element.textContent = text || '';
    element.className = `form-message${success ? ' success' : ''}`;
  }

  function setMode(mode, persistChoice = true) {
    selectedMode = mode === 'offline' ? 'offline' : 'online';
    if (persistChoice) localStorage.setItem(LAST_MODE_KEY, selectedMode);
    $$('[data-login-mode]').forEach(button => {
      const active = button.dataset.loginMode === selectedMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updateConnection();
    refreshOfflineAvailability();
  }

  async function refreshOfflineAvailability() {
    const note = $('#offlinePreparedNote');
    const offlineButton = $('[data-login-mode="offline"]');
    if (!note || !offlineButton) return;
    const email = normalizeEmail($('#loginEmail')?.value);
    let prepared = false;
    if (email) {
      const local = await window.LubaydOffline?.findProfileByEmail?.(email).catch(() => null);
      prepared = Boolean(local?.hash && local?.salt);
    }
    offlineButton.classList.toggle('prepared', prepared);
    note.classList.toggle('ready', prepared);
    note.textContent = prepared
      ? 'Acceso offline disponible en este dispositivo.'
      : 'El acceso offline se habilita después de ingresar online una vez en este dispositivo.';
  }

  function updateConnection() {
    const online = navigator.onLine;
    const banner = $('#authConnectionBanner');
    if (banner) {
      banner.classList.toggle('online', online);
      banner.classList.toggle('offline', !online);
      const label = banner.querySelector('b');
      if (label) label.textContent = online ? 'Internet disponible' : 'Sin conexión a internet';
    }
    const status = $('#loginModeStatus');
    const help = $('#loginHelp');
    const button = $('#loginButton');
    const reset = $('#resetPasswordButton');
    if (selectedMode === 'online') {
      if (status) status.textContent = online ? 'Acceso online seleccionado.' : 'Conectate a internet para usar el acceso online.';
      if (help) help.textContent = '';
      if (button) {
        button.textContent = 'Ingresar online';
        button.disabled = !online;
      }
      if (reset) reset.classList.remove('hidden');
    } else {
      if (status) status.textContent = 'Acceso offline seleccionado.';
      if (help) help.textContent = '';
      if (button) {
        button.textContent = 'Ingresar offline';
        button.disabled = false;
      }
      if (reset) reset.classList.add('hidden');
    }
  }

  function showTab(name) {
    $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === name));
    $('#loginForm')?.classList.toggle('active', name === 'login');
    $('#registerForm')?.classList.toggle('active', name === 'register');
    setMessage('');
  }

  function waitForCloud(milliseconds = 6000) {
    if (window.LubaydCloud?.ready) return Promise.resolve(true);
    return new Promise(resolve => {
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener('lubayd-cloud-ready', onReady);
        resolve(value);
      };
      const onReady = event => finish(Boolean(event.detail?.available));
      const timer = setTimeout(() => finish(Boolean(window.LubaydCloud?.ready)), milliseconds);
      window.addEventListener('lubayd-cloud-ready', onReady, { once: true });
    });
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
    const email = normalizeEmail($('#loginEmail').value);
    const password = $('#loginPassword').value;
    if (!email || !password) return setMessage('Escribí el correo y la contraseña.');
    const busyLabel = selectedMode === 'online' ? 'Conectando' : 'Verificando';
    setBusy(button, true, busyLabel);
    setMessage('');
    localStorage.setItem(EMAIL_KEY, email);
    try {
      if (selectedMode === 'online') {
        if (!navigator.onLine) throw new Error('No hay internet. Elegí Offline o conectá el dispositivo.');
        localStorage.setItem(ACCESS_MODE_KEY, 'online');
        const cloudReady = await waitForCloud();
        if (!cloudReady || !window.LubaydCloud?.ready) throw new Error('No se pudo iniciar Firebase. Revisá la conexión y volvé a intentar.');
        await window.LubaydCloud.loginOnline(email, password);
        window.LubaydOffline.clearSession();
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
      showTab('login');
      setMode('online');
      $('#loginEmail').value = email;
      setMessage('Cuenta creada. Un administrador debe habilitarla.', true);
    } catch (error) {
      setMessage(window.LubaydCloud?.errorMessage?.(error) || error.message || String(error));
    } finally { setBusy(button, false); }
  }

  async function resetPassword() {
    const email = normalizeEmail($('#loginEmail').value);
    if (!email) return setMessage('Escribí tu correo.');
    if (!navigator.onLine) return setMessage('Se necesita internet para recuperar la contraseña.');
    try {
      await window.LubaydCloud.resetPassword(email);
      setMessage('Se envió el correo para restablecer la contraseña.', true);
    } catch (error) { setMessage(window.LubaydCloud?.errorMessage?.(error) || error.message || String(error)); }
  }

  async function logout() {
    window.LubaydOffline.clearSession();
    window.Lubayd.state.offlineSession = false;
    localStorage.removeItem(ACCESS_MODE_KEY);
    try { await window.LubaydCloud?.logout?.(); } catch (_) {}
    emit('lubayd-session-ended', {});
  }

  function init() {
    const savedEmail = localStorage.getItem(EMAIL_KEY) || LEGACY_EMAIL_KEYS.map(key => localStorage.getItem(key)).find(Boolean) || '';
    if (savedEmail) $('#loginEmail').value = savedEmail;
    $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.authTab)));
    $$('[data-login-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.loginMode)));
    $('#loginForm').addEventListener('submit', handleLogin);
    $('#registerForm').addEventListener('submit', handleRegister);
    $('#resetPasswordButton').addEventListener('click', resetPassword);
    $('#logoutButton').addEventListener('click', logout);
    $('#loginEmail').addEventListener('input', () => { clearTimeout(init.emailTimer); init.emailTimer = setTimeout(refreshOfflineAvailability, 180); });
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    window.addEventListener('lubayd-session-ready', event => { window.LubaydLastSession = event.detail; });
    setMode(selectedMode, false);
  }

  window.LubaydAuth = { offlineLogin, logout, updateConnection, setMessage, setMode, get selectedMode() { return selectedMode; } };
  init();
})();
