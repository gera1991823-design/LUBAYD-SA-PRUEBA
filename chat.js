'use strict';

(function () {
  const chatState = {
    user: null,
    profile: null,
    users: [],
    conversations: [],
    activePeer: null,
    activeConversation: null,
    usersUnsubscribe: null,
    conversationsUnsubscribe: null,
    messagesUnsubscribe: null,
    initializedForUid: null,
    openingPeerUid: null,
    directoryFilter: 'all',
    notificationsPrimed: false,
    notifiedSignatures: new Set(),
    audioContext: null,
    audioUnlocked: false,
    originalTitle: document.title
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escapeHtml = window.escapeHtml || (value => String(value || '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character])));

  function isAdmin() {
    return chatState.profile?.role === 'admin';
  }

  function initials(value) {
    const parts = String(value || 'Usuario').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : String(value || 'US').slice(0, 2)).toUpperCase();
  }

  function cleanTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay) return date.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' });
  }

  function messageTime(value) {
    const date = new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
  }

  function dayKey(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function dayLabel(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Hoy';
    if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
    return date.toLocaleDateString('es-UY', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function cleanup() {
    chatState.usersUnsubscribe?.();
    chatState.conversationsUnsubscribe?.();
    chatState.messagesUnsubscribe?.();
    chatState.usersUnsubscribe = null;
    chatState.conversationsUnsubscribe = null;
    chatState.messagesUnsubscribe = null;
    chatState.users = [];
    chatState.conversations = [];
    chatState.activePeer = null;
    chatState.activeConversation = null;
    chatState.initializedForUid = null;
    chatState.openingPeerUid = null;
    chatState.notificationsPrimed = false;
    chatState.notifiedSignatures.clear();
    setUnreadBadge(0);
    closeThread();
  }

  function initialize(user, profile) {
    if (!user || !profile || !window.LubaydChat?.available) return;
    if (chatState.initializedForUid === user.uid) {
      chatState.user = user;
      chatState.profile = profile;
      renderDirectory();
      updateNotificationButton();
      return;
    }

    cleanup();
    chatState.user = user;
    chatState.profile = profile;
    chatState.initializedForUid = user.uid;

    const intro = $('#chatIntroText');
    const directoryTitle = $('#chatDirectoryTitle');
    if (intro) intro.textContent = isAdmin()
      ? 'Envía mensajes privados a cada usuario registrado.'
      : 'Comunícate directamente con la administración.';
    if (directoryTitle) directoryTitle.textContent = isAdmin() ? 'Usuarios' : 'Administración';
    updateNotificationButton();

    try {
      chatState.usersUnsubscribe = window.LubaydChat.subscribeUsers(profile, users => {
        chatState.users = users;
        renderDirectory();
        autoOpenForOperator();
      }, error => {
        console.error('Usuarios del chat:', error);
        showDirectoryNotice('No se pudo cargar la lista de usuarios. Revisa las reglas de Firestore publicadas.');
      });

      chatState.conversationsUnsubscribe = window.LubaydChat.subscribeConversations(conversations => {
        const previousById = new Map(chatState.conversations.map(item => [item.id, item]));
        chatState.conversations = conversations;
        if (chatState.notificationsPrimed) notifyConversationChanges(previousById, conversations);
        else chatState.notificationsPrimed = true;
        updateUnreadFromConversations();
        renderDirectory();
        if (chatState.activeConversation) {
          const updated = conversations.find(item => item.id === chatState.activeConversation.id);
          if (updated) chatState.activeConversation = updated;
        }
      }, error => {
        console.error('Conversaciones:', error);
        showDirectoryNotice('No se pudieron sincronizar las conversaciones. Revisa las reglas de Firestore.');
      });
    } catch (error) {
      console.error('Inicio del chat:', error);
      showDirectoryNotice(error.message || 'No se pudo iniciar el chat.');
    }
  }

  function showDirectoryNotice(text = '') {
    const notice = $('#chatDirectoryNotice');
    if (!notice) return;
    notice.textContent = text;
    notice.classList.toggle('hidden', !text);
  }

  function conversationForPeer(peer) {
    return chatState.conversations.find(conversation => Array.isArray(conversation.participants) && conversation.participants.includes(peer.uid));
  }

  function unreadForConversation(conversation) {
    if (!conversation) return 0;
    return Number(isAdmin() ? conversation.unreadByAdmin : conversation.unreadByOperator) || 0;
  }

  function updateUnreadFromConversations() {
    const total = chatState.conversations.reduce((sum, conversation) => sum + unreadForConversation(conversation), 0);
    setUnreadBadge(total);
    const filterCount = $('#chatUnreadFilterCount');
    if (filterCount) filterCount.textContent = total > 99 ? '99+' : String(total);
  }

  function setUnreadBadge(total) {
    $$('.chat-unread-badge').forEach(badge => {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.classList.toggle('hidden', total <= 0);
      badge.closest('[data-view="chat"], [data-view-link="chat"]')?.classList.toggle('has-chat-unread', total > 0);
    });
    const totalBadge = $('#chatTotalUnread');
    if (totalBadge) {
      totalBadge.textContent = total > 99 ? '99+' : String(total);
      totalBadge.classList.toggle('hidden', total <= 0);
      totalBadge.parentElement?.classList.toggle('has-unread', total > 0);
    }
    document.title = total > 0 ? `(${total > 99 ? '99+' : total}) ${chatState.originalTitle}` : chatState.originalTitle;
  }

  function filteredUsers() {
    const query = String($('#chatSearch')?.value || '').trim().toLowerCase();
    return chatState.users.filter(user => {
      if (!isAdmin() && user.role !== 'admin') return false;
      const conversation = conversationForPeer(user);
      if (chatState.directoryFilter === 'unread' && unreadForConversation(conversation) <= 0) return false;
      if (!query) return true;
      return [user.nombre, user.email, conversation?.lastMessage]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  }

  function renderDirectory() {
    const root = $('#chatConversationList');
    if (!root || !chatState.profile) return;
    const users = filteredUsers();

    if (!users.length) {
      const noUnread = chatState.directoryFilter === 'unread';
      const message = noUnread
        ? 'No tienes conversaciones con mensajes sin leer.'
        : isAdmin()
          ? 'Todavía no hay otros usuarios activos para iniciar una conversación.'
          : 'No existe una cuenta con rol “admin”. Cambia el campo role del usuario principal a “admin” en Firestore.';
      root.innerHTML = `<div class="chat-list-empty">${escapeHtml(message)}</div>`;
      showDirectoryNotice(!noUnread && !isAdmin() ? 'Para habilitar el chat, la cuenta principal debe tener role: admin en la colección usuarios.' : '');
      return;
    }

    showDirectoryNotice('');
    const items = users.map(peer => {
      const conversation = conversationForPeer(peer);
      const unread = unreadForConversation(conversation);
      const lastMessage = conversation?.lastMessage || (peer.role === 'admin' ? 'Administración Lubayd' : 'Iniciar conversación');
      const active = chatState.activePeer?.uid === peer.uid;
      const time = cleanTime(conversation?.lastMessageAtClient || conversation?.createdAtClient);
      return `
        <button type="button" class="chat-conversation ${active ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}" data-chat-peer="${escapeHtml(peer.uid)}">
          <span class="chat-avatar-wrap"><span class="chat-user-avatar">${escapeHtml(initials(peer.nombre || peer.email))}</span><i aria-hidden="true"></i></span>
          <span class="chat-conversation-copy"><strong>${escapeHtml(peer.nombre || peer.email || 'Usuario')}</strong><span>${escapeHtml(lastMessage)}</span></span>
          <span class="chat-conversation-meta">${time ? `<time>${escapeHtml(time)}</time>` : ''}${unread > 0 ? `<b class="chat-conversation-unread">${unread > 99 ? '99+' : unread}</b>` : ''}</span>
        </button>`;
    });
    root.innerHTML = items.join('');
    root.querySelectorAll('[data-chat-peer]').forEach(button => {
      button.addEventListener('click', () => {
        const peer = chatState.users.find(user => user.uid === button.dataset.chatPeer);
        if (peer) openPeer(peer);
      });
    });
  }

  async function autoOpenForOperator() {
    if (isAdmin() || chatState.activePeer || chatState.openingPeerUid) return;
    const admin = chatState.users.find(user => user.role === 'admin');
    if (admin) await openPeer(admin);
  }

  async function openPeer(peer) {
    if (!peer || chatState.openingPeerUid === peer.uid) return;
    chatState.openingPeerUid = peer.uid;
    try {
      const conversation = await window.LubaydChat.ensureConversation(peer, chatState.profile);
      chatState.activePeer = peer;
      chatState.activeConversation = conversation;
      renderDirectory();
      renderThreadHeader();
      $('#chatEmptyState')?.classList.add('hidden');
      $('#chatThreadContent')?.classList.remove('hidden');
      $('#chatLayout')?.classList.add('thread-open');
      subscribeMessages(conversation.id);
      await window.LubaydChat.markRead(conversation.id).catch(() => {});
      $('#chatMessageInput')?.focus({ preventScroll: true });
    } catch (error) {
      console.error('Abrir conversación:', error);
      showDirectoryNotice(error.message || 'No se pudo abrir la conversación.');
    } finally {
      chatState.openingPeerUid = null;
    }
  }

  function renderThreadHeader() {
    const peer = chatState.activePeer;
    if (!peer) return;
    $('#chatPeerAvatar').textContent = initials(peer.nombre || peer.email);
    $('#chatPeerName').textContent = peer.nombre || peer.email || 'Usuario';
    $('#chatPeerEmail').textContent = peer.email || (peer.role === 'admin' ? 'Administrador' : 'Operador');
  }

  function subscribeMessages(chatId) {
    chatState.messagesUnsubscribe?.();
    chatState.messagesUnsubscribe = null;
    const messageRoot = $('#chatMessages');
    if (messageRoot) messageRoot.innerHTML = '<div class="chat-loading">Cargando mensajes…</div>';
    chatState.messagesUnsubscribe = window.LubaydChat.subscribeMessages(chatId, messages => {
      renderMessages(messages);
      window.LubaydChat.markRead(chatId).catch(() => {});
    }, error => {
      console.error('Mensajes:', error);
      if (messageRoot) messageRoot.innerHTML = '<div class="chat-list-empty">No se pudieron cargar los mensajes.</div>';
    });
  }

  function renderMessages(messages) {
    const root = $('#chatMessages');
    if (!root) return;
    if (!messages.length) {
      root.innerHTML = '<div class="chat-list-empty">No hay mensajes todavía.<br>Escribe el primero para iniciar la conversación.</div>';
      return;
    }

    let previousDay = '';
    root.innerHTML = messages.map(message => {
      const currentDay = dayKey(message.createdAtClient || message.createdAt);
      const separator = currentDay !== previousDay
        ? `<div class="chat-day-separator"><span>${escapeHtml(dayLabel(message.createdAtClient || message.createdAt))}</span></div>`
        : '';
      previousDay = currentDay;
      const own = message.senderId === chatState.user?.uid;
      const status = own ? '<svg aria-label="Enviado"><use href="#i-check-double"></use></svg>' : '';
      return `${separator}<div class="chat-message-row ${own ? 'own' : 'received'}"><div class="chat-message-bubble"><p>${escapeHtml(message.text)}</p><span class="chat-message-meta"><time>${escapeHtml(messageTime(message.createdAtClient || message.createdAt))}</time>${status}</span></div></div>`;
    }).join('');
    requestAnimationFrame(() => { root.scrollTop = root.scrollHeight; });
  }

  function closeThread() {
    chatState.messagesUnsubscribe?.();
    chatState.messagesUnsubscribe = null;
    chatState.activePeer = null;
    chatState.activeConversation = null;
    $('#chatLayout')?.classList.remove('thread-open');
    $('#chatThreadContent')?.classList.add('hidden');
    $('#chatEmptyState')?.classList.remove('hidden');
    renderDirectory();
  }

  function show() {
    if (!chatState.user && window.LubaydCurrentUser && window.LubaydCurrentProfile) {
      initialize(window.LubaydCurrentUser, window.LubaydCurrentProfile);
    }
    renderDirectory();
    autoOpenForOperator();
  }

  function senderName(conversation) {
    if (conversation.lastSenderId === conversation.adminUid) return conversation.adminName || conversation.adminEmail || 'Administración';
    return conversation.operatorName || conversation.operatorEmail || 'Operador';
  }

  function peerFromConversation(conversation) {
    const peerUid = (conversation.participants || []).find(uid => uid !== chatState.user?.uid);
    if (!peerUid) return null;
    const existing = chatState.users.find(user => user.uid === peerUid);
    if (existing) return existing;
    const isPeerAdmin = conversation.adminUid === peerUid;
    return {
      uid: peerUid,
      nombre: isPeerAdmin ? conversation.adminName : conversation.operatorName,
      email: isPeerAdmin ? conversation.adminEmail : conversation.operatorEmail,
      role: isPeerAdmin ? 'admin' : 'operador',
      active: true
    };
  }

  function notifyConversationChanges(previousById, conversations) {
    conversations.forEach(conversation => {
      const previous = previousById.get(conversation.id);
      const previousUnread = unreadForConversation(previous);
      const currentUnread = unreadForConversation(conversation);
      if (currentUnread <= previousUnread || conversation.lastSenderId === chatState.user?.uid) return;
      const signature = `${conversation.id}|${conversation.lastMessageAtClient || ''}|${conversation.lastMessage || ''}`;
      if (chatState.notifiedSignatures.has(signature)) return;
      chatState.notifiedSignatures.add(signature);
      if (chatState.notifiedSignatures.size > 80) {
        chatState.notifiedSignatures = new Set([...chatState.notifiedSignatures].slice(-50));
      }
      const currentChatVisible = !document.hidden
        && $('#chat')?.classList.contains('active')
        && chatState.activeConversation?.id === conversation.id;
      if (currentChatVisible) return;
      deliverMessageNotification(conversation);
    });
  }

  function deliverMessageNotification(conversation) {
    const name = senderName(conversation);
    const preview = String(conversation.lastMessage || 'Tienes un mensaje nuevo.').slice(0, 160);
    playNotificationSound();
    showInAppMessageNotification(name, preview, conversation);
    showSystemNotification(name, preview, conversation);
  }

  function showInAppMessageNotification(name, preview, conversation) {
    const stack = $('#messageNotificationStack');
    if (!stack) return;
    const peer = peerFromConversation(conversation);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'message-notification-card';
    button.innerHTML = `
      <span class="message-notification-avatar">${escapeHtml(initials(name))}</span>
      <span class="message-notification-copy"><small>NUEVO MENSAJE</small><strong>${escapeHtml(name)}</strong><span>${escapeHtml(preview)}</span></span>
      <svg><use href="#i-chat"></use></svg>`;
    button.addEventListener('click', async () => {
      button.remove();
      window.LubaydShowView?.('chat');
      if (peer) await openPeer(peer);
    });
    stack.appendChild(button);
    requestAnimationFrame(() => button.classList.add('visible'));
    window.setTimeout(() => {
      button.classList.remove('visible');
      window.setTimeout(() => button.remove(), 250);
    }, 8000);
  }

  async function showSystemNotification(name, preview, conversation) {
    // FCM se ocupa de los avisos en segundo plano. Evita notificaciones duplicadas.
    if (window.LubaydPush?.isEnabled?.()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const peer = peerFromConversation(conversation);
    const options = {
      body: preview,
      icon: './assets/icon-192.png',
      badge: './assets/icon-192.png',
      tag: `lubayd-chat-${conversation.id}`,
      renotify: true,
      silent: true,
      data: { url: './?view=chat', peerUid: peer?.uid || '' }
    };
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(`Nuevo mensaje de ${name}`, options);
      } else {
        new Notification(`Nuevo mensaje de ${name}`, options);
      }
    } catch (error) {
      console.warn('Notificación del sistema:', error);
    }
  }

  function ensureAudioContext() {
    if (chatState.audioContext) return chatState.audioContext;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    chatState.audioContext = new AudioContext();
    return chatState.audioContext;
  }

  async function unlockAudio() {
    const context = ensureAudioContext();
    if (!context) return;
    try {
      if (context.state === 'suspended') await context.resume();
      chatState.audioUnlocked = context.state === 'running';
    } catch (_) {
      chatState.audioUnlocked = false;
    }
  }

  function playNotificationSound() {
    try {
      const settings = JSON.parse(localStorage.getItem('lubayd_ui_settings_v14') || '{}');
      if (settings.sound === false) return;
    } catch (_) {}
    const context = ensureAudioContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    if (context.state !== 'running') return;
    const now = context.currentTime;
    [0, 0.12].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(index === 0 ? 880 : 1175, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.13);
    });
  }

  async function requestNotifications() {
    await unlockAudio();
    if (!('Notification' in window)) {
      showDirectoryNotice('Este navegador no admite notificaciones del sistema. El aviso y el sonido dentro de la app seguirán funcionando.');
      updateNotificationButton();
      return;
    }
    try {
      if (window.LubaydPush?.enable) {
        await window.LubaydPush.enable();
      } else if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      updateNotificationButton();
      if (Notification.permission === 'granted') {
        showDirectoryNotice('Notificaciones push y sonido activados en este dispositivo.');
        window.setTimeout(() => showDirectoryNotice(''), 3500);
      } else if (Notification.permission === 'denied') {
        showDirectoryNotice('Las notificaciones están bloqueadas. Habilítalas desde la configuración del sitio o del teléfono.');
      }
    } catch (error) {
      showDirectoryNotice(error.message || 'No se pudieron activar las notificaciones push.');
      updateNotificationButton();
    }
  }

  function updateNotificationButton() {
    const button = $('#chatNotificationBtn');
    if (!button) return;
    const pushState = window.LubaydPush?.state?.() || {};
    const supported = pushState.supported !== false && 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    const enabled = Boolean(window.LubaydPush?.isEnabled?.());
    button.dataset.permission = permission;
    if (enabled) {
      button.innerHTML = '<svg><use href="#i-bell"></use></svg><span>Push activo</span>';
      button.title = 'Este dispositivo recibirá mensajes aunque la aplicación esté cerrada';
    } else if (permission === 'granted') {
      button.innerHTML = '<svg><use href="#i-bell"></use></svg><span>Completar activación</span>';
      button.title = 'Registrar este dispositivo en Firebase Cloud Messaging';
    } else if (permission === 'denied') {
      button.innerHTML = '<svg><use href="#i-bell"></use></svg><span>Avisos bloqueados</span>';
      button.title = 'Habilita las notificaciones desde la configuración del navegador';
    } else if (!supported) {
      button.innerHTML = '<svg><use href="#i-bell"></use></svg><span>No compatible</span>';
      button.title = 'Este navegador no admite notificaciones push web';
    } else {
      button.innerHTML = '<svg><use href="#i-bell"></use></svg><span>Activar push</span>';
      button.title = 'Recibir mensajes aunque la aplicación esté cerrada';
    }
  }

  $('#chatSearch')?.addEventListener('input', renderDirectory);
  $$('.chat-filter-tabs [data-chat-filter]').forEach(button => {
    button.addEventListener('click', () => {
      chatState.directoryFilter = button.dataset.chatFilter || 'all';
      $$('.chat-filter-tabs [data-chat-filter]').forEach(item => item.classList.toggle('active', item === button));
      renderDirectory();
    });
  });
  $('#chatBackBtn')?.addEventListener('click', closeThread);
  $('#chatNotificationBtn')?.addEventListener('click', requestNotifications);
  window.addEventListener('lubayd-push-state', updateNotificationButton);

  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  const input = $('#chatMessageInput');
  input?.addEventListener('input', () => {
    const count = $('#chatCharacterCount');
    if (count) count.textContent = String(input.value.length);
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('#chatForm')?.requestSubmit();
    }
  });

  $('#chatForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const text = String(input?.value || '').trim();
    if (!text || !chatState.activeConversation) return;
    const button = $('#chatSendBtn');
    if (button) button.disabled = true;
    try {
      await window.LubaydChat.sendMessage(chatState.activeConversation.id, text);
      input.value = '';
      input.style.height = 'auto';
      const count = $('#chatCharacterCount');
      if (count) count.textContent = '0';
      input.focus();
    } catch (error) {
      console.error('Enviar mensaje:', error);
      if (typeof window.alert === 'function') window.alert(error.message || 'No se pudo enviar el mensaje.');
    } finally {
      if (button) button.disabled = false;
    }
  });

  window.addEventListener('lubayd-profile-ready', event => {
    initialize(event.detail?.user, event.detail?.profile);
  });

  window.addEventListener('lubayd-auth-changed', event => {
    if (!event.detail?.user) cleanup();
  });

  window.addEventListener('focus', updateNotificationButton);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && chatState.activeConversation && $('#chat')?.classList.contains('active')) {
      window.LubaydChat.markRead(chatState.activeConversation.id).catch(() => {});
    }
  });

  window.LubaydChatUI = { show, initialize, closeThread, requestNotifications };

  if (window.LubaydCurrentUser && window.LubaydCurrentProfile) {
    initialize(window.LubaydCurrentUser, window.LubaydCurrentProfile);
  }
})();
