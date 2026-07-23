/* Lubayd SA V22.1.0 - ingreso online/offline sin pantalla de espera */
(function () {
  'use strict';
  const { $, $$, normalizeEmail, setBusy, emit } = window.Lubayd;
  const EMAIL_KEY = 'lubayd_last_email_v22_1';

  function setMessage(text, success = false) {
    const element = $('#authMessage');
    element.textContent = text || '';
    element.className = `form-message${success ? ' success' : ''}`;
  }
  function updateConnection() {
    const online = navigator.onLine;
    const banner = $('#authConnectionBanner');
    banner.classList.toggle('online', online);
    banner.classList.toggle('offline', !online);
    banner.querySelector('b').textContent = online ? 'Conexión disponible' : 'Sin conexión: acceso local';
    $('#loginHelp').textContent = online ? 'Usá tu correo y contraseña.' : 'Ingresá con el mismo correo y contraseña usados previamente en este teléfono.';
  }
  function showTab(name) {
    $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === name));
    $('#loginForm').classList.toggle('active', name === 'login');
    $('#registerForm').classList.toggle('active', name === 'register');
    setMessage('');
  }
  function waitForCloud(milliseconds = 5000) {
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
    const detail = { user, profile: record.profile, offline: true, source: 'offline-login', session };
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
    if (!email || !password) return setMessage('Escribe el correo y la contraseña.');
    setBusy(button, true, 'Ingresando');
    setMessage('');
    localStorage.setItem(EMAIL_KEY, email);
    try {
      if (navigator.onLine) {
        await waitForCloud();
      }
      if (navigator.onLine && window.LubaydCloud?.ready) {
        try {
          await window.LubaydCloud.loginOnline(email, password);
          window.LubaydOffline.clearSession();
          return;
        } catch (error) {
          if (!window.LubaydCloud.networkError(error)) throw error;
        }
      }
      await offlineLogin(email, password);
    } catch (error) {
      setMessage(window.LubaydCloud?.errorMessage?.(error) || error.message || String(error));
    } finally {
      setBusy(button, false);
    }
  }
  async function handleRegister(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const name = $('#registerName').value.trim();
    const email = normalizeEmail($('#registerEmail').value);
    const password = $('#registerPassword').value;
    if (password !== $('#registerConfirm').value) return setMessage('Las contraseñas no coinciden.');
    if (!navigator.onLine) return setMessage('Se necesita conexión para crear una cuenta.');
    setBusy(button, true, 'Creando');
    try {
      await window.LubaydCloud.register(name, email, password);
      showTab('login');
      $('#loginEmail').value = email;
      setMessage('Cuenta creada. Un administrador debe habilitarla antes del primer ingreso.', true);
    } catch (error) {
      setMessage(window.LubaydCloud.errorMessage(error));
    } finally { setBusy(button, false); }
  }
  async function resetPassword() {
    const email = normalizeEmail($('#loginEmail').value);
    if (!email) return setMessage('Escribe tu correo para recibir el enlace.');
    try {
      await window.LubaydCloud.resetPassword(email);
      setMessage('Se envió el correo para restablecer la contraseña.', true);
    } catch (error) { setMessage(window.LubaydCloud.errorMessage(error)); }
  }
  async function logout() {
    window.LubaydOffline.clearSession();
    window.Lubayd.state.offlineSession = false;
    try { await window.LubaydCloud?.logout?.(); } catch (_) {}
    emit('lubayd-session-ended', {});
  }
  function init() {
    const savedEmail = localStorage.getItem(EMAIL_KEY) || '';
    if (savedEmail) $('#loginEmail').value = savedEmail;
    $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.authTab)));
    $('#loginForm').addEventListener('submit', handleLogin);
    $('#registerForm').addEventListener('submit', handleRegister);
    $('#resetPasswordButton').addEventListener('click', resetPassword);
    $('#logoutButton').addEventListener('click', logout);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    window.addEventListener('lubayd-session-ready', event => { window.LubaydLastSession = event.detail; });
    updateConnection();
  }
  window.LubaydAuth = { offlineLogin, logout, updateConnection, setMessage };
  init();
})();
