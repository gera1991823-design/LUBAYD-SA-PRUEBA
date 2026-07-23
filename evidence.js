/* Lubayd SA V22.1.1 - captura estable de fotografia y GPS */
(function () {
  'use strict';

  const { $, getGps, fileToDataUrl, formatGps, setBusy } = window.Lubayd;
  let active = null;
  let gps = null;
  let photo = '';
  let gpsBusy = false;
  let photoBusy = false;

  function message(text, kind = '') {
    const element = $('#evidenceMessage');
    element.textContent = text || '';
    element.className = `form-message${kind ? ` ${kind}` : ''}`;
  }

  function updateConfirm() {
    const button = $('#evidenceConfirm');
    button.disabled = !gps || !photo || gpsBusy || photoBusy;
  }

  function renderGps() {
    const text = $('#evidenceGpsText');
    const status = $('#evidenceGpsStatus');
    if (!gps) {
      text.textContent = gpsBusy ? 'Buscando ubicacion...' : 'Ubicacion pendiente';
      status.textContent = gpsBusy ? 'Esperando senal GPS' : 'Toca Reintentar GPS';
      status.className = 'evidence-status';
      return;
    }
    text.textContent = formatGps(gps);
    status.textContent = `Precision aproximada: ${Math.round(Number(gps.accuracy || 0))} m`;
    status.className = 'evidence-status success';
  }

  function renderPhoto() {
    const preview = $('#evidencePhotoPreview');
    const placeholder = $('#evidencePhotoPlaceholder');
    if (photo) {
      preview.src = photo;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } else {
      preview.removeAttribute('src');
      preview.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
  }

  async function saveDraft() {
    if (!active?.draftKey || !window.LubaydOffline) return;
    const value = {
      title: active.title,
      gps,
      photo,
      savedAt: new Date().toISOString()
    };
    await window.LubaydOffline.setSetting(active.draftKey, value).catch(() => {});
  }

  async function clearDraft() {
    if (!active?.draftKey || !window.LubaydOffline) return;
    await window.LubaydOffline.remove('settings', active.draftKey).catch(() => {});
  }

  async function restoreDraft() {
    if (!active?.draftKey || !window.LubaydOffline) return;
    const draft = await window.LubaydOffline.getSetting(active.draftKey, null).catch(() => null);
    if (!draft?.savedAt) return;
    if (Date.now() - new Date(draft.savedAt).getTime() > 30 * 60 * 1000) {
      await window.LubaydOffline.remove('settings', active.draftKey).catch(() => {});
      return;
    }
    gps = draft.gps || null;
    photo = draft.photo || '';
    renderGps();
    renderPhoto();
    updateConfirm();
    if (gps || photo) message('Se recupero una captura pendiente de este dispositivo.', 'success');
  }

  async function captureGps() {
    if (gpsBusy) return;
    gpsBusy = true;
    gps = null;
    renderGps();
    updateConfirm();
    const button = $('#evidenceGpsButton');
    setBusy(button, true, 'Buscando GPS');
    message('Mantenete al aire libre o cerca de una ventana mientras se obtiene la ubicacion.');
    try {
      gps = await getGps({
        forceFresh: true,
        onStatus: status => {
          $('#evidenceGpsStatus').textContent = status;
        }
      });
      renderGps();
      message('Ubicacion obtenida correctamente.', 'success');
      await saveDraft();
    } catch (error) {
      gps = null;
      renderGps();
      message(error.message || String(error));
    } finally {
      gpsBusy = false;
      setBusy(button, false);
      updateConfirm();
    }
  }

  async function capturePhoto(file) {
    if (!file || photoBusy) return;
    photoBusy = true;
    photo = '';
    renderPhoto();
    updateConfirm();
    message('Procesando la fotografia. No cierres la aplicacion.');
    try {
      photo = await fileToDataUrl(file, {
        onStatus: status => message(status)
      });
      renderPhoto();
      message('Fotografia lista para guardar.', 'success');
      await saveDraft();
    } catch (error) {
      photo = '';
      renderPhoto();
      message(error.message || String(error));
    } finally {
      photoBusy = false;
      updateConfirm();
      $('#evidencePhotoInput').value = '';
    }
  }

  function close(result, clear = false) {
    const modal = $('#evidenceModal');
    modal.classList.add('hidden');
    const resolver = active?.resolve;
    const rejecter = active?.reject;
    const shouldResolve = Boolean(result);
    const finish = async () => {
      if (clear) await clearDraft();
      active = null;
      gps = null;
      photo = '';
      message('');
      renderGps();
      renderPhoto();
      updateConfirm();
      if (shouldResolve) resolver?.(result);
      else rejecter?.(Object.assign(new Error('Operacion cancelada.'), { code: 'cancelled' }));
    };
    finish();
  }

  async function open(options = {}) {
    if (active) throw new Error('Ya hay una captura en curso.');
    return new Promise(async (resolve, reject) => {
      active = {
        resolve,
        reject,
        title: options.title || 'Capturar evidencia',
        subtitle: options.subtitle || 'La fotografia y la ubicacion son obligatorias.',
        draftKey: options.draftKey || ''
      };
      gps = null;
      photo = '';
      gpsBusy = false;
      photoBusy = false;
      $('#evidenceTitle').textContent = active.title;
      $('#evidenceSubtitle').textContent = active.subtitle;
      $('#evidenceModal').classList.remove('hidden');
      renderGps();
      renderPhoto();
      updateConfirm();
      await restoreDraft();
      if (!gps) captureGps();
    });
  }

  function init() {
    $('#evidenceGpsButton').addEventListener('click', captureGps);
    $('#evidencePhotoInput').addEventListener('change', event => capturePhoto(event.target.files?.[0]));
    $('#evidenceCancel').addEventListener('click', () => close(null, true));
    $('#evidenceConfirm').addEventListener('click', () => {
      if (!gps || !photo) return message('Falta obtener la ubicacion o tomar la fotografia.');
      close({ gps, photo, capturedAtClient: new Date().toISOString() }, true);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && active && !gps && !gpsBusy) captureGps();
    });
  }

  window.LubaydEvidence = { capture: open, captureGps, capturePhoto };
  init();
})();
