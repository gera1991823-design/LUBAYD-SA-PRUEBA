/* Lubayd SA V22.1.0 - flujo de combustible robusto y offline */
(function () {
  'use strict';
  const {
    $, escapeHtml, formatDateTime, formatNumber, formatGps,
    fileToDataUrl, getGps, localDateKey, setBusy, toast, emit
  } = window.Lubayd;

  const DRAFT_KEY = 'lubayd_fuel_form_draft_v22_1';
  const PHOTO_KEY = 'draft_fuel_photo_v22_1';
  const GPS_KEY = 'draft_fuel_gps_v22_1';
  let records = [];
  let currentState = { tankLiters: 0, trailerLiters: 0, machines: {} };
  let photoData = '';
  let gpsData = null;
  let photoBusy = false;
  let gpsBusy = false;

  const labels = {
    tank_load: 'Proveedor → Tanque principal',
    trailer_load: 'Tanque principal → Tráiler',
    machine_delivery: 'Tráiler → Máquina',
    tank_adjust: 'Ajuste de tanque',
    trailer_adjust: 'Ajuste de tráiler'
  };

  function renderState() {
    $('#fuelTank').textContent = `${formatNumber(currentState.tankLiters, 1)} L`;
    $('#fuelTrailer').textContent = `${formatNumber(currentState.trailerLiters, 1)} L`;
    const machinesTotal = Object.values(currentState.machines || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    $('#fuelMachinesTotal').textContent = `${formatNumber(machinesTotal, 1)} L`;
    emit('lubayd-module-updated', { module: 'fuel', state: currentState, records });
  }

  function renderList() {
    const list = $('#fuelList');
    if (!records.length) {
      list.className = 'record-list empty';
      list.textContent = 'Sin movimientos.';
      return;
    }
    list.className = 'record-list';
    list.innerHTML = records.slice(0, 100).map(record => {
      const item = record.payload || {};
      const badgeClass = record.status === 'synced' ? '' : record.status;
      const detail = item.action === 'machine_delivery' ? ` · ${escapeHtml(item.machine || '')}` : '';
      const photo = item.photo ? `<img class="record-thumb" src="${item.photo}" alt="Foto de combustible">` : '';
      return `<article class="record-card evidence-record"><header><div><h4>${escapeHtml(labels[item.action] || item.action || 'Movimiento')}${detail}</h4><p>${formatDateTime(item.createdAtClient || record.createdAtClient)}</p></div><span class="status-badge ${badgeClass}">${record.status === 'synced' ? 'Sincronizado' : record.status === 'error' ? 'Error' : 'Pendiente'}</span></header><div class="event-row"><div><strong>${formatNumber(item.liters, 1)} L · ${escapeHtml(record.userName || item.userName || '')}</strong><span>${escapeHtml(formatGps(item.gps))}</span>${item.notes ? `<span>${escapeHtml(item.notes)}</span>` : ''}</div>${photo}</div>${record.lastError ? `<p class="record-error">${escapeHtml(record.lastError)}</p>` : ''}</article>`;
    }).join('');
  }

  async function refresh(refreshServer = true) {
    if (!window.Lubayd.state.user) return;
    currentState = await window.LubaydData.fuelState(refreshServer);
    records = await window.LubaydData.list('fuel', { refresh: refreshServer, limit: 150 });
    renderState();
    renderList();
  }

  function updateAction() {
    const showMachine = $('#fuelAction').value === 'machine_delivery';
    $('#fuelMachineLabel').classList.toggle('hidden', !showMachine);
    $('#fuelMachine').required = showMachine;
    saveDraft();
  }

  function renderPhoto() {
    const preview = $('#fuelPhotoPreview');
    const label = $('#fuelPhotoLabel');
    if (photoData) {
      preview.src = photoData;
      preview.classList.remove('hidden');
      label.textContent = 'Fotografía lista y guardada como borrador.';
    } else {
      preview.removeAttribute('src');
      preview.classList.add('hidden');
      label.textContent = 'Tomar o seleccionar fotografía';
    }
  }

  function renderGps() {
    $('#fuelGpsText').textContent = gpsData ? formatGps(gpsData) : 'Ubicación pendiente.';
    $('#fuelGpsText').classList.toggle('success-text', Boolean(gpsData));
  }

  function saveDraft() {
    const draft = {
      action: $('#fuelAction')?.value || 'tank_load',
      machine: $('#fuelMachine')?.value || '',
      liters: $('#fuelLiters')?.value || '',
      notes: $('#fuelNotes')?.value || '',
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  async function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft) {
        $('#fuelAction').value = draft.action || 'tank_load';
        $('#fuelMachine').value = draft.machine || '';
        $('#fuelLiters').value = draft.liters || '';
        $('#fuelNotes').value = draft.notes || '';
      }
    } catch (_) {}
    photoData = await window.LubaydOffline.getSetting(PHOTO_KEY, '').catch(() => '');
    gpsData = await window.LubaydOffline.getSetting(GPS_KEY, null).catch(() => null);
    if (gpsData?.capturedAtClient && Date.now() - new Date(gpsData.capturedAtClient).getTime() > 30 * 60 * 1000) gpsData = null;
    renderPhoto();
    renderGps();
    updateAction();
  }

  async function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    await Promise.all([
      window.LubaydOffline.remove('settings', PHOTO_KEY).catch(() => {}),
      window.LubaydOffline.remove('settings', GPS_KEY).catch(() => {})
    ]);
    photoData = '';
    gpsData = null;
    renderPhoto();
    renderGps();
  }

  async function processPhoto(file) {
    if (!file || photoBusy) return;
    photoBusy = true;
    $('#fuelPhotoLabel').textContent = 'Procesando fotografía...';
    try {
      photoData = await fileToDataUrl(file, {
        onStatus: status => { $('#fuelPhotoLabel').textContent = status; }
      });
      await window.LubaydOffline.setSetting(PHOTO_KEY, photoData);
      renderPhoto();
      $('#fuelMessage').textContent = 'Fotografía preparada. El borrador queda guardado en este teléfono.';
      $('#fuelMessage').className = 'form-message success';
    } catch (error) {
      photoData = '';
      renderPhoto();
      $('#fuelMessage').textContent = error.message || String(error);
      $('#fuelMessage').className = 'form-message';
    } finally {
      photoBusy = false;
      $('#fuelPhoto').value = '';
    }
  }

  async function captureGps() {
    if (gpsBusy) return null;
    gpsBusy = true;
    const button = $('#fuelGpsButton');
    setBusy(button, true, 'Buscando GPS');
    $('#fuelGpsText').textContent = 'Buscando ubicación...';
    try {
      gpsData = await getGps({
        forceFresh: true,
        onStatus: status => { $('#fuelGpsText').textContent = status; }
      });
      await window.LubaydOffline.setSetting(GPS_KEY, gpsData);
      renderGps();
      return gpsData;
    } catch (error) {
      gpsData = null;
      renderGps();
      $('#fuelMessage').textContent = error.message || String(error);
      $('#fuelMessage').className = 'form-message';
      throw error;
    } finally {
      gpsBusy = false;
      setBusy(button, false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (photoBusy || gpsBusy) return;
    setBusy(button, true, 'Guardando');
    $('#fuelMessage').textContent = '';
    try {
      if (!photoData) throw new Error('Debes tomar una fotografía antes de guardar.');
      if (!gpsData) await captureGps();
      const action = $('#fuelAction').value;
      const liters = Number($('#fuelLiters').value);
      if (!(liters > 0)) throw new Error('Ingresa una cantidad de litros mayor que cero.');
      const movement = {
        action,
        machine: action === 'machine_delivery' ? $('#fuelMachine').value.trim() : '',
        liters,
        notes: $('#fuelNotes').value.trim(),
        photo: photoData,
        gps: gpsData,
        dateKey: localDateKey(),
        createdAtClient: new Date().toISOString()
      };
      await window.LubaydData.saveFuel(movement);
      event.currentTarget.reset();
      await clearDraft();
      updateAction();
      $('#fuelMessage').textContent = 'Movimiento guardado en el teléfono. Se sincronizará automáticamente.';
      $('#fuelMessage').className = 'form-message success';
      toast('Combustible registrado', 'El movimiento quedó guardado localmente antes de iniciar la sincronización.');
      await refresh(false);
    } catch (error) {
      $('#fuelMessage').textContent = error.message || String(error);
      $('#fuelMessage').className = 'form-message';
    } finally {
      setBusy(button, false);
    }
  }

  function init() {
    $('#fuelAction').addEventListener('change', updateAction);
    ['fuelMachine', 'fuelLiters', 'fuelNotes'].forEach(id => $(`#${id}`).addEventListener('input', saveDraft));
    $('#fuelPhoto').addEventListener('change', event => processPhoto(event.target.files?.[0]));
    $('#fuelGpsButton').addEventListener('click', () => captureGps().catch(() => {}));
    $('#fuelForm').addEventListener('submit', submit);
    $('#refreshFuelButton').addEventListener('click', () => refresh(true));
    window.addEventListener('lubayd-session-ready', async () => { await restoreDraft(); await refresh(true); });
    window.addEventListener('lubayd-fuel-state-changed', event => { currentState = event.detail.state; renderState(); });
    window.addEventListener('lubayd-local-data-changed', event => { if (event.detail?.type === 'fuel') refresh(false); });
    window.addEventListener('lubayd-data-synced', event => { if (event.detail?.type === 'fuel') refresh(true); });
  }

  window.LubaydFuel = { refresh, getRecords: () => records.slice(), getState: () => currentState };
  init();
})();
