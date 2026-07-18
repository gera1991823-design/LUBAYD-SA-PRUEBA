(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let period = 'day';
  const fmt = (v, digits = 0) => Number(v || 0).toLocaleString('es-UY', { maximumFractionDigits: digits });
  const parseDate = value => value ? new Date(value + 'T12:00:00') : null;
  const monday = date => { const d = new Date(date); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d; };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const groupKey = date => period === 'month' ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}` : period === 'week' ? iso(monday(date)) : iso(date);
  const labelFor = key => {
    if (period === 'month') return new Date(key + '-01T12:00:00').toLocaleDateString('es-UY',{month:'short',year:'2-digit'});
    const d = parseDate(key);
    return period === 'week' ? `Sem. ${d.toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit'})}` : d.toLocaleDateString('es-UY',{day:'2-digit',month:'2-digit'});
  };
  function records() {
    const operator = $('#chartOperator')?.value || '';
    const range = $('#chartRange')?.value || '30';
    const cutoff = range === 'all' ? null : new Date(Date.now() - Number(range) * 86400000);
    return state.records.filter(r => {
      const d = parseDate(r.fecha);
      return d && (!operator || r.operador === operator) && (!cutoff || d >= cutoff);
    });
  }
  function grouped(rs) {
    const map = new Map();
    rs.forEach(r => {
      const key = groupKey(parseDate(r.fecha));
      const row = map.get(key) || { key, combustible:0, horas:0, arboles:0 };
      row.combustible += Number(r.combustible)||0;
      row.horas += Number(r.horas)||0;
      row.arboles += Number(r.arboles)||0;
      map.set(key,row);
    });
    return [...map.values()].sort((a,b)=>a.key.localeCompare(b.key));
  }
  function roundedRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
  function drawChart(canvas, rows, field, options) {
    const empty = canvas.parentElement.querySelector('.chart-empty');
    const values = rows.map(r=>Number(r[field])||0);
    const has = values.some(v=>v>0);
    empty.classList.toggle('hidden',has);
    canvas.classList.toggle('hidden',!has);
    if(!has) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width * ratio); canvas.height = Math.max(220, rect.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio,ratio);
    const w=rect.width,h=rect.height,p={l:42,r:12,t:12,b:42},cw=w-p.l-p.r,ch=h-p.t-p.b;
    ctx.clearRect(0,0,w,h); ctx.font='11px system-ui'; ctx.fillStyle='#86958d'; ctx.textAlign='right'; ctx.textBaseline='middle';
    const max=Math.max(...values,1); const nice=Math.ceil(max/(max>1000?500:max>100?50:max>20?10:5))*(max>1000?500:max>100?50:max>20?10:5);
    for(let i=0;i<=4;i++){const y=p.t+ch*(i/4);ctx.strokeStyle='#edf2ef';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillText(fmt(nice*(1-i/4), nice<20?1:0),p.l-7,y)}
    const slot=cw/values.length; const bw=Math.min(38,slot*.58);
    values.forEach((v,i)=>{const bh=(v/nice)*ch,x=p.l+slot*i+(slot-bw)/2,y=p.t+ch-bh;const grad=ctx.createLinearGradient(0,y,0,p.t+ch);grad.addColorStop(0,options.top);grad.addColorStop(1,options.bottom);ctx.fillStyle=grad;roundedRect(ctx,x,y,bw,Math.max(bh,2),Math.min(8,bw/3));ctx.fill();ctx.fillStyle='#74837b';ctx.textAlign='center';ctx.textBaseline='top';let label=labelFor(rows[i].key);if(values.length>10&&i%Math.ceil(values.length/8)!==0)label='';ctx.fillText(label,x+bw/2,p.t+ch+10)});
  }
  function peak(rows, field, suffix) { const row=rows.reduce((best,r)=>(r[field]||0)>(best?.[field]||0)?r:best,null); return row&&row[field]>0?`Máximo: ${fmt(row[field],1)} ${suffix}`:'Máximo: —'; }
  function ranking(rs){
    const map=new Map();rs.forEach(r=>{const name=(r.operador||'Sin operador').trim();const x=map.get(name)||{horas:0,arboles:0,partes:0};x.horas+=Number(r.horas)||0;x.arboles+=Number(r.arboles)||0;x.partes++;map.set(name,x)});
    const rows=[...map.entries()].map(([name,x])=>({name,...x,value:x.horas?x.arboles/x.horas:0})).sort((a,b)=>b.value-a.value).slice(0,8);const root=$('#operatorRanking');
    if(!rows.length){root.innerHTML='<div class="chart-empty">No hay datos para comparar.</div>';return}const max=Math.max(...rows.map(r=>r.value),1);root.innerHTML=rows.map((r,i)=>`<div class="rank-row"><div class="rank-name"><strong>${i+1}. ${esc(r.name)}</strong><small>${fmt(r.arboles)} árboles · ${fmt(r.horas,1)} h</small></div><div class="rank-track"><div class="rank-fill" style="width:${Math.max(3,r.value/max*100)}%"></div></div><div class="rank-value">${fmt(r.value,1)} árb/h</div></div>`).join('');
  }
  window.refreshChartOperators = () => {
    const select=$('#chartOperator'); if(!select)return; const current=select.value; const names=[...new Set(state.records.map(r=>(r.operador||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
    select.innerHTML='<option value="">Todos los operadores</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join(''); if(names.includes(current))select.value=current;
  };
  window.renderCharts = () => {
    if(!$('#graficos'))return; const rs=records(), rows=grouped(rs); const fuel=rs.reduce((s,r)=>s+(Number(r.combustible)||0),0), hours=rs.reduce((s,r)=>s+(Number(r.horas)||0),0), trees=rs.reduce((s,r)=>s+(Number(r.arboles)||0),0), count=rs.length;
    $('#chartFuelTotal').textContent=fmt(fuel,1)+' L'; $('#chartFuelAvg').textContent='Promedio: '+fmt(count?fuel/count:0,1)+' L/parte';
    $('#chartHoursTotal').textContent=fmt(hours,1)+' h'; $('#chartHoursAvg').textContent='Promedio: '+fmt(count?hours/count:0,1)+' h/parte';
    $('#chartTreesTotal').textContent=fmt(trees); $('#chartTreesAvg').textContent='Promedio: '+fmt(count?trees/count:0,1)+'/parte'; $('#chartPerformance').textContent=fmt(hours?trees/hours:0,1)+' árb/h';
    $('#fuelPeak').textContent=peak(rows,'combustible','L'); $('#hoursPeak').textContent=peak(rows,'horas','h'); $('#treesPeak').textContent=peak(rows,'arboles','');
    requestAnimationFrame(()=>{drawChart($('#fuelChart'),rows,'combustible',{top:'#f0a928',bottom:'#ffe4a7'});drawChart($('#hoursChart'),rows,'horas',{top:'#397fca',bottom:'#cfe4ff'});drawChart($('#treesChart'),rows,'arboles',{top:'#17995a',bottom:'#bcebd0'});}); ranking(rs);
  };
  function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  $$('.period-tabs button').forEach(btn=>btn.addEventListener('click',()=>{period=btn.dataset.period;$$('.period-tabs button').forEach(b=>b.classList.toggle('active',b===btn));window.renderCharts()}));
  $('#chartOperator')?.addEventListener('change',window.renderCharts); $('#chartRange')?.addEventListener('change',window.renderCharts); $('#chartsRefresh')?.addEventListener('click',()=>{window.refreshChartOperators();window.renderCharts()});
  $$('[data-view="graficos"]').forEach(b=>b.addEventListener('click',()=>setTimeout(window.renderCharts,30))); window.addEventListener('resize',()=>{if($('#graficos')?.classList.contains('active'))window.renderCharts()});
  window.refreshChartOperators();
})();
