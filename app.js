const STORAGE_KEY='lubayd_partes_v3';
const LEGACY_KEYS=['lubayd_partes_v2','lubayd_partes'];
let step=1, deferredInstall=null, waitingWorker=null;
let currentGps=null, gpsInProgress=false;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function loadRecords(){let data=localStorage.getItem(STORAGE_KEY);if(!data){for(const k of LEGACY_KEYS){data=localStorage.getItem(k);if(data){localStorage.setItem(STORAGE_KEY,data);break}}}try{return JSON.parse(data||'[]')}catch{return[]}}
const state={
  get records(){return loadRecords()},
  save(v){localStorage.setItem(STORAGE_KEY,JSON.stringify(v))},
  async saveRecord(record){
    const records=this.records.filter(r=>r.id!==record.id);records.unshift(record);this.save(records);
    if(window.LubaydCloud?.available){try{await window.LubaydCloud.save(record);setCloudStatus('Sincronizado',true)}catch(err){console.error('Guardar Firestore:',err);setCloudStatus('Pendiente de sincronizar',false)}}
  },
  async deleteRecord(id){
    this.save(this.records.filter(r=>r.id!==id));
    if(window.LubaydCloud?.available){try{await window.LubaydCloud.remove(id);setCloudStatus('Sincronizado',true)}catch(err){console.error('Eliminar Firestore:',err);setCloudStatus('Pendiente de sincronizar',false)}}
  }
};
function showView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===id));const titles={dashboard:'Panel operativo',nuevo:'Nuevo parte',historial:'Historial de partes',graficos:'Gráficos operativos',ubicaciones:'Ubicaciones GPS'};$('#pageTitle').textContent=titles[id]||'Gestión Forestal';if(id==='nuevo'){step=1;updateStep();if(!$('#fecha').value)$('#fecha').value=new Date().toISOString().slice(0,10);setTimeout(captureGps,250)}if(id==='historial')renderHistory();if(id==='graficos'&&typeof window.renderCharts==='function')window.renderCharts();if(id==='ubicaciones')renderLocations();closeSidebar();window.scrollTo({top:0,behavior:'smooth'})}
$$('[data-view], [data-view-link]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.view||el.dataset.viewLink)));$('#heroNewBtn').addEventListener('click',()=>showView('nuevo'));
function updateStep(){$$('.form-page').forEach(p=>p.classList.toggle('active',+p.dataset.step===step));$$('.step').forEach((s,i)=>s.classList.toggle('active',i+1<=step));$('#stepNumber').textContent=step;$('#stepText').textContent=['Datos generales','Producción','Chequeo'][step-1];$('#prevBtn').classList.toggle('hidden',step===1);$('#nextBtn').classList.toggle('hidden',step===3);$('#saveBtn').classList.toggle('hidden',step!==3);if(step===3)fillReview()}
function validateStep(){
  const page=$(`.form-page[data-step="${step}"]`);
  const message=$('#message');
  if(message){message.textContent='';message.className='message'}
  page.querySelectorAll('.field-error').forEach(el=>el.classList.remove('field-error'));
  for(const input of page.querySelectorAll('input[required],select[required]')){
    if(!input.checkValidity()){
      const field=input.closest('label,fieldset');
      field?.classList.add('field-error');
      if(message){message.textContent='Completa los campos obligatorios marcados antes de continuar. La ubicación GPS es opcional.';message.className='message error'}
      input.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(()=>input.reportValidity(),250);
      return false;
    }
  }
  if(step===2&&num('#horometroFinal')<num('#horometroInicio')){alert('El horómetro final no puede ser menor que el inicial.');return false}
  if(step===2&&num('#arbolesFinales')<num('#arbolesIniciales')){alert('Los árboles finales no pueden ser menores que los iniciales.');return false}
  return true
}
$('#nextBtn').addEventListener('click',()=>{if(validateStep()){step++;updateStep();window.scrollTo({top:0,behavior:'smooth'})}});$('#prevBtn').addEventListener('click',()=>{step--;updateStep()});$('#cancelBtn').addEventListener('click',()=>showView('dashboard'));
const num=id=>Number($(id).value)||0;const radio=name=>document.querySelector(`input[name="${name}"]:checked`)?.value||'';
function recalc(){const h=Math.max(0,num('#horometroFinal')-num('#horometroInicio'));const a=Math.max(0,num('#arbolesFinales')-num('#arbolesIniciales'));$('#calcHoras').textContent=h.toLocaleString('es-UY',{maximumFractionDigits:1})+' h';$('#calcArboles').textContent=a.toLocaleString('es-UY');$('#calcRendimiento').textContent=(h?a/h:0).toLocaleString('es-UY',{maximumFractionDigits:1})+' árb/h'}
['#horometroInicio','#horometroFinal','#arbolesIniciales','#arbolesFinales'].forEach(id=>$(id).addEventListener('input',recalc));
function recordFromForm(){const checks=['agua','aceite','valvulina','giro','chequeoGral','cabezal','grua'];return{id:crypto.randomUUID?.()||String(Date.now()),createdAt:new Date().toISOString(),monte:$('#monte').value.trim(),fecha:$('#fecha').value,maquina:$('#maquina').value.trim(),operador:$('#operador').value.trim(),turno:radio('turno'),especie:$('#especie').value,largo:num('#largo'),horometroInicio:num('#horometroInicio'),horometroFinal:num('#horometroFinal'),horas:Math.max(0,num('#horometroFinal')-num('#horometroInicio')),arbolesIniciales:num('#arbolesIniciales'),arbolesFinales:num('#arbolesFinales'),arboles:Math.max(0,num('#arbolesFinales')-num('#arbolesIniciales')),carros:num('#carros'),actividad:radio('actividad'),desde:$('#desde1').value,hasta:$('#hasta1').value,trabajo:$('#trabajo1').value.trim(),mecanico:$('#mecanico1').value.trim(),checks:Object.fromEntries(checks.map(x=>[x,$('#'+x).checked])),observaciones:$('#observaciones').value.trim(),combustible:num('#combustible'),hidraulico:num('#hidraulico'),controlado:$('#controlado').value.trim(),firma:$('#firma').value.trim(),gps:currentGps?{...currentGps}:null}}
function fillReview(){const r=recordFromForm();$('#reviewContent').innerHTML=`<div class="review-grid"><div><b>Monte</b><br>${esc(r.monte)||'—'}</div><div><b>Fecha</b><br>${formatDate(r.fecha)}</div><div><b>Máquina</b><br>${esc(r.maquina)||'—'}</div><div><b>Operador</b><br>${esc(r.operador)||'—'}</div><div><b>Actividad</b><br>${esc(r.actividad)||'—'}</div><div><b>Producción</b><br>${r.arboles} árboles · ${r.horas.toFixed(1)} h</div><div><b>GPS</b><br>${r.gps?`${r.gps.latitude.toFixed(6)}, ${r.gps.longitude.toFixed(6)}`:'Sin ubicación'}</div></div>`}
$('#parteForm').addEventListener('submit',async e=>{e.preventDefault();if(!validateStep())return;const record=recordFromForm();await state.saveRecord(record);e.target.reset();currentGps=null;renderGpsState();step=1;updateStep();recalc();renderAll();showToast();showView('dashboard')});
function renderAll(){const rs=state.records,totalTrees=rs.reduce((s,r)=>s+(r.arboles||0),0),totalHours=rs.reduce((s,r)=>s+(r.horas||0),0),complete=rs.filter(r=>r.checks?.agua&&r.checks?.aceite).length;$('#kpiTotal').textContent=rs.length;$('#kpiArboles').textContent=totalTrees.toLocaleString('es-UY');$('#kpiHoras').textContent=totalHours.toLocaleString('es-UY',{maximumFractionDigits:1});$('#kpiChequeos').textContent=(rs.length?Math.round(complete/rs.length*100):0)+'%';$('#avgTrees').textContent=(rs.length?totalTrees/rs.length:0).toLocaleString('es-UY',{maximumFractionDigits:1});$('#avgHours').textContent=(rs.length?totalHours/rs.length:0).toLocaleString('es-UY',{maximumFractionDigits:1})+' h';$('#lastRecord').textContent=rs[0]?formatDate(rs[0].fecha):'—';$('#lastUpdate').textContent=new Date().toLocaleString('es-UY',{dateStyle:'short',timeStyle:'short'});if(typeof window.refreshChartOperators==='function')window.refreshChartOperators();if(typeof window.renderCharts==='function'&&document.getElementById('graficos')?.classList.contains('active'))window.renderCharts();$('#heroDate').textContent=new Date().toLocaleDateString('es-UY',{weekday:'long',day:'numeric',month:'long'});const recent=$('#recentList');if(!rs.length){recent.className='record-list empty-state';recent.textContent='Aquí aparecerán tus últimos partes guardados.'}else{recent.className='record-list';recent.innerHTML=rs.slice(0,5).map(r=>`<div class="record-item"><div class="record-main"><strong>${esc(r.monte)} · ${esc(r.maquina)}</strong><small>${formatDate(r.fecha)} · ${esc(r.operador)} · ${esc(r.actividad)}</small></div><span class="record-badge">${r.arboles} árboles</span></div>`).join('')}}
function filteredRecords(){const q=$('#historySearch').value.trim().toLowerCase(),act=$('#activityFilter').value;return state.records.filter(r=>(!act||r.actividad===act)&&(!q||[r.monte,r.maquina,r.operador].some(v=>(v||'').toLowerCase().includes(q))))}
function renderHistory(){const rs=filteredRecords(),body=$('#historyBody');$('#historyEmpty').classList.toggle('hidden',rs.length>0);body.innerHTML=rs.map(r=>`<tr><td>${formatDate(r.fecha)}</td><td>${esc(r.monte)}</td><td>${esc(r.maquina)}</td><td>${esc(r.operador)}</td><td>${esc(r.actividad)}</td><td>${r.arboles}</td><td><div class="table-actions"><button class="table-action" data-detail="${r.id}">Ver</button>${r.gps?`<a class="table-action gps-link" href="${mapUrl(r.gps)}" target="_blank" rel="noopener">Mapa</a>`:''}<button class="table-action danger" data-delete="${r.id}">Eliminar</button></div></td></tr>`).join('');$$('[data-detail]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.detail)));$$('[data-delete]').forEach(b=>b.addEventListener('click',()=>deleteRecord(b.dataset.delete)))}
$('#historySearch').addEventListener('input',renderHistory);$('#activityFilter').addEventListener('change',renderHistory);
async function deleteRecord(id){if(!confirm('¿Eliminar este parte? Esta acción no se puede deshacer.'))return;await state.deleteRecord(id);renderAll();renderHistory();renderLocations()}
function openDetail(id){const r=state.records.find(x=>x.id===id);if(!r)return;$('#detailContent').innerHTML=`<span class="eyebrow">DETALLE DEL PARTE</span><h2>${esc(r.monte)} · ${esc(r.maquina)}</h2><div class="detail-grid">${Object.entries({Fecha:formatDate(r.fecha),Operador:r.operador,Turno:r.turno,Especie:r.especie,Actividad:r.actividad,'Horas trabajadas':r.horas+' h','Árboles procesados':r.arboles,Rendimiento:(r.horas?r.arboles/r.horas:0).toFixed(1)+' árb/h',Carros:r.carros,Combustible:r.combustible+' L',Hidráulico:r.hidraulico+' L',Observaciones:r.observaciones||'—',GPS:r.gps?`${r.gps.latitude.toFixed(6)}, ${r.gps.longitude.toFixed(6)} (±${Math.round(r.gps.accuracy)} m)`:'Sin ubicación'}).map(([k,v])=>`<div><span>${k}</span><strong>${esc(String(v))}</strong></div>`).join('')}</div>${r.gps?`<a class="btn gps-btn detail-map-btn" href="${mapUrl(r.gps)}" target="_blank" rel="noopener">⌖ Abrir ubicación en el mapa</a>`:''}`;$('#detailModal').classList.remove('hidden')}
$('#detailClose').addEventListener('click',()=>$('#detailModal').classList.add('hidden'));$('#detailModal').addEventListener('click',e=>{if(e.target.id==='detailModal')e.currentTarget.classList.add('hidden')});
$('#exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state.records,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`partes-forestales-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)});
function showToast(){const t=$('#toast');t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2600)}function formatDate(v){return v?new Date(v+'T12:00:00').toLocaleDateString('es-UY'):'—'}function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function syncNetworkStatus(){const online=navigator.onLine,el=$('#networkStatus');el.classList.toggle('offline',!online);el.querySelector('b').textContent=online?'En línea':'Sin conexión'}window.addEventListener('online',syncNetworkStatus);window.addEventListener('offline',syncNetworkStatus);syncNetworkStatus();
function closeSidebar(){$('#sidebar').classList.remove('open');$('#sidebarOverlay').classList.remove('show')}$('#menuBtn').addEventListener('click',()=>{$('#sidebar').classList.toggle('open');$('#sidebarOverlay').classList.toggle('show')});$('#sidebarOverlay').addEventListener('click',closeSidebar);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('hidden')});window.addEventListener('appinstalled',()=>$('#installBtn').classList.add('hidden'));
if('serviceWorker'in navigator){window.addEventListener('load',async()=>{try{const reg=await navigator.serviceWorker.register('./service-worker.js');if(reg.waiting){waitingWorker=reg.waiting;$('#updateBanner').classList.remove('hidden')}reg.addEventListener('updatefound',()=>{const w=reg.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller){waitingWorker=w;$('#updateBanner').classList.remove('hidden')}})})}catch(err){console.error('PWA:',err)}});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload())}$('#updateBtn').addEventListener('click',()=>waitingWorker?.postMessage({type:'SKIP_WAITING'}));

