/* Lubayd SA V18 - Firebase Cloud Messaging para notificaciones push */
(function () {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BD2QB0qlQKnf4ZGV5pyoeAPwMA4Psj9j-tgpKdtb_A1b6bclmw_kUPFSdffyGpfPTXSF630SHbHgjCmirow-Imc';
  const TOKEN_COLLECTION = 'push_tokens';
  const LOCAL_TOKEN_KEY = 'lubayd_fcm_token_v18';
  const LOCAL_TOKEN_DOC_KEY = 'lubayd_fcm_token_doc_v18';
  let messaging = null;
  let initializationPromise = null;
  let foregroundUnsubscribe = null;

  function currentUser() {
    return window.firebase?.auth?.().currentUser || null;
  }

  function state(extra) {
    const supported = Boolean(
      window.isSecureContext &&
      'serviceWorker' in navigator &&
      'Notification' in window &&
      window.firebase?.messaging
    );
    return Object.assign({
      supported,
      permission: 'Notification' in window ? Notification.permission : 'unsupported',
      enabled: Boolean(localStorage.getItem(LOCAL_TOKEN_KEY)),
      platform: detectPlatform()
    }, extra || {});
  }

  function emitState(extra) {
    window.dispatchEvent(new CustomEvent('lubayd-push-state', { detail: state(extra) }));
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
    return 'Web';
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function isMessagingSupported() {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) return false;
    if (!window.firebase?.messaging) return false;
    try {
      if (typeof window.firebase.messaging.isSupported === 'function') {
        return await window.firebase.messaging.isSupported();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function initializeMessaging() {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
      if (!(await isMessagingSupported())) throw new Error('Este dispositivo o navegador no admite notificaciones push web.');
      messaging = window.firebase.messaging();
      if (!foregroundUnsubscribe && typeof messaging.onMessage === 'function') {
        foregroundUnsubscribe = messaging.onMessage(payload => {
          window.dispatchEvent(new CustomEvent('lubayd-push-message', { detail: payload }));
        });
      }
      return messaging;
    })();
    return initializationPromise;
  }

  async function saveToken(token) {
    const user = currentUser();
    if (!user) throw new Error('Debes iniciar sesión antes de activar las notificaciones.');
    const tokenId = await sha256(token);
    const db = window.firebase.firestore();
    const FieldValue = window.firebase.firestore.FieldValue;
    const payload = {
      userId: user.uid,
      userEmail: user.email || '',
      token,
      active: true,
      platform: detectPlatform(),
      userAgent: String(navigator.userAgent || '').slice(0, 500),
      language: navigator.language || 'es',
      appUrl: location.origin + location.pathname,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtClient: new Date().toISOString()
    };
    const ref = db.collection(TOKEN_COLLECTION).doc(tokenId);
    const snapshot = await ref.get();
    if (!snapshot.exists) payload.createdAt = FieldValue.serverTimestamp();
    await ref.set(payload, { merge: true });
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
    localStorage.setItem(LOCAL_TOKEN_DOC_KEY, tokenId);
    return { token, tokenId };
  }

  async function getRegistration() {
    const registration = await navigator.serviceWorker.ready;
    if (!registration) throw new Error('El service worker todavía no está disponible. Recarga la aplicación e inténtalo nuevamente.');
    return registration;
  }

  async function ensureToken(options) {
    const opts = options || {};
    if (!currentUser()) throw new Error('Debes iniciar sesión.');
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para registrar este dispositivo.');
    if (!opts.silent && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('No se concedió permiso para mostrar notificaciones.');
    }
    if (Notification.permission !== 'granted') throw new Error('Las notificaciones están bloqueadas en este dispositivo.');

    const instance = await initializeMessaging();
    const registration = await getRegistration();
    const token = await instance.getToken({
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration
    });
    if (!token) throw new Error('Firebase no devolvió un identificador para este dispositivo.');
    const saved = await saveToken(token);
    emitState({ enabled: true, tokenId: saved.tokenId });
    return saved;
  }

  async function enable() {
    try {
      const result = await ensureToken({ silent: false });
      return Object.assign({ ok: true }, result);
    } catch (error) {
      emitState({ enabled: false, error: error.message || String(error) });
      throw error;
    }
  }

  async function refresh() {
    if (Notification.permission !== 'granted' || !currentUser()) return null;
    try {
      return await ensureToken({ silent: true });
    } catch (error) {
      console.warn('Actualización del token push:', error);
      return null;
    }
  }

  async function disable(options) {
    const opts = options || {};
    const token = localStorage.getItem(LOCAL_TOKEN_KEY);
    const tokenId = localStorage.getItem(LOCAL_TOKEN_DOC_KEY);
    const user = currentUser();
    try {
      if (tokenId && user) {
        await window.firebase.firestore().collection(TOKEN_COLLECTION).doc(tokenId).delete();
      }
      if (token && messaging && typeof messaging.deleteToken === 'function') {
        await messaging.deleteToken(token);
      }
    } finally {
      localStorage.removeItem(LOCAL_TOKEN_KEY);
      localStorage.removeItem(LOCAL_TOKEN_DOC_KEY);
      emitState({ enabled: false, permission: opts.keepPermission ? Notification.permission : Notification.permission });
    }
  }

  function isEnabled() {
    return Notification.permission === 'granted' && Boolean(localStorage.getItem(LOCAL_TOKEN_KEY));
  }

  window.LubaydPush = {
    enable,
    disable,
    refresh,
    state,
    isEnabled,
    publicVapidKey: VAPID_PUBLIC_KEY
  };

  window.addEventListener('lubayd-profile-ready', () => {
    if (Notification.permission === 'granted') refresh();
    else emitState();
  });
  window.addEventListener('online', () => {
    if (Notification.permission === 'granted' && currentUser()) refresh();
  });
  window.addEventListener('load', () => emitState());
})();
