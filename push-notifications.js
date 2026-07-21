/* Lubayd SA V20.1 - Push corregido con registro FCM verificable */
(function () {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BD2QB0qlQKnf4ZGV5pyoeAPwMA4Psj9j-tgpKdtb_A1b6bclmw_kUPFSdffyGpfPTXSF630SHbHgjCmirow-Imc';
  const TOKEN_COLLECTION = 'push_tokens';
  const LOCAL_ENABLED_KEY = 'lubayd_notifications_enabled_v20_1';
  const LOCAL_TOKEN_KEY = 'lubayd_fcm_token_v20_1';
  const LOCAL_TOKEN_DOC_KEY = 'lubayd_fcm_token_doc_v20_1';
  const DISMISSED_KEY = 'lubayd_notifications_banner_dismissed_v20_1';
  let messaging = null;
  let initializationPromise = null;
  let foregroundUnsubscribe = null;
  let lastTokenError = '';
  const recentPushSignatures = new Map();

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];


  function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || 'La operación demoró demasiado.')), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function readablePushError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || error || 'Error desconocido');
    if (code.includes('permission-blocked') || code.includes('permission-denied')) {
      return 'El permiso está bloqueado en el teléfono. Habilítalo desde Ajustes → Notificaciones.';
    }
    if (code.includes('token-subscribe-failed')) {
      return 'Firebase no pudo registrar este dispositivo. Verifica conexión, fecha/hora y vuelve a intentar.';
    }
    if (code.includes('unsupported-browser')) {
      return 'Este navegador no admite notificaciones push. Usa Chrome/Edge o instala la app en la pantalla de inicio.';
    }
    if (code.includes('failed-service-worker-registration')) {
      return 'No se pudo iniciar el servicio de notificaciones. Actualiza la aplicación y vuelve a intentar.';
    }
    return message;
  }


  function pushSignature(chatId, text) {
    return `${String(chatId || '')}|${String(text || '').trim().slice(0, 180)}`;
  }

  function markRecentlyPushed(chatId, text) {
    const signature = pushSignature(chatId, text);
    if (signature === '|') return;
    recentPushSignatures.set(signature, Date.now());
    for (const [key, timestamp] of recentPushSignatures.entries()) {
      if (Date.now() - timestamp > 20000) recentPushSignatures.delete(key);
    }
  }

  function wasRecentlyPushed(chatId, text) {
    const timestamp = recentPushSignatures.get(pushSignature(chatId, text));
    return Boolean(timestamp && Date.now() - timestamp < 15000);
  }

  function currentUser() {
    return window.firebase?.auth?.().currentUser || null;
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
    return 'Web';
  }

  function isInstalledPwa() {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
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

  function localSupported() {
    return Boolean(window.isSecureContext && 'serviceWorker' in navigator && 'Notification' in window);
  }

  function state(extra) {
    const permission = 'Notification' in window ? Notification.permission : 'unsupported';
    const locallyEnabled = permission === 'granted' && localStorage.getItem(LOCAL_ENABLED_KEY) === '1';
    const tokenRegistered = Boolean(localStorage.getItem(LOCAL_TOKEN_KEY));
    return Object.assign({
      supported: localSupported(),
      permission,
      enabled: locallyEnabled,
      locallyEnabled,
      tokenRegistered,
      pushReady: tokenRegistered,
      platform: detectPlatform(),
      installedPwa: isInstalledPwa(),
      tokenError: lastTokenError
    }, extra || {});
  }

  function emitState(extra) {
    const detail = state(extra);
    window.dispatchEvent(new CustomEvent('lubayd-push-state', { detail }));
    updateNotificationUi(detail);
    return detail;
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function initializeMessaging() {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
      if (!(await isMessagingSupported())) return null;
      messaging = window.firebase.messaging();
      if (!foregroundUnsubscribe && typeof messaging.onMessage === 'function') {
        foregroundUnsubscribe = messaging.onMessage(payload => {
          const data = payload?.data || {};
          markRecentlyPushed(data.chatId, data.body || data.text);
          window.dispatchEvent(new CustomEvent('lubayd-push-message', { detail: payload }));
        });
      }
      return messaging;
    })();
    return initializationPromise;
  }

  async function getRegistration() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Este navegador no admite el servicio de notificaciones.');
    }

    let registration = await navigator.serviceWorker.getRegistration('./').catch(() => null);
    if (!registration) {
      registration = await navigator.serviceWorker.register('./service-worker.js?v=20.8.9', {
        scope: './',
        updateViaCache: 'none'
      });
    }

    try {
      await registration.update();
    } catch (_) {
      // La actualización puede fallar temporalmente sin impedir usar el registro existente.
    }

    const ready = await navigator.serviceWorker.ready;
    if (!ready) {
      throw new Error('El servicio de notificaciones todavía no está disponible. Cierra y vuelve a abrir la aplicación.');
    }
    return ready;
  }

  async function saveToken(token) {
    const user = currentUser();
    if (!user) throw new Error('Debes iniciar sesión antes de registrar el celular.');
    const tokenId = await sha256(token);
    const db = window.firebase.firestore();
    const FieldValue = window.firebase.firestore.FieldValue;
    const payload = {
      userId: user.uid,
      userEmail: user.email || '',
      token,
      active: true,
      platform: detectPlatform(),
      installedPwa: isInstalledPwa(),
      userAgent: String(navigator.userAgent || '').slice(0, 500),
      language: navigator.language || 'es',
      appUrl: location.origin + location.pathname,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtClient: new Date().toISOString()
    };
    const ref = db.collection(TOKEN_COLLECTION).doc(tokenId);

    // No hacemos una lectura previa. Las reglas de seguridad no pueden autorizar
    // la lectura de un documento que todavía no existe, y esa lectura impedía
    // crear la colección push_tokens en el primer registro del celular.
    await ref.set(payload, { merge: true });
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
    localStorage.setItem(LOCAL_TOKEN_DOC_KEY, tokenId);
    return { token, tokenId };
  }

  async function registerFcmToken() {
    if (!navigator.onLine) throw new Error('El celular no tiene conexión a internet.');
    if (!currentUser()) throw new Error('Debes iniciar sesión antes de registrar el celular.');
    const instance = await initializeMessaging();
    if (!instance) throw new Error('Firebase Cloud Messaging no es compatible con este navegador o modo de apertura.');
    const registration = await withTimeout(
      getRegistration(),
      20000,
      'El servicio de notificaciones no respondió. Cierra y vuelve a abrir la aplicación.'
    );
    const token = await withTimeout(
      instance.getToken({
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: registration
      }),
      30000,
      'Firebase demoró demasiado en registrar el celular. Revisa la conexión y vuelve a intentar.'
    );
    if (!token) throw new Error('Firebase no devolvió un identificador para este dispositivo.');
    const saved = await withTimeout(
      saveToken(token),
      20000,
      'El token se generó, pero no pudo guardarse en Firestore. Publica las reglas V20.8.9.'
    );
    return { tokenRegistered: true, tokenId: saved.tokenId };
  }

  async function showLocalNotification(title, options) {
    if (!localSupported() || Notification.permission !== 'granted') return false;
    const registration = await getRegistration();
    const payload = Object.assign({
      body: 'Las notificaciones quedaron activadas.',
      icon: './assets/icon-192.png',
      badge: './assets/icon-192.png',
      tag: 'lubayd-notification',
      renotify: true,
      silent: false,
      vibrate: [180, 80, 180],
      data: { url: './?view=chat' }
    }, options || {});
    await registration.showNotification(title || 'Lubayd SA', payload);
    return true;
  }

  async function enable(options) {
    const opts = options || {};
    if (!currentUser()) throw new Error('Debes iniciar sesión primero.');
    if (!localSupported()) throw new Error('Este navegador no admite notificaciones del sistema.');

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      localStorage.removeItem(LOCAL_ENABLED_KEY);
      emitState({ error: 'permission-denied' });
      throw new Error('El permiso de notificaciones está bloqueado. Debes habilitarlo desde la configuración del teléfono.');
    }

    localStorage.setItem(LOCAL_ENABLED_KEY, '1');
    localStorage.removeItem(DISMISSED_KEY);

    let tokenResult = { tokenRegistered: false };
    let tokenError = '';
    try {
      tokenResult = await registerFcmToken();
      lastTokenError = '';
    } catch (error) {
      tokenError = error?.message || String(error);
      lastTokenError = tokenError;
      console.warn('FCM no quedó registrado, se mantienen avisos locales:', error);
    }

    const detail = emitState({
      enabled: true,
      locallyEnabled: true,
      tokenRegistered: Boolean(tokenResult.tokenRegistered),
      tokenId: tokenResult.tokenId || '',
      tokenError
    });

    if (opts.test !== false) {
      await showLocalNotification('Notificaciones activadas', {
        body: tokenResult.tokenRegistered
          ? 'Este dispositivo quedó registrado. Recibirás avisos de nuevos mensajes.'
          : 'Recibirás avisos mientras la aplicación permanezca abierta o minimizada.',
        tag: 'lubayd-notifications-enabled',
        data: { url: './?view=chat' }
      }).catch(() => {});
    }
    return detail;
  }

  async function refresh() {
    if (!currentUser() || Notification.permission !== 'granted') return null;
    localStorage.setItem(LOCAL_ENABLED_KEY, '1');
    try {
      const tokenResult = await registerFcmToken();
      lastTokenError = '';
      return emitState(tokenResult);
    } catch (error) {
      lastTokenError = error?.message || String(error);
      console.warn('Actualización del registro push:', error);
      return emitState({ enabled: true, locallyEnabled: true, tokenError: lastTokenError });
    }
  }

  async function disable() {
    const token = localStorage.getItem(LOCAL_TOKEN_KEY);
    const tokenId = localStorage.getItem(LOCAL_TOKEN_DOC_KEY);
    const user = currentUser();
    try {
      if (tokenId && user && window.firebase?.firestore) {
        await window.firebase.firestore().collection(TOKEN_COLLECTION).doc(tokenId).delete().catch(() => {});
      }
      if (token && messaging && typeof messaging.deleteToken === 'function') {
        await messaging.deleteToken(token).catch(() => {});
      }
    } finally {
      localStorage.removeItem(LOCAL_ENABLED_KEY);
      localStorage.removeItem(LOCAL_TOKEN_KEY);
      localStorage.removeItem(LOCAL_TOKEN_DOC_KEY);
      lastTokenError = '';
      emitState({ enabled: false, locallyEnabled: false, tokenRegistered: false });
    }
  }

  function isEnabled() {
    return state().locallyEnabled;
  }

  function statusCopy(detail) {
    if (!detail.supported) return {
      title: 'Notificaciones no compatibles',
      text: 'Abre la aplicación con Chrome, Edge o desde el icono instalado.',
      tone: 'error'
    };
    if (detail.permission === 'denied') return {
      title: 'Notificaciones bloqueadas',
      text: 'Habilítalas en Ajustes del teléfono → Notificaciones → Lubayd o Chrome.',
      tone: 'error'
    };
    if (detail.locallyEnabled && detail.tokenRegistered) return {
      title: 'Notificaciones activas',
      text: 'El celular está registrado para avisos de mensajes.',
      tone: 'success'
    };
    if (detail.locallyEnabled && detail.tokenError) return {
      title: 'Registro push incompleto',
      text: readablePushError({ message: detail.tokenError }),
      tone: 'error'
    };
    if (detail.locallyEnabled) return {
      title: 'Avisos al minimizar activados',
      text: 'Funcionan mientras la aplicación siga abierta o minimizada.',
      tone: 'warning'
    };
    return {
      title: 'Activa las notificaciones',
      text: 'Recibe el nombre del remitente, vista previa, sonido y vibración.',
      tone: 'default'
    };
  }

  function updateNotificationUi(detail) {
    const info = detail || state();
    const copy = statusCopy(info);
    const banner = $('#notificationActivationBanner');
    const title = $('#notificationBannerTitle');
    const text = $('#notificationBannerText');
    const status = $('#notificationStatusPill');
    const setup = $('#chatNotificationSetup');
    const settingsState = $('#notificationSettingsState');
    const setupTitle = $('#chatNotificationSetupTitle');
    const setupText = $('#chatNotificationSetupText');

    if (title) title.textContent = copy.title;
    if (text) text.textContent = copy.text;
    if (setupTitle) setupTitle.textContent = copy.title;
    if (setupText) setupText.textContent = copy.text;
    if (settingsState) {
      settingsState.textContent = info.locallyEnabled ? (info.tokenRegistered ? 'Activas' : (info.tokenError ? 'Error' : 'Minimizada')) : (info.permission === 'denied' ? 'Bloqueadas' : 'Pendiente');
      settingsState.dataset.tone = copy.tone;
    }
    if (status) {
      status.textContent = info.locallyEnabled ? (info.tokenRegistered ? 'ACTIVAS' : (info.tokenError ? 'ERROR' : 'MINIMIZADA')) : 'PENDIENTE';
      status.dataset.tone = copy.tone;
    }
    [banner, setup].forEach(element => {
      if (!element) return;
      element.dataset.tone = copy.tone;
    });

    const loggedIn = Boolean(currentUser());
    const dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    banner?.classList.toggle('hidden', !loggedIn || info.locallyEnabled || dismissed);
    setup?.classList.toggle('is-enabled', info.locallyEnabled);

    $$('[data-enable-notifications]').forEach(button => {
      button.disabled = !info.supported || info.permission === 'denied';
      const label = button.querySelector('[data-notification-label]');
      const value = info.locallyEnabled
        ? (info.tokenRegistered ? 'Notificaciones activas' : 'Avisos activos')
        : (info.permission === 'denied' ? 'Avisos bloqueados' : 'Activar notificaciones');
      if (label) label.textContent = value;
      else if (button.dataset.compact !== 'true') button.textContent = value;
      button.dataset.enabled = info.locallyEnabled ? 'true' : 'false';
    });

    $$('[data-test-notification]').forEach(button => {
      button.classList.toggle('hidden', !info.locallyEnabled);
    });
  }

  async function handleEnableClick(event) {
    const button = event.currentTarget;
    const originalDisabled = button.disabled;
    button.disabled = true;
    button.classList.add('is-loading');
    try {
      const result = await enable();
      window.LubaydToast?.(
        result.tokenRegistered ? 'Notificaciones activadas' : 'Avisos activados',
        result.tokenRegistered
          ? 'El celular quedó registrado correctamente.'
          : 'Funcionarán mientras la aplicación esté abierta o minimizada.'
      );
    } catch (error) {
      const message = readablePushError(error);
      console.error('Error al activar notificaciones:', error);
      window.LubaydToast?.('No se pudo activar', message);
    } finally {
      button.classList.remove('is-loading');
      button.disabled = originalDisabled;
      updateNotificationUi(state());
    }
  }

  async function handleTestClick(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await showLocalNotification('Mensaje de prueba · Lubayd SA', {
        body: 'Las notificaciones del celular funcionan correctamente.',
        tag: `lubayd-test-${Date.now()}`,
        data: { url: './?view=chat' }
      });
      window.LubaydToast?.('Prueba enviada', 'Revisa la notificación del sistema.');
    } catch (error) {
      window.LubaydToast?.('No se pudo mostrar', error?.message || String(error));
    } finally {
      button.disabled = false;
    }
  }

  function bindUi() {
    $$('[data-enable-notifications]').forEach(button => button.addEventListener('click', handleEnableClick));
    $$('[data-test-notification]').forEach(button => button.addEventListener('click', handleTestClick));
    $('#notificationBannerDismiss')?.addEventListener('click', () => {
      localStorage.setItem(DISMISSED_KEY, '1');
      $('#notificationActivationBanner')?.classList.add('hidden');
    });
    updateNotificationUi(state());
  }

  async function diagnostics() {
    const current = state();
    const registration = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration().catch(() => null)
      : null;
    return {
      ...current,
      secureContext: window.isSecureContext,
      online: navigator.onLine,
      userAuthenticated: Boolean(currentUser()),
      serviceWorkerRegistered: Boolean(registration),
      serviceWorkerScope: registration?.scope || '',
      firebaseMessagingLoaded: Boolean(window.firebase?.messaging),
      tokenDocumentId: localStorage.getItem(LOCAL_TOKEN_DOC_KEY) || ''
    };
  }

  window.LubaydPush = {
    enable,
    disable,
    refresh,
    state,
    isEnabled,
    showLocalNotification,
    wasRecentlyPushed,
    publicVapidKey: VAPID_PUBLIC_KEY,
    diagnostics
  };

  window.addEventListener('lubayd-profile-ready', () => {
    updateNotificationUi(state());
    if ('Notification' in window && Notification.permission === 'granted') refresh();
  });
  window.addEventListener('online', () => {
    if ('Notification' in window && Notification.permission === 'granted' && currentUser()) refresh();
  });
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'LUBAYD_PUSH_RECEIVED') {
      markRecentlyPushed(event.data.chatId, event.data.text);
    }
  });
  window.addEventListener('focus', () => updateNotificationUi(state()));
  window.addEventListener('load', () => {
    bindUi();
    emitState();
  });
})();
