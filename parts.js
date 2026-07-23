/* Lubayd SA V22.1.1 - partes diarios robustos con borrador local */
(function () {
  'use strict';
  const {
    $, escapeHtml, formatDate, formatNumber, formatGps,
    getGps, fileToDataUrl, setBusy, toast, localDateKey, emit
  } = window.Lubayd;

  const DRAFT_KEY = 'lubayd_part_form_draft_v22_1';
  const PHOTO_KEY = 'draft_part_photo_v22_1';
  const GPS_KEY = 'draft_part_gps_v22_1';
  const SIGNATURE_KEY = 'draft_part_signature_v22_1';
  let records = [];
  let signatureDirty = false;
  let drawing = false;
  let lastPoint = null;
  let photoData = '';
  let gpsData = null;
  let photoBusy = false;
  let gpsBusy = false;

  function canViewAll() { return ['admin', 'supervisor'].includes(window.Lubayd.state.profile?.role); }
  function statusBadge(status) {
    const label = status === 'synced' ? 'Sincronizado' : status === 'error' ? 'Error' : 'Pendiente';
    return `<span class="status-badge ${status === 'synced' ? '' : status}">${label}</span>`;
  }

  function render() {
    const list = $('#partsList');
    if (!records.length) {
      list.className = 'record-list empty';
      list.textContent = 'Sin registros.';
      return;
    }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const hours = Math.max(0, Number(item.hourEnd || 0) - Number(item.hourStart || 0));
      const trees = Math.max(0, Number(item.treesEnd || 0) - Number(item.treesStart || 0));
      const photo = item.photo ? `<img class="record-thumb" src="${item.photo}" alt="Foto del parte">` : '';
      return `<article class="record-card evidence-record"><header><div><h4>${escapeHtml(item.machine || 'Máquina')}</h4><p>${escapeHtml(item.forest || 'Monte / Lote')} · ${formatDate(record.dateKey)}</p></div>${statusBadge(record.status)}</header><div class="event-row"><div><strong>${formatNumber(hours, 1)} h · ${formatNumber(trees)} árboles · ${formatNumber(item.fuel, 1)} L</strong><span>${escapeHtml(formatGps(item.gps))}</span><span>${escapeHtml(record.userName || item.createdByName || '')}</span>${item.notes ? `<span>${escapeHtml(item.notes)}</span>` : ''}</div>${photo}</div>${record.lastError ? `<p class="record-error">${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
    emit('lubayd-module-updated', { module: 'parts', records });
  }

  async function refresh() {
    if (!window.Lubayd.state.user) return;
    records = await window.LubaydData.list('part', { onlyMine: !canViewAll(), limit: 150 });
    render();
  }

  function canvasContext() {
    return $('#signatureCanvas')?.getContext('2d');
  }

  function drawSignatureData(dataUrl) {
    if (!dataUrl) return;
    const canvas = $('#signatureCanvas');
    const context = canvasContext();
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, rect.width, rect.height);
      context.drawImage(image, 0, 0, rect.width, rect.height);
      signatureDirty = true;
    };
    image.src = dataUrl;
  }

  async function persistSignature() {
    if (!signatureDirty) return;
    const data = $('#signatureCanvas').toDataURL('image/png');
    await window.LubaydOffline.setSetting(SIGNATURE_KEY, data).catch(() => {});
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
      if (previous) drawSignatureData(previous);
    };
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      const source = event.touches?.[0] || event.changedTouches?.[0] || event;
      return { x: source.clientX - rect.left, y: source.clientY - rect.top };
    };
    const start = event => {
      event.preventDefault();
      drawing = true;
      lastPoint = point(event);
      try { canvas.setPointerCapture?.(event.pointerId); } catch (_) {}
    };
    const move = event => {
      if (!drawing) return;
      event.preventDefault();
      const next = point(event);
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(next.x, next.y);
      context.stroke();
      lastPoint = next;
      signatureDirty = true;
    };
    const end = event => {
      if (drawing) event.preventDefault();
      drawing = false;
      lastPoint = null;
      persistSignature();
    };
    if ('PointerEvent' in window) {
      canvas.addEventListener('pointerdown', start, { passive: false });
      canvas.addEventListener('pointermove', move, { passive: false });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(name => canvas.addEventListener(name, end, { passive: false }));
    } else {
      canvas.addEventListener('mousedown', start, { passive: false });
      canvas.addEventListener('mousemove', move, { passive: false });
      ['mouseup', 'mouseleave'].forEach(name => canvas.addEventListener(name, end, { passive: false }));
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      ['touchend', 'touchcancel'].forEach(name => canvas.addEventListener(name, end, { passive: false }));
    }
    $('#clearSignatureButton').addEventListener('click', () => clearSignature(true));
    window.addEventListener('resize', () => setTimeout(resize, 100));
    resize();
  }

  async function clearSignature(removeDraft = false) {
    const canvas = $('#signatureCanvas');
    const context = canvasContext();
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    signatureDirty = false;
    if (removeDraft) await window.LubaydOffline.remove('settings', SIGNATURE_KEY).catch(() => {});
  }

  function signatureDataUrl() {
    if (!signatureDirty) throw new Error('La firma digital es obligatoria.');
    return $('#signatureCanvas').toDataURL('image/png');
  }

  function formDraft() {
    return {
      date: $('#partDate').value,
      shift: $('#partShift').value,
      machine: $('#partMachine').value,
      forest: $('#partForest').value,
      hourStart: $('#partHourStart').value,
      hourEnd: $('#partHourEnd').value,
      treesStart: $('#partTreesStart').value,
      treesEnd: $('#partTreesEnd').value,
      fuel: $('#partFuel').value,
      notes: $('#partNotes').value,
      savedAt: new Date().toISOString()
    };
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(formDraft()));
  }

  function restoreFormDraft() {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) {}
    $('#partDate').value = draft?.date || localDateKey();
    $('#partShift').value = draft?.shift || 'Mañana';
    $('#partMachine').value = draft?.machine || '';
    $('#partForest').value = draft?.forest || '';
    $('#partHourStart').value = draft?.hourStart || '';
    $('#partHourEnd').value = draft?.hourEnd || '';
    $('#partTreesStart').value = draft?.treesStart || '';
    $('#partTreesEnd').value = draft?.treesEnd || '';
    $('#partFuel').value = draft?.fuel || '';
    $('#partNotes').value = draft?.notes || '';
  }

  function renderPhoto() {
    const preview = $('#partPhotoPreview');
    if (photoData) {
      preview.src = photoData;
      preview.classList.remove('hidden');
      $('#partPhotoLabel').textContent = 'Fotografía lista y guardada como borrador.';
    } else {
      preview.removeAttribute('src');
      preview.classList.add('hidden');
      $('#partPhotoLabel').textContent = 'Tomar o seleccionar fotografía';
    }
  }

  function renderGps() {
    $('#partGpsText').textContent = gpsData ? formatGps(gpsData) : 'Ubicación pendiente.';
    $('#partGpsText').classList.toggle('success-text', Boolean(gpsData));
  }

  async function restoreEvidenceDraft() {
    photoData = await window.LubaydOffline.getSetting(PHOTO_KEY, '').catch(() => '');
    gpsData = await window.LubaydOffline.getSetting(GPS_KEY, null).catch(() => null);
    const signature = await window.LubaydOffline.getSetting(SIGNATURE_KEY, '').catch(() => '');
    if (gpsData?.capturedAtClient && Date.now() - new Date(gpsData.capturedAtClient).getTime() > 30 * 60 * 1000) gpsData = null;
    renderPhoto();
    renderGps();
    if (signature) drawSignatureData(signature);
  }

  async function processPhoto(file) {
    if (!file || photoBusy) return;
    photoBusy = true;
    $('#partPhotoLabel').textContent = 'Procesando fotografía...';
    try {
      photoData = await fileToDataUrl(file, {
        onStatus: status => { $('#partPhotoLabel').textContent = status; }
      });
      await window.LubaydOffline.setSetting(PHOTO_KEY, photoData);
      renderPhoto();
      $('#partMessage').textContent = 'Fotografía preparada y guardada como borrador local.';
      $('#partMessage').className = 'form-message success';
    } catch (error) {
      photoData = '';
      renderPhoto();
      $('#partMessage').textContent = error.message || String(error);
      $('#partMessage').className = 'form-message';
    } finally {
      photoBusy = false;
      $('#partPhoto').value = '';
    }
  }

  async function captureGps() {
    if (gpsBusy) return null;
    gpsBusy = true;
    const button = $('#partGpsButton');
    setBusy(button, true, 'Buscando GPS');
    $('#partGpsText').textContent = 'Buscando ubicación...';
    try {
      gpsData = await getGps({
        forceFresh: true,
        onStatus: status => { $('#partGpsText').textContent = status; }
      });
      await window.LubaydOffline.setSetting(GPS_KEY, gpsData);
      renderGps();
      return gpsData;
    } catch (error) {
      gpsData = null;
      renderGps();
      $('#partMessage').textContent = error.message || String(error);
      $('#partMessage').className = 'form-message';
      throw error;
    } finally {
      gpsBusy = false;
      setBusy(button, false);
    }
  }

  async function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    await Promise.all([
      window.LubaydOffline.remove('settings', PHOTO_KEY).catch(() => {}),
      window.LubaydOffline.remove('settings', GPS_KEY).catch(() => {}),
      window.LubaydOffline.remove('settings', SIGNATURE_KEY).catch(() => {})
    ]);
    photoData = '';
    gpsData = null;
    renderPhoto();
    renderGps();
    await clearSignature(false);
  }

  async function submit(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (photoBusy || gpsBusy) return;
    setBusy(button, true, 'Guardando');
    $('#partMessage').textContent = '';
    try {
      if (!photoData) throw new Error('La fotografía del parte es obligatoria.');
      const signature = signatureDataUrl();
      if (!gpsData) await captureGps();
      const hourStart = Number($('#partHourStart').value || 0);
      const hourEnd = Number($('#partHourEnd').value || 0);
      if (hourEnd < hourStart) throw new Error('El horómetro final no puede ser menor que el inicial.');
      const treesStart = Number($('#partTreesStart').value || 0);
      const treesEnd = Number($('#partTreesEnd').value || 0);
      if (treesEnd < treesStart) throw new Error('Los árboles finales no pueden ser menores que los iniciales.');
      const machine = $('#partMachine').value.trim();
      const forest = $('#partForest').value.trim();
      const notes = $('#partNotes').value.trim();
      if (!machine || !forest || !notes) throw new Error('Completa máquina, monte/lote y trabajo realizado.');

      await window.LubaydData.save('part', {
        dateKey: $('#partDate').value || localDateKey(),
        shift: $('#partShift').value,
        machine,
        forest,
        hourStart,
        hourEnd,
        hours: hourEnd - hourStart,
        treesStart,
        treesEnd,
        trees: treesEnd - treesStart,
        fuel: Number($('#partFuel').value || 0),
        notes,
        photo: photoData,
        signature,
        gps: gpsData,
        capturedAtClient: new Date().toISOString()
      });

      event.currentTarget.reset();
      await clearDraft();
      $('#partDate').value = localDateKey();
      $('#partMessage').textContent = 'Parte guardado en el teléfono. Se sincronizará automáticamente.';
      $('#partMessage').className = 'form-message success';
      toast('Parte guardado', 'La información quedó almacenada localmente antes de iniciar la sincronización.');
      await refresh();
    } catch (error) {
      $('#partMessage').textContent = error.message || String(error);
      $('#partMessage').className = 'form-message';
    } finally {
      setBusy(button, false);
    }
  }

  function init() {
    setupSignature();
    restoreFormDraft();
    $('#partForm').querySelectorAll('input:not([type="file"]), select, textarea').forEach(element => element.addEventListener('input', saveDraft));
    $('#partPhoto').addEventListener('change', event => processPhoto(event.target.files?.[0]));
    $('#partGpsButton').addEventListener('click', () => captureGps().catch(() => {}));
    $('#partForm').addEventListener('submit', submit);
    $('#refreshPartsButton').addEventListener('click', refresh);
    window.addEventListener('lubayd-session-ready', async () => { restoreFormDraft(); await restoreEvidenceDraft(); await refresh(); });
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'part') refresh(); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'part') refresh(); });
  }

  window.LubaydParts = { refresh, getRecords: () => records.slice() };
  init();
})();
