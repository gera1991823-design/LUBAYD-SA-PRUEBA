/* Lubayd SA V20.2 - Chat interno */
(function () {
  'use strict';

  const state = { user: null, profile: null, contacts: [], active: null, unsubscribe: null, messages: [] };
  const $ = selector => document.querySelector(selector);
  const db = () => window.LubaydFirebase?.db;
  const FieldValue = () => window.LubaydFirebase?.FieldValue;
  const isManager = () => ['admin', 'supervisor'].includes(state.profile?.role);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function initials(name) {
    const parts = String(name || 'U').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  function chatIdFor(a, b) {
    return [a, b].sort().join('_');
  }

  function formatMessageTime(value) {
    const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
    return new Intl.DateTimeFormat('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function toast(title, text) {
    window.LubaydUI?.toast?.(title, text);
  }

  async function loadContacts() {
    if (!state.user || !db()) return;
    const list = $('#chatContacts');
    list.className = 'contact-list empty-state';
    list.textContent = 'Cargando usuarios…';
    try {
      const snapshot = await db().collection('usuarios').get();
      const users = snapshot.docs.map(doc => Object.assign({ uid: doc.id }, doc.data())).filter(item => item.active !== false && item.uid !== state.user.uid);
      state.contacts = users.filter(item => isManager() || ['admin', 'supervisor'].includes(item.role))
        .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
      renderContacts();
    } catch (error) {
      list.textContent = `No se pudieron cargar los usuarios: ${error.message || error}`;
    }
  }

  function renderContacts() {
    const list = $('#chatContacts');
    if (!state.contacts.length) {
      list.className = 'contact-list empty-state';
      list.textContent = 'No hay contactos disponibles.';
      return;
    }
    list.className = 'contact-list';
    list.innerHTML = state.contacts.map(contact => `<button class="contact-button ${state.active?.uid === contact.uid ? 'active' : ''}" data-contact-id="${escapeHtml(contact.uid)}"><span class="contact-avatar">${escapeHtml(initials(contact.nombre || contact.email))}</span><span><strong>${escapeHtml(contact.nombre || contact.email)}</strong><small>${escapeHtml(contact.role || 'operador')}</small></span></button>`).join('');
  }

  async function selectContact(contact) {
    state.active = contact;
    renderContacts();
    $('#chatTitle').textContent = contact.nombre || contact.email;
    $('#chatSubtitle').textContent = contact.email || contact.role || '';
    $('#chatInput').disabled = false;
    $('#chatForm button').disabled = false;
    state.unsubscribe?.();
    const chatId = chatIdFor(state.user.uid, contact.uid);
    await db().collection('chats').doc(chatId).set({
      members: [state.user.uid, contact.uid],
      memberNames: {
        [state.user.uid]: state.profile?.nombre || state.user.displayName || state.user.email,
        [contact.uid]: contact.nombre || contact.email
      },
      updatedAt: FieldValue().serverTimestamp()
    }, { merge: true });
    state.unsubscribe = db().collection('chats').doc(chatId).collection('mensajes').orderBy('createdAt', 'asc').limit(250).onSnapshot(snapshot => {
      state.messages = snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
      renderMessages();
      markRead();
    }, error => {
      $('#chatMessages').className = 'message-list empty-state';
      $('#chatMessages').textContent = `No se pudo abrir la conversación: ${error.message || error}`;
    });
  }

  function renderMessages() {
    const list = $('#chatMessages');
    if (!state.messages.length) {
      list.className = 'message-list empty-state';
      list.textContent = 'Todavía no hay mensajes en esta conversación.';
      return;
    }
    list.className = 'message-list';
    list.innerHTML = state.messages.map(message => `<article class="message-bubble ${message.senderId === state.user.uid ? 'mine' : ''}"><p>${escapeHtml(message.text)}</p><small>${escapeHtml(message.senderName || '')} · ${formatMessageTime(message.createdAt || message.createdAtClient)}</small></article>`).join('');
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  async function sendMessage(text) {
    const contact = state.active;
    if (!contact || !state.user) return;
    const clean = String(text || '').trim();
    if (!clean) return;
    const chatId = chatIdFor(state.user.uid, contact.uid);
    const batch = db().batch();
    const chatRef = db().collection('chats').doc(chatId);
    const messageRef = chatRef.collection('mensajes').doc();
    batch.set(messageRef, {
      text: clean,
      senderId: state.user.uid,
      senderName: state.profile?.nombre || state.user.displayName || state.user.email,
      receiverId: contact.uid,
      receiverName: contact.nombre || contact.email,
      chatId,
      read: false,
      createdAt: FieldValue().serverTimestamp(),
      createdAtClient: new Date().toISOString()
    });
    batch.set(chatRef, {
      members: [state.user.uid, contact.uid],
      lastMessage: clean.slice(0, 180),
      lastSenderId: state.user.uid,
      updatedAt: FieldValue().serverTimestamp()
    }, { merge: true });
    await batch.commit();
  }

  async function markRead() {
    const unread = state.messages.filter(message => message.receiverId === state.user.uid && !message.read);
    if (!unread.length || !state.active) return;
    const chatId = chatIdFor(state.user.uid, state.active.uid);
    const batch = db().batch();
    unread.forEach(message => batch.update(db().collection('chats').doc(chatId).collection('mensajes').doc(message.id), {
      read: true,
      readAt: FieldValue().serverTimestamp()
    }));
    await batch.commit().catch(console.warn);
    setUnreadBadge(0);
  }

  function setUnreadBadge(count) {
    document.querySelectorAll('[data-unread-badge]').forEach(badge => {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('hidden', !count);
    });
  }

  function bindEvents() {
    $('#chatContacts')?.addEventListener('click', event => {
      const button = event.target.closest('[data-contact-id]');
      if (!button) return;
      const contact = state.contacts.find(item => item.uid === button.dataset.contactId);
      if (contact) selectContact(contact);
    });
    $('#chatForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const input = $('#chatInput');
      const button = event.currentTarget.querySelector('button');
      if (!input.value.trim()) return;
      button.disabled = true;
      try {
        await sendMessage(input.value);
        input.value = '';
        input.focus();
      } catch (error) {
        toast('No se pudo enviar', error.message || String(error));
      } finally {
        button.disabled = false;
      }
    });
    $('#refreshContactsButton')?.addEventListener('click', loadContacts);
  }

  async function initialize(user, profile) {
    state.user = user;
    state.profile = profile;
    state.active = null;
    state.messages = [];
    state.unsubscribe?.();
    state.unsubscribe = null;
    $('#chatTitle').textContent = 'Selecciona un contacto';
    $('#chatSubtitle').textContent = 'Sin conversación abierta';
    $('#chatMessages').className = 'message-list empty-state';
    $('#chatMessages').textContent = 'Selecciona un contacto para comenzar.';
    $('#chatInput').disabled = true;
    $('#chatForm button').disabled = true;
    await loadContacts();
  }

  function reset() {
    state.unsubscribe?.();
    state.unsubscribe = null;
    state.user = null;
    state.profile = null;
    state.contacts = [];
    state.active = null;
    state.messages = [];
    setUnreadBadge(0);
  }

  bindEvents();
  window.addEventListener('lubayd-auth-ready', event => initialize(event.detail.user, event.detail.profile));
  window.addEventListener('lubayd-signed-out', reset);

  window.LubaydChat = { loadContacts, selectContact };
})();
