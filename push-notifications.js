/* Lubayd SA V22.0.0 - notificaciones push */
(function () {
  'use strict';
  const { config, toast } = window.Lubayd;
  let foregroundBound = false;
  function supported() { return 'Notification' in window && 'serviceWorker' in navigator && Boolean(window.LubaydCloud?.messaging); }
  async function enable() {
    if (!navigator.onLine || window.Lubayd.state.offlineSession) throw new Error('Se necesita una sesión online.');
    if (!supported()) throw new Error('Este navegador no admite notificaciones push en este modo.');
    const user = window.LubaydCloud.currentUser();
    if (!user) throw new Error('Debes iniciar sesión online.');
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('El permiso de notificaciones está bloqueado.');
    const registration = window.Lubayd.state.serviceWorkerRegistration || await navigator.serviceWorker.ready;
    const token = await window.LubaydCloud.messaging.getToken({ vapidKey: config.vapidPublicKey, serviceWorkerRegistration: registration });
    if (!token) throw new Error('Firebase no devolvió un token para este dispositivo.');
    const tokenId = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(buffer => Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join(''));
    await window.LubaydCloud.collection('push_tokens').doc(tokenId).set({
      uid: user.uid,
      token,
      userAgent: navigator.userAgent.slice(0, 400),
      appVersion: config.version,
      active: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtClient: new Date().toISOString()
    }, { merge: true });
    bindForeground();
    localStorage.setItem('lubayd_push_enabled_v22_0', '1');
    return token;
  }
  function bindForeground() {
    if (foregroundBound || !window.LubaydCloud?.messaging) return;
    foregroundBound = true;
    window.LubaydCloud.messaging.onMessage(payload => {
      const data = payload?.data || payload?.notification || {};
      toast(data.title || 'Nuevo mensaje', data.body || data.text || 'Tienes una notificación nueva.');
    });
  }
  function init() {
    document.querySelector('#enableNotificationsButton')?.addEventListener('click', async () => {
      const message = document.querySelector('#settingsMessage');
      try {
        await enable();
        message.textContent = 'Notificaciones activadas correctamente.';
        message.className = 'form-message success';
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'form-message';
      }
    });
    window.addEventListener('lubayd-session-ready', event => { if (!event.detail.offline && localStorage.getItem('lubayd_push_enabled_v22_0') === '1') bindForeground(); });
  }
  window.LubaydPush = { enable, supported };
  init();
})();
