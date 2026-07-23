/* Lubayd SA V22.0.0 - partes diarios con foto, GPS y firma digital */
(function () {
  'use strict';
  const { $, escapeHtml, formatDate, formatNumber, getGps, fileToDataUrl, setBusy, toast, localDateKey, emit } = window.Lubayd;
  let records = [];
  let signatureDirty = false;
  let drawing = false;
  let lastPoint = null;

  function canViewAll() { return ['admin', 'supervisor'].includes(window.Lubayd.state.profile?.role); }
  function statusBadge(status) {
    const label = status === 'synced' ? 'Sincronizado' : status === 'error' ? 'Error' : 'Pendiente';
    return `<span class="status-badge ${status === 'synced' ? '' : status}">${label}</span>`;
  }
  function render() {
    const list = $('#partsList');
    if (!records.length) { list.className = 'record-list empty'; list.textContent = 'Sin registros.'; return; }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const hours = Math.max(0, Number(item.hourEnd || 0) - Number(item.hourStart || 0));
      const trees = Math.max(0, Number(item.treesEnd || 0) - Number(item.treesStart || 0));
      const evidence = `${item.photoId || item.photo ? '📷 Foto' : 'Sin foto'} · ${item.gps ? '📍 GPS' : 'Sin GPS'} · ${item.signatureId || item.signature ? '✍ Firma' : 'Sin firma'}`;
      return `<article class="record-card"><header><div><h4>${escapeHtml(item.machine || 'Máquina')}</h4><p>${escapeHtml(item.forest || 'Monte / Lote')} · ${formatDate(record.dateKey)}</p></div>${statusBadge(record.status)}</header><div class="record-meta"><span>${formatNumber(hours,1)} h</span><span>${formatNumber(trees)} árboles</span><span>${formatNumber(item.fuel,1)} L</span><span>${escapeHtml(record.userName || item.createdByName || '')}</span></div><div class="record-meta"><span>${evidence}</span></div>${item.notes ? `<p style="margin-top:.6rem">${escapeHtml(item.notes)}</p>` : ''}${record.lastError ? `<p>${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
    emit('lubayd-module-updated', { module: 'parts', records });
  }
  async function refresh() {
    if (!window.Lubayd.state.user) return;
    records = await window.LubaydData.list('part', { onlyMine: !canViewAll(), limit: 150 });
    render();
  }

  function setupSignature() {
    const canvas = $('#signatureCanvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const resize = () => {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const previous = signatureDirty ? canvas.toDataURL('image/png') : '';
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineWidth = 2.2;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#123a2a';
      if (previous) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = previous;
      }
    };
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      const source = event.touches?.[0] || event.changedTouches?.[0] || event;
      return { x: source.clientX - rect.left, y: source.clientY - rect.top };
    };
    const start = event => { event.preventDefault(); drawing = true; lastPoint = point(event); };
    const move = event => {
      if (!drawing) return;
      event.preventDefault();
      const next = point(event);
      context.beginPath(); context.moveTo(lastPoint.x, lastPoint.y); context.lineTo(next.x, next.y); context.stroke();
      lastPoint = next; signatureDirty = true;
    };
    const end = event => { if (drawing) event.preventDefault(); drawing = false; lastPoint = null; };
    if ('PointerEvent' in window) {
      canvas.addEventListener('pointerdown', start, { passive: false });
      canvas.addEventListener('pointermove', move, { passive: false });
      ['pointerup','pointercancel','pointerleave'].forEach(name => canvas.addEventListener(name, end, { passive: false }));
    } else {
      canvas.addEventListener('mousedown', start, { passive: false });
      canvas.addEventListener('mousemove', move, { passive: false });
      ['mouseup','mouseleave'].forEach(name => canvas.addEventListener(name, end, { passive: false }));
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      ['touchend','touchcancel'].forEach(name => canvas.addEventListener(name, end, { passive: false }));
    }
    $('#clearSignatureButton').addEventListener('click', () => {
      const rect = canvas.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      signatureDirty = false;
    });
    window.addEventListener('resize', () => setTimeout(resize, 80));
    resize();
  }
  function clearSignature() {
    const canvas = $('#signatureCanvas');
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    signatureDirty = false;
  }
  function signatureDataUrl() {
    if (!signatureDirty) throw new Error('La firma digital es obligatoria.');
    return $('#signatureCanvas').toDataURL('image/png');
  }

  async function submit(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, 'Guardando');
    $('#partMessage').textContent = '';
    try {
      const photoFile = $('#partPhoto').files?.[0];
      if (!photoFile) throw new Error('La fotografía del parte es obligatoria.');
      const signature = signatureDataUrl();
      $('#partGpsText').textContent = 'Obteniendo ubicación…';
      const [gps, photo] = await Promise.all([getGps(), fileToDataUrl(photoFile)]);
      const hourStart = Number($('#partHourStart').value || 0);
      const hourEnd = Number($('#partHourEnd').value || 0);
      if (hourEnd < hourStart) throw new Error('El horómetro final no puede ser menor que el inicial.');
      const treesStart = Number($('#partTreesStart').value || 0);
      const treesEnd = Number($('#partTreesEnd').value || 0);
      if (treesEnd < treesStart) throw new Error('Los árboles finales no pueden ser menores que los iniciales.');
      await window.LubaydData.save('part', {
        dateKey: $('#partDate').value || localDateKey(), shift: $('#partShift').value,
        machine: $('#partMachine').value.trim(), forest: $('#partForest').value.trim(),
        hourStart, hourEnd, hours: hourEnd - hourStart,
        treesStart, treesEnd, trees: treesEnd - treesStart,
        fuel: Number($('#partFuel').value || 0), notes: $('#partNotes').value.trim(),
        photo, signature, gps, capturedAtClient: new Date().toISOString()
      });
      event.currentTarget.reset();
      $('#partDate').value = localDateKey();
      $('#partPhotoLabel').textContent = 'Tomar o seleccionar fotografía';
      $('#partGpsText').textContent = 'Se capturará al guardar.';
      clearSignature();
      $('#partMessage').textContent = navigator.onLine ? 'Parte guardado. Se está sincronizando.' : 'Parte guardado en el teléfono.';
      $('#partMessage').className = 'form-message success';
      toast('Parte guardado', navigator.onLine ? 'La sincronización se realizará automáticamente.' : 'Quedó pendiente hasta recuperar internet.');
      await refresh();
    } catch (error) {
      $('#partMessage').textContent = error.message || String(error);
      $('#partMessage').className = 'form-message';
      $('#partGpsText').textContent = 'Se capturará al guardar.';
    } finally { setBusy(button, false); }
  }
  function init() {
    $('#partDate').value = localDateKey();
    setupSignature();
    $('#partPhoto').addEventListener('change', event => { $('#partPhotoLabel').textContent = event.target.files?.[0]?.name || 'Tomar o seleccionar fotografía'; });
    $('#partForm').addEventListener('submit', submit);
    $('#refreshPartsButton').addEventListener('click', refresh);
    window.addEventListener('lubayd-session-ready', refresh);
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'part') refresh(); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'part') refresh(); });
  }
  window.LubaydParts = { refresh, getRecords: () => records.slice() };
  init();
})();
