/* Lubayd SA V21.3.0 - usuarios y catalogos */
(function () {
  'use strict';
  const { $, escapeHtml, toast, confirmDialog } = window.Lubayd;
  let users = [];
  let machines = [];
  let forests = [];
  function isAdmin() { return window.Lubayd.state.profile?.role === 'admin' && !window.Lubayd.state.offlineSession; }
  async function loadUsers() {
    const list = $('#usersList');
    if (!isAdmin() || !navigator.onLine) { list.className = 'record-list empty'; list.textContent = 'Se requiere una sesión administrativa online.'; return; }
    try {
      const snapshot = await window.LubaydCloud.collection('usuarios').get();
      users = snapshot.docs.map(doc => Object.assign({ uid: doc.id }, window.LubaydCloud.normalize(doc.data()))).sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'));
      renderUsers();
    } catch (error) { list.textContent = error.message || String(error); }
  }
  function renderUsers() {
    const list = $('#usersList');
    if (!users.length) { list.className = 'record-list empty'; list.textContent = 'Sin usuarios.'; return; }
    list.className = 'record-list';
    list.innerHTML = users.map(user => `<article class="record-card user-row" data-user-id="${escapeHtml(user.uid)}"><div><h4>${escapeHtml(user.nombre || user.email || 'Usuario')}</h4><p>${escapeHtml(user.email || '')}</p></div><select data-user-role ${user.uid === window.Lubayd.state.user.uid ? 'disabled' : ''}><option value="operador" ${user.role === 'operador' ? 'selected' : ''}>Operador</option><option value="supervisor" ${user.role === 'supervisor' ? 'selected' : ''}>Supervisor</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select><label><input type="checkbox" data-user-active ${user.active !== false ? 'checked' : ''} ${user.uid === window.Lubayd.state.user.uid ? 'disabled' : ''}> Activo</label></article>`).join('');
    list.querySelectorAll('[data-user-role]').forEach(select => select.addEventListener('change', () => updateUser(select.closest('[data-user-id]').dataset.userId, { role: select.value })));
    list.querySelectorAll('[data-user-active]').forEach(input => input.addEventListener('change', () => updateUser(input.closest('[data-user-id]').dataset.userId, { active: input.checked })));
  }
  async function updateUser(uid, patch) {
    if (!isAdmin()) return;
    try {
      await window.LubaydCloud.collection('usuarios').doc(uid).set(Object.assign({}, patch, { updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedByUid: window.Lubayd.state.user.uid }), { merge: true });
      toast('Usuario actualizado', 'El cambio se aplicará en el próximo acceso.');
      await loadUsers();
    } catch (error) { toast('No se pudo actualizar', error.message || String(error)); }
  }
  async function fetchCatalog(name) {
    const cacheKey = `catalog_${name}`;
    if (navigator.onLine && window.LubaydCloud?.db && !window.Lubayd.state.offlineSession) {
      try {
        const snapshot = await window.LubaydCloud.collection(name).where('active', '==', true).get();
        const items = snapshot.docs.map(doc => Object.assign({ id: doc.id }, window.LubaydCloud.normalize(doc.data()))).sort((a, b) => String(a.name || a.nombre || '').localeCompare(String(b.name || b.nombre || ''), 'es'));
        await window.LubaydOffline.setCache(cacheKey, items);
        return items;
      } catch (error) { console.warn(`[Lubayd] Catálogo ${name}:`, error); }
    }
    return window.LubaydOffline.getCache(cacheKey, []);
  }
  async function loadCatalogs() {
    [machines, forests] = await Promise.all([fetchCatalog('maquinas'), fetchCatalog('montes')]);
    $('#machineOptions').innerHTML = machines.map(item => `<option value="${escapeHtml(item.name || item.nombre || '')}"></option>`).join('');
    $('#forestOptions').innerHTML = forests.map(item => `<option value="${escapeHtml(item.name || item.nombre || '')}"></option>`).join('');
    renderCatalogs();
  }
  function renderCatalogs() {
    const type = $('#catalogType').value;
    const items = type === 'maquinas' ? machines : forests;
    const list = $('#catalogList');
    if (!items.length) { list.className = 'record-list empty'; list.textContent = 'Sin elementos.'; return; }
    list.className = 'record-list';
    list.innerHTML = items.map(item => `<article class="record-card"><header><div><h4>${escapeHtml(item.name || item.nombre || 'Sin nombre')}</h4></div>${isAdmin() ? `<button class="btn btn-small" data-delete-catalog="${escapeHtml(item.id)}" type="button">Eliminar</button>` : ''}</header></article>`).join('');
    list.querySelectorAll('[data-delete-catalog]').forEach(button => button.addEventListener('click', () => deleteCatalog(type, button.dataset.deleteCatalog)));
  }
  async function addCatalog(event) {
    event.preventDefault();
    if (!isAdmin() || !navigator.onLine) return toast('Conexión requerida', 'Debes usar una sesión administrativa online.');
    const type = $('#catalogType').value;
    const name = $('#catalogName').value.trim();
    if (!name) return;
    try {
      await window.LubaydCloud.collection(type).add({ name, nombre: name, active: true, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdByUid: window.Lubayd.state.user.uid });
      $('#catalogName').value = '';
      await loadCatalogs();
      toast('Catálogo actualizado', `${name} fue agregado.`);
    } catch (error) { toast('No se pudo agregar', error.message || String(error)); }
  }
  async function deleteCatalog(type, id) {
    if (!await confirmDialog('Eliminar elemento', 'El elemento dejará de aparecer en los formularios.')) return;
    try {
      await window.LubaydCloud.collection(type).doc(id).set({ active: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await loadCatalogs();
    } catch (error) { toast('No se pudo eliminar', error.message || String(error)); }
  }
  function init() {
    $('#refreshUsersButton').addEventListener('click', loadUsers);
    $('#catalogForm').addEventListener('submit', addCatalog);
    $('#catalogType').addEventListener('change', renderCatalogs);
    window.addEventListener('lubayd-session-ready', () => { loadCatalogs(); if (isAdmin()) loadUsers(); });
    window.addEventListener('online', () => { if (window.Lubayd.state.user) loadCatalogs(); });
  }
  window.LubaydAdmin = { loadUsers, loadCatalogs };
  init();
})();
