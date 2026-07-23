/* Lubayd SA V22.0.0 - chat interno online */
(function () {
  'use strict';
  const { $, escapeHtml, formatTime, toast } = window.Lubayd;
  let contacts = [];
  let selected = null;
  let unsubscribeMessages = null;

  function available() {
    return navigator.onLine && !window.Lubayd.state.offlineSession && window.LubaydCloud?.db && window.LubaydCloud.currentUser();
  }
  async function loadContacts() {
    const list = $('#chatContacts');
    if (!available()) { list.innerHTML = '<div class="empty">Los mensajes requieren conexión e inicio de sesión online.</div>'; return; }
    try {
      const current = window.Lubayd.state.user;
      const role = window.Lubayd.state.profile?.role;
      let query = window.LubaydCloud.collection('usuarios').where('active', '==', true);
      if (role !== 'admin') query = query.where('role', '==', 'admin');
      const snapshot = await query.get();
      contacts = snapshot.docs.map(doc => Object.assign({ uid: doc.id }, window.LubaydCloud.normalize(doc.data()))).filter(item => item.uid !== current.uid).sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
      renderContacts();
    } catch (error) {
      list.innerHTML = `<div class="empty">${escapeHtml(error.message || String(error))}</div>`;
    }
  }
  function renderContacts() {
    const search = String($('#chatSearch').value || '').toLowerCase();
    const filtered = contacts.filter(item => `${item.nombre || ''} ${item.email || ''}`.toLowerCase().includes(search));
    const list = $('#chatContacts');
    if (!filtered.length) { list.innerHTML = '<div class="empty">No hay usuarios disponibles.</div>'; return; }
    list.innerHTML = filtered.map(item => `<button type="button" class="contact-item ${selected?.uid === item.uid ? 'active' : ''}" data-contact-id="${escapeHtml(item.uid)}"><strong>${escapeHtml(item.nombre || item.email || 'Usuario')}</strong><br><small>${escapeHtml(item.email || '')}</small></button>`).join('');
    list.querySelectorAll('[data-contact-id]').forEach(button => button.addEventListener('click', () => selectContact(contacts.find(item => item.uid === button.dataset.contactId))));
  }
  function chatId(peer) { return [window.Lubayd.state.user.uid, peer.uid].sort().join('__'); }
  async function ensureChat(peer) {
    const id = chatId(peer);
    const ref = window.LubaydCloud.collection('chats').doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      const current = window.Lubayd.state.user;
      const profile = window.Lubayd.state.profile;
      await ref.set({
        participants: [current.uid, peer.uid],
        participantNames: { [current.uid]: profile.nombre || current.email, [peer.uid]: peer.nombre || peer.email },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAtClient: new Date().toISOString(),
        lastMessage: '',
        lastMessageAtClient: ''
      });
    }
    return { id, ref };
  }
  async function selectContact(peer) {
    if (!peer || !available()) return;
    selected = peer;
    renderContacts();
    $('#chatHeader').textContent = peer.nombre || peer.email || 'Usuario';
    $('#chatInput').disabled = false;
    $('#chatForm button').disabled = false;
    unsubscribeMessages?.();
    try {
      const chat = await ensureChat(peer);
      unsubscribeMessages = chat.ref.collection('mensajes').orderBy('createdAtClient', 'asc').limit(300).onSnapshot(snapshot => {
        const messages = snapshot.docs.map(doc => Object.assign({ id: doc.id }, window.LubaydCloud.normalize(doc.data())));
        const container = $('#chatMessages');
        if (!messages.length) container.innerHTML = '<div class="empty">Todavía no hay mensajes.</div>';
        else container.innerHTML = messages.map(message => `<div class="message ${message.senderId === window.Lubayd.state.user.uid ? 'own' : ''}">${escapeHtml(message.text || '')}<small>${formatTime(message.createdAtClient || message.createdAt)}</small></div>`).join('');
        container.scrollTop = container.scrollHeight;
      }, error => { $('#chatMessages').innerHTML = `<div class="empty">${escapeHtml(error.message || String(error))}</div>`; });
    } catch (error) { toast('No se pudo abrir el chat', error.message || String(error)); }
  }
  async function send(event) {
    event.preventDefault();
    if (!selected || !available()) return;
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const chat = await ensureChat(selected);
      const current = window.Lubayd.state.user;
      const now = new Date().toISOString();
      const messageRef = chat.ref.collection('mensajes').doc();
      const batch = window.LubaydCloud.db.batch();
      batch.set(messageRef, {
        text: text.slice(0, 1000),
        senderId: current.uid,
        senderName: window.Lubayd.state.profile?.nombre || current.email || 'Usuario',
        receiverId: selected.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAtClient: now
      });
      batch.set(chat.ref, { lastMessage: text.slice(0, 160), lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(), lastMessageAtClient: now, lastSenderId: current.uid }, { merge: true });
      await batch.commit();
      input.value = '';
    } catch (error) { toast('No se pudo enviar', error.message || String(error)); }
    finally { button.disabled = false; }
  }
  function reset() {
    contacts = [];
    selected = null;
    unsubscribeMessages?.();
    unsubscribeMessages = null;
    $('#chatContacts').innerHTML = '';
    $('#chatMessages').innerHTML = '<div class="empty">No hay conversación seleccionada.</div>';
    $('#chatInput').disabled = true;
    $('#chatForm button').disabled = true;
  }
  function init() {
    $('#chatSearch').addEventListener('input', renderContacts);
    $('#chatForm').addEventListener('submit', send);
    window.addEventListener('lubayd-session-ready', event => { reset(); if (!event.detail.offline) loadContacts(); });
    window.addEventListener('lubayd-session-ended', reset);
    window.addEventListener('online', () => { if (window.Lubayd.state.user) loadContacts(); });
  }
  window.LubaydChat = { loadContacts, reset };
  init();
})();