function mapUrl(gps){return `https://www.google.com/maps/search/?api=1&query=${gps.latitude},${gps.longitude}`}
function renderGpsState(message){
  const box=$('#gpsState'), coords=$('#gpsCoordinates'), link=$('#gpsPreviewLink');
  if(!box)return;
  box.className='gps-state '+(currentGps?'success':'idle');
  if(currentGps){
    box.innerHTML='<span class="gps-check">✓</span><div><strong>Ubicación obtenida</strong><small>Lista para guardar con el parte.</small></div>';
    coords.classList.remove('hidden');
    coords.innerHTML=`<div><span>Latitud</span><strong>${currentGps.latitude.toFixed(6)}</strong></div><div><span>Longitud</span><strong>${currentGps.longitude.toFixed(6)}</strong></div><div><span>Precisión</span><strong>±${Math.round(currentGps.accuracy)} m</strong></div>`;
    link.href=mapUrl(currentGps);link.classList.remove('hidden');
  }else{
    box.innerHTML=`<span class="gps-pulse"></span><div><strong>${message||'Ubicación pendiente'}</strong><small>${message?'Puedes volver a intentarlo.':'Presiona el botón para obtenerla.'}</small></div>`;
    coords.classList.add('hidden');link.classList.add('hidden');
  }
}
function captureGps(){
  const btn=$('#gpsCaptureBtn');
  if(gpsInProgress)return;
  if(!navigator.geolocation){renderGpsState('Este dispositivo no admite GPS');updateGpsSystem(false);return}
  gpsInProgress=true;
  if(btn){btn.disabled=true;btn.textContent='⌖ Obteniendo ubicación…'}
  const box=$('#gpsState');
  if(box){box.className='gps-state loading';box.innerHTML='<span class="gps-pulse"></span><div><strong>Buscando señal GPS…</strong><small>Puedes completar el parte y continuar mientras se obtiene.</small></div>'}
  const finish=()=>{
    gpsInProgress=false;
    if(btn){btn.disabled=false;btn.textContent=currentGps?'↻ Actualizar ubicación':'⌖ Reintentar ubicación'}
  };
  navigator.geolocation.getCurrentPosition(pos=>{
    currentGps={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy,altitude:pos.coords.altitude,heading:pos.coords.heading,speed:pos.coords.speed,capturedAt:new Date().toISOString()};
    renderGpsState();updateGpsSystem(true);finish();
  },err=>{
    const messages={1:'Permiso de ubicación denegado',2:'No se pudo determinar la ubicación',3:'La búsqueda de GPS demoró demasiado'};
    renderGpsState(messages[err.code]||'No se pudo obtener la ubicación');updateGpsSystem(false);finish();
  },{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}
function updateGpsSystem(ok){const txt=$('#gpsSystemStatus'),dot=$('#gpsStatusDot');if(!txt||!dot)return;txt.textContent=ok?'Disponible':'Revisar permiso';dot.classList.toggle('ok',ok)}
function renderLocations(){
  const rs=state.records.filter(r=>r.gps), list=$('#locationList');
  $('#gpsRecordCount').textContent=rs.length;
  $('#gpsAverageAccuracy').textContent=rs.length?`±${Math.round(rs.reduce((s,r)=>s+(r.gps.accuracy||0),0)/rs.length)} m`:'—';
  $('#gpsLastCapture').textContent=rs[0]?.gps?.capturedAt?new Date(rs[0].gps.capturedAt).toLocaleString('es-UY',{dateStyle:'short',timeStyle:'short'}):'—';
  if(!rs.length){list.innerHTML='<div class="empty-state">Todavía no hay partes con ubicación GPS.</div>';return}
  list.innerHTML=rs.map(r=>`<article class="location-item"><div class="location-pin">⌖</div><div class="location-copy"><strong>${esc(r.monte)} · ${esc(r.maquina)}</strong><span>${formatDate(r.fecha)} · ${esc(r.operador)}</span><small>${r.gps.latitude.toFixed(6)}, ${r.gps.longitude.toFixed(6)} · ±${Math.round(r.gps.accuracy)} m</small></div><a class="btn gps-btn" href="${mapUrl(r.gps)}" target="_blank" rel="noopener">Abrir mapa</a></article>`).join('');
}
$('#gpsCaptureBtn')?.addEventListener('click',captureGps);
$('#gpsRefreshBtn')?.addEventListener('click',renderLocations);
renderGpsState();

renderAll();updateStep();


/* ===== Sincronización Firebase ===== */
let cloudUnsubscribe=null;
function setCloudStatus(text,ok){
  const el=$('#networkStatus');if(!el)return;
  const label=el.querySelector('b');if(label)label.textContent=navigator.onLine?text:'Sin conexión';
  el.classList.toggle('offline',!ok||!navigator.onLine);
}
async function startCloudSync(){
  if(!window.LubaydCloud?.available){setCloudStatus('Solo local',false);return}
  setCloudStatus('Conectando…',false);
  try{
    const migrationKey='lubayd_firestore_migrated_v1';
    if(!localStorage.getItem(migrationKey)){
      await window.LubaydCloud.migrate(state.records);
      localStorage.setItem(migrationKey,new Date().toISOString());
    }
    if(cloudUnsubscribe)cloudUnsubscribe();
    cloudUnsubscribe=window.LubaydCloud.subscribe((records,meta)=>{
      // Firestore es la fuente compartida; la copia local permite abrir la app sin conexión.
      state.save(records);
      renderAll();
      if($('#historial')?.classList.contains('active'))renderHistory();
      if($('#ubicaciones')?.classList.contains('active'))renderLocations();
      if(typeof window.renderCharts==='function'&&$('#graficos')?.classList.contains('active'))window.renderCharts();
      setCloudStatus(meta.hasPendingWrites?'Sincronizando…':(meta.fromCache?'Datos locales':'Sincronizado'),!meta.hasPendingWrites);
    },err=>{console.error('Escucha Firestore:',err);setCloudStatus('Error de sincronización',false)});
  }catch(err){console.error('Inicio Firestore:',err);setCloudStatus('Pendiente de sincronizar',false)}
}
window.addEventListener('lubayd-cloud-ready',startCloudSync);
window.addEventListener('lubayd-cloud-error',()=>setCloudStatus('Solo local',false));
if(window.LubaydCloud)startCloudSync();
