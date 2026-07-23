/* Lubayd SA V22.0.0 - administración de usuarios, catálogos y registros */
(function () {
  'use strict';
  const { $, $$, escapeHtml, toast, confirmDialog, formatDateTime } = window.Lubayd;
  let users = [], machines = [], forests = [], operationalRecords = [];
  const collectionMap = { part:'partes', attendance:'asistencias', break:'descansos', fuel:'combustible_flujo_movimientos' };
  const typeLabel = { part:'Parte diario', attendance:'Asistencia', break:'Descanso', fuel:'Combustible' };
  function isAdmin() { return window.Lubayd.state.profile?.role === 'admin' && !window.Lubayd.state.offlineSession; }

  function bindTabs() {
    $$('[data-admin-tab]').forEach(button => button.addEventListener('click', () => {
      $$('[data-admin-tab]').forEach(item => item.classList.toggle('active', item === button));
      $$('.admin-tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `adminTab-${button.dataset.adminTab}`));
    }));
  }
  async function loadUsers() {
    const list = $('#usersList');
    if (!isAdmin() || !navigator.onLine) { list.className='record-list empty'; list.textContent='Se requiere una sesión administrativa online.'; return; }
    try {
      const snapshot = await window.LubaydCloud.collection('usuarios').get();
      users = snapshot.docs.map(doc => Object.assign({ uid:doc.id }, window.LubaydCloud.normalize(doc.data()))).sort((a,b)=>String(a.nombre||a.email).localeCompare(String(b.nombre||b.email),'es'));
      renderUsers();
    } catch (error) { list.textContent = error.message || String(error); }
  }
  function renderUsers() {
    const list=$('#usersList');
    if (!users.length) { list.className='record-list empty'; list.textContent='Sin usuarios.'; return; }
    list.className='record-list';
    list.innerHTML=users.map(user=>`<article class="record-card user-row" data-user-id="${escapeHtml(user.uid)}"><div><h4>${escapeHtml(user.nombre||user.email||'Usuario')}</h4><p>${escapeHtml(user.email||'')}</p></div><select data-user-role ${user.uid===window.Lubayd.state.user.uid?'disabled':''}><option value="operador" ${user.role==='operador'?'selected':''}>Operador</option><option value="supervisor" ${user.role==='supervisor'?'selected':''}>Supervisor</option><option value="admin" ${user.role==='admin'?'selected':''}>Administrador</option></select><label><input type="checkbox" data-user-active ${user.active!==false?'checked':''} ${user.uid===window.Lubayd.state.user.uid?'disabled':''}> Activo</label></article>`).join('');
    list.querySelectorAll('[data-user-role]').forEach(select=>select.addEventListener('change',()=>updateUser(select.closest('[data-user-id]').dataset.userId,{role:select.value})));
    list.querySelectorAll('[data-user-active]').forEach(input=>input.addEventListener('change',()=>updateUser(input.closest('[data-user-id]').dataset.userId,{active:input.checked})));
  }
  async function updateUser(uid,patch) {
    if (!isAdmin()) return;
    try { await window.LubaydCloud.collection('usuarios').doc(uid).set(Object.assign({},patch,{updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedByUid:window.Lubayd.state.user.uid}),{merge:true}); toast('Usuario actualizado','El cambio se aplicará en el próximo acceso.'); await loadUsers(); }
    catch(error){ toast('No se pudo actualizar',error.message||String(error)); }
  }

  async function fetchCatalog(name) {
    const cacheKey=`catalog_${name}`;
    if (navigator.onLine && window.LubaydCloud?.db && !window.Lubayd.state.offlineSession) {
      try { const snapshot=await window.LubaydCloud.collection(name).where('active','==',true).get(); const items=snapshot.docs.map(doc=>Object.assign({id:doc.id},window.LubaydCloud.normalize(doc.data()))).sort((a,b)=>String(a.name||a.nombre||'').localeCompare(String(b.name||b.nombre||''),'es')); await window.LubaydOffline.setCache(cacheKey,items); return items; }
      catch(error){ console.warn(`[Lubayd] Catálogo ${name}:`,error); }
    }
    return window.LubaydOffline.getCache(cacheKey,[]);
  }
  async function loadCatalogs(){ [machines,forests]=await Promise.all([fetchCatalog('maquinas'),fetchCatalog('montes')]); $('#machineOptions').innerHTML=machines.map(item=>`<option value="${escapeHtml(item.name||item.nombre||'')}"></option>`).join(''); $('#forestOptions').innerHTML=forests.map(item=>`<option value="${escapeHtml(item.name||item.nombre||'')}"></option>`).join(''); renderCatalogs(); }
  function renderCatalogs(){ const type=$('#catalogType').value; const items=type==='maquinas'?machines:forests; const list=$('#catalogList'); if(!items.length){list.className='record-list empty';list.textContent='Sin elementos.';return;} list.className='record-list'; list.innerHTML=items.map(item=>`<article class="record-card"><header><div><h4>${escapeHtml(item.name||item.nombre||'Sin nombre')}</h4></div>${isAdmin()?`<button class="btn btn-small danger-button" data-delete-catalog="${escapeHtml(item.id)}" type="button">Eliminar</button>`:''}</header></article>`).join(''); list.querySelectorAll('[data-delete-catalog]').forEach(button=>button.addEventListener('click',()=>deleteCatalog(type,button.dataset.deleteCatalog))); }
  async function addCatalog(event){ event.preventDefault(); if(!isAdmin()||!navigator.onLine)return toast('Conexión requerida','Debes usar una sesión administrativa online.'); const type=$('#catalogType').value,name=$('#catalogName').value.trim(); if(!name)return; try{await window.LubaydCloud.collection(type).add({name,nombre:name,active:true,createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdByUid:window.Lubayd.state.user.uid});$('#catalogName').value='';await loadCatalogs();toast('Catálogo actualizado',`${name} fue agregado.`);}catch(error){toast('No se pudo agregar',error.message||String(error));}}
  async function deleteCatalog(type,id){ if(!await confirmDialog('Eliminar elemento','El elemento dejará de aparecer en los formularios.'))return; try{await window.LubaydCloud.collection(type).doc(id).set({active:false,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});await loadCatalogs();}catch(error){toast('No se pudo eliminar',error.message||String(error));}}

  function normalizeRecord(type,doc){ const data=window.LubaydCloud.normalize(doc.data()||{}); return {id:doc.id,type,data,sortDate:data.updatedAtClient||data.createdAtClient||data.syncedAt||data.createdAt||''}; }
  async function loadOperationalRecords(){
    const list=$('#adminRecordsList');
    if(!isAdmin()||!navigator.onLine){list.className='record-list empty';list.textContent='Se requiere una sesión administrativa online.';return;}
    list.className='record-list empty';list.textContent='Cargando registros…';
    try{
      const filter=$('#adminRecordType').value;
      const types=filter==='all'?Object.keys(collectionMap):[filter];
      const results=await Promise.all(types.map(async type=>{const snapshot=await window.LubaydCloud.collection(collectionMap[type]).limit(100).get();return snapshot.docs.map(doc=>normalizeRecord(type,doc));}));
      operationalRecords=results.flat().sort((a,b)=>String(b.sortDate).localeCompare(String(a.sortDate))).slice(0,200);
      renderOperationalRecords();
    }catch(error){list.textContent=error.message||String(error);}
  }
  function summaryFor(record){ const d=record.data||{}; if(record.type==='part')return `${d.machine||'Máquina'} · ${d.forest||'Monte'} · ${d.notes||''}`; if(record.type==='attendance')return `Ingreso ${formatDateTime(d.entry?.at)} · Salida ${formatDateTime(d.exit?.at)}`; if(record.type==='break')return `Inicio ${formatDateTime(d.start?.at)} · Fin ${formatDateTime(d.end?.at)}`; if(record.type==='fuel')return `${d.action||'Movimiento'} · ${d.liters||0} L ${d.machine?`· ${d.machine}`:''}`; return ''; }
  function renderOperationalRecords(){ const list=$('#adminRecordsList'); if(!operationalRecords.length){list.className='record-list empty';list.textContent='Sin registros.';return;} list.className='record-list'; list.innerHTML=operationalRecords.map(record=>`<article class="record-card" data-admin-record="${escapeHtml(record.id)}" data-record-type="${record.type}"><header><div><h4>${typeLabel[record.type]} · ${escapeHtml(record.data.userName||record.data.createdByName||'Usuario')}</h4><p>${escapeHtml(summaryFor(record))}</p></div><div class="admin-record-actions"><button class="btn btn-small" data-edit-record type="button"><svg><use href="#i-edit"/></svg>Editar</button><button class="btn btn-small danger-button" data-delete-record type="button"><svg><use href="#i-trash"/></svg>Eliminar</button></div></header></article>`).join(''); list.querySelectorAll('[data-edit-record]').forEach(button=>button.addEventListener('click',()=>openEdit(button.closest('[data-admin-record]').dataset.recordType,button.closest('[data-admin-record]').dataset.adminRecord))); list.querySelectorAll('[data-delete-record]').forEach(button=>button.addEventListener('click',()=>deleteRecord(button.closest('[data-admin-record]').dataset.recordType,button.closest('[data-admin-record]').dataset.adminRecord))); }
  function field(label,name,value,type='text'){return `<label>${label}<input data-edit-field="${name}" type="${type}" value="${escapeHtml(value??'')}"></label>`;}
  function openEdit(type,id){ const record=operationalRecords.find(item=>item.type===type&&item.id===id); if(!record)return; const d=record.data||{}; $('#adminEditId').value=id;$('#adminEditType').value=type;let html=''; if(type==='part'){html=field('Máquina','machine',d.machine)+field('Monte / Lote','forest',d.forest)+field('Horómetro inicial','hourStart',d.hourStart,'number')+field('Horómetro final','hourEnd',d.hourEnd,'number')+field('Combustible (L)','fuel',d.fuel,'number')+`<label class="full">Trabajo / observaciones<textarea data-edit-field="notes">${escapeHtml(d.notes||'')}</textarea></label>`;} else if(type==='fuel'){html=`<label>Movimiento<select data-edit-field="action"><option value="tank_load" ${d.action==='tank_load'?'selected':''}>Proveedor → Tanque</option><option value="trailer_load" ${d.action==='trailer_load'?'selected':''}>Tanque → Tráiler</option><option value="machine_delivery" ${d.action==='machine_delivery'?'selected':''}>Tráiler → Máquina</option><option value="tank_adjust" ${d.action==='tank_adjust'?'selected':''}>Ajuste tanque</option><option value="trailer_adjust" ${d.action==='trailer_adjust'?'selected':''}>Ajuste tráiler</option></select></label>`+field('Máquina','machine',d.machine)+field('Litros','liters',d.liters,'number')+`<label class="full">Observaciones<textarea data-edit-field="notes">${escapeHtml(d.notes||'')}</textarea></label>`;} else {const first=type==='attendance'?'entry':'start',second=type==='attendance'?'exit':'end';html=field(type==='attendance'?'Ingreso':'Inicio',`${first}.at`,d[first]?.at||'','datetime-local')+field(type==='attendance'?'Salida':'Fin',`${second}.at`,d[second]?.at||'','datetime-local');}
    $('#adminEditFields').innerHTML=html;$('#adminEditMessage').textContent='';$('#adminEditModal').classList.remove('hidden'); }
  function closeEdit(){ $('#adminEditModal').classList.add('hidden'); }
  function patchFromForm(){ const patch={}; $('#adminEditFields').querySelectorAll('[data-edit-field]').forEach(input=>{const path=input.dataset.editField;let value=input.value;if(input.type==='number')value=Number(value);if(input.type==='datetime-local'&&value)value=new Date(value).toISOString();if(path.includes('.')){const [parent,child]=path.split('.');patch[parent]=patch[parent]||{};patch[parent][child]=value;}else patch[path]=value;}); return patch; }
  async function submitEdit(event){event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');window.Lubayd.setBusy(button,true,'Guardando');try{await window.LubaydCloud.call('adminManageRecord',{action:'update',type:$('#adminEditType').value,id:$('#adminEditId').value,patch:patchFromForm()});closeEdit();toast('Registro actualizado','Los cambios fueron guardados.');await loadOperationalRecords();}catch(error){$('#adminEditMessage').textContent=window.LubaydCloud.errorMessage(error);}finally{window.Lubayd.setBusy(button,false);}}
  async function deleteRecord(type,id){if(!await confirmDialog('Eliminar registro','Esta acción eliminará el registro del sistema.'))return;try{await window.LubaydCloud.call('adminManageRecord',{action:'delete',type,id});toast('Registro eliminado','La información fue eliminada.');await loadOperationalRecords();}catch(error){toast('No se pudo eliminar',window.LubaydCloud.errorMessage(error));}}

  function init(){bindTabs();$('#refreshUsersButton').addEventListener('click',loadUsers);$('#catalogForm').addEventListener('submit',addCatalog);$('#catalogType').addEventListener('change',renderCatalogs);$('#refreshAdminRecordsButton').addEventListener('click',loadOperationalRecords);$('#adminRecordType').addEventListener('change',loadOperationalRecords);$('#adminEditClose').addEventListener('click',closeEdit);$('#adminEditForm').addEventListener('submit',submitEdit);window.addEventListener('lubayd-session-ready',()=>{loadCatalogs();if(isAdmin()){loadUsers();loadOperationalRecords();}});window.addEventListener('online',()=>{if(window.Lubayd.state.user)loadCatalogs();});}
  window.LubaydAdmin={loadUsers,loadCatalogs,loadOperationalRecords};
  init();
})();
