/* Lubayd SA V20.2 - Firebase Cloud Messaging */
(function () {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BD2QB0qlQKnf4ZGV5pyoeAPwMA4Psj9j-tgpKdtb_A1b6bclmw_kUPFSdffyGpfPTXSF630SHbHgjCmirow-Imc';
  const TOKEN_COLLECTION = 'push_tokens';
  const LOCAL_TOKEN_KEY = 'lubayd_fcm_token_v20_2';
  const LOCAL_DOC_KEY = 'lubayd_fcm_doc_v20_2';
  let messaging = null;
  let foregroundBound = false;

  function currentUser() {
    return window.firebase?.auth?.().currentUser || null;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function detectPlatform() {
    if (isIOS()) return 'iOS';
    if (/Android/i.test(navigator.userAgent || '')) return 'Android';
    if (/Windows/i.test(navigator.userAgent || '')) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(navigator.userAgent || '')) return 'macOS';
    return 'Web';
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function supported() {
    if (isIOS() && !isStandalone()) return false;
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window) || !window.firebase?.messaging) return false;
    try {
      return typeof firebase.messaging.isSupported === 'function' ? await firebase.messaging.isSupported() : true;
    } catch (_) {
      return false;
    }
  }

  function state(extra) {
    return Object.assign({
      platform: detectPlatform(),
      ios: isIOS(),
      standalone: isStandalone(),
      permission: 'Notification' in window ? Notification.permission : 'unsupported',
      enabled: Boolean(localStorage.getItem(LOCAL_TOKEN_KEY))
    }, extra || {});
  }

  function emit(extra) {
    window.dispatchEvent(new CustomEvent('lubayd-push-state', { detail: state(extra) }));
  }

  async function instance() {
    if (!(await supported())) {
      if (isIOS() && !isStandalone()) throw new Error('En iPhone debes instalar la web en la pantalla de inicio y abrirla desde el icono.');
      throw new Error('Este dispositivo o navegador no admite notificaciones push web.');
    }
    if (!messaging) messaging = firebase.messaging();
    if (!foregroundBound) {
      messaging.onMessage(payload => {
        window.dispatchEvent(new CustomEvent('lubayd-push-message', { detail: payload }));
        const title = payload?.data?.title || payload?.notification?.title || 'Nuevo mensaje';
        const body = payload?.data?.body || payload?.notification?.body || 'Tienes un mensaje nuevo.';
        window.LubaydUI?.toast?.(title, body);
      });
      foregroundBound = true;
    }
    return messaging;
  }

  async function saveToken(token) {
    const user = currentUser();
    if (!user) throw new Error('Debes iniciar sesión antes de activar las notificaciones.');
    const tokenId = await sha256(token);
    const FieldValue = firebase.firestore.FieldValue;
    const payload = {
      userId: user.uid,
      userEmail: user.email || '',
      token,
      active: true,
      platform: detectPlatform(),
      standalone: isStandalone(),
      userAgent: String(navigator.userAgent || '').slice(0, 500),
      appUrl: location.origin + location.pathname,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtClient: new Date().toISOString(),
      createdAtClient: new Date().toISOString()
    };
    // V20.2: escritura directa. No intenta leer el documento antes de crearlo.
    await firebase.firestore().collection(TOKEN_COLLECTION).doc(tokenId).set(payload, { merge: true });
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
    localStorage.setItem(LOCAL_DOC_KEY, tokenId);
    return { token, tokenId };
  }

  async function enable(options) {
    const opts = options || {};
    const user = currentUser();
    if (!user) throw new Error('Debes iniciar sesión.');
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet.');
    if (!(await supported())) {
      if (isIOS() && !isStandalone()) throw new Error('En iPhone: Safari → Compartir → Agregar a pantalla de inicio. Después abre Lubayd desde el icono.');
      throw new Error('Las notificaciones no son compatibles con este navegador.');
    }
    if (!opts.silent && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') throw new Error('No se concedió permiso para mostrar notificaciones.');
    }
    if (Notification.permission !== 'granted') throw new Error('Las notificaciones están bloqueadas en el dispositivo.');
    const registration = await navigator.serviceWorker.ready;
    const service = await instance();
    const token = await service.getToken({ vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: registration });
    if (!token) throw new Error('Firebase no devolvió un token para este dispositivo.');
    const saved = await saveToken(token);
    emit({ supported: true, enabled: true, tokenId: saved.tokenId });
    return saved;
  }

  async function refresh() {
    if (!currentUser() || !('Notification' in window) || Notification.permission !== 'granted') return null;
    try { return await enable({ silent: true }); } catch (error) { console.warn('Actualizar token push:', error); return null; }
  }

  async function disable() {
    const token = localStorage.getItem(LOCAL_TOKEN_KEY);
    const docId = localStorage.getItem(LOCAL_DOC_KEY);
    try {
      if (docId && currentUser()) await firebase.firestore().collection(TOKEN_COLLECTION).doc(docId).delete();
      if (token && messaging?.deleteToken) await messaging.deleteToken(token);
    } finally {
      localStorage.removeItem(LOCAL_TOKEN_KEY);
      localStorage.removeItem(LOCAL_DOC_KEY);
      emit({ supported: await supported(), enabled: false });
    }
  }

  window.LubaydPush = { enable, disable, refresh, supported, state, isIOS, isStandalone, publicVapidKey: VAPID_PUBLIC_KEY };

  window.addEventListener('lubayd-auth-ready', () => {
    supported().then(value => emit({ supported: value }));
    if ('Notification' in window && Notification.permission === 'granted') refresh();
  });
  window.addEventListener('online', refresh);
  window.addEventListener('load', () => supported().then(value => emit({ supported: value })));
})();
