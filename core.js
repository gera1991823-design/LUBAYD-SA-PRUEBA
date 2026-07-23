/* Lubayd SA V22.1.1 - utilidades compartidas y captura estable */
(function () {
  'use strict';
  const config = window.LUBAYD_CONFIG;
  const state = {
    user: null,
    profile: null,
    offlineSession: false,
    firebaseReady: false,
    serviceWorkerRegistration: null,
    waitingWorker: null,
    currentView: 'dashboard'
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const uid = prefix => `${prefix || 'id'}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(2)).join('_')}`;

  const localDateKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };

  const formatDate = value => {
    if (!value) return '—';
    const text = String(value).slice(0, 10);
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: config.timeZone, day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(new Date(`${text}T12:00:00`));
  };

  const toDate = value => {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value.seconds) return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDateTime = value => {
    const date = toDate(value);
    if (!date) return '—';
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: config.timeZone,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
  };

  const formatTime = value => {
    const date = toDate(value);
    if (!date) return '--:--';
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
  };

  const formatNumber = (value, digits = 0) => new Intl.NumberFormat('es-UY', {
    maximumFractionDigits: digits
  }).format(Number(value) || 0);

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  const initials = value => {
    const parts = String(value || 'U').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0].slice(0, 2)).toUpperCase();
  };

  function toast(title, text) {
    const element = $('#toast');
    if (!element) return;
    $('#toastTitle').textContent = title || 'Lubayd SA';
    $('#toastText').textContent = text || '';
    element.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.add('hidden'), 4300);
  }

  function confirmDialog(title, text) {
    return new Promise(resolve => {
      const modal = $('#modal');
      $('#modalTitle').textContent = title || 'Confirmar';
      $('#modalText').textContent = text || '';
      modal.classList.remove('hidden');
      const finish = result => {
        modal.classList.add('hidden');
        $('#modalConfirm').onclick = null;
        $('#modalCancel').onclick = null;
        resolve(result);
      };
      $('#modalConfirm').onclick = () => finish(true);
      $('#modalCancel').onclick = () => finish(false);
    });
  }

  let lastGps = null;
  function validCoordinate(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max;
  }

  function normalizeGps(position) {
    const coords = position?.coords || position || {};
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    const accuracy = Math.max(0, Number(coords.accuracy || 0));
    if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) {
      throw new Error('El GPS devolvio coordenadas invalidas.');
    }
    return {
      latitude,
      longitude,
      accuracy,
      altitude: Number.isFinite(Number(coords.altitude)) ? Number(coords.altitude) : null,
      heading: Number.isFinite(Number(coords.heading)) ? Number(coords.heading) : null,
      speed: Number.isFinite(Number(coords.speed)) ? Number(coords.speed) : null,
      capturedAtClient: new Date().toISOString()
    };
  }

  function formatGps(gps) {
    if (!gps) return 'Ubicacion no disponible';
    return `${Number(gps.latitude).toFixed(6)}, ${Number(gps.longitude).toFixed(6)} · ±${Math.round(Number(gps.accuracy || 0))} m`;
  }

  async function permissionState(name) {
    if (!navigator.permissions?.query) return 'unknown';
    try { return (await navigator.permissions.query({ name })).state || 'unknown'; }
    catch (_) { return 'unknown'; }
  }

  function getGps(options = {}) {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      return Promise.reject(new Error('La ubicacion solo funciona desde una direccion HTTPS segura.'));
    }
    if (!navigator.geolocation) return Promise.reject(new Error('Este dispositivo no dispone de ubicacion GPS.'));

    const forceFresh = Boolean(options.forceFresh);
    const recentMs = Number(options.recentMs ?? config.gpsRecentMs ?? 30000);
    const desiredAccuracy = Number(options.desiredAccuracy ?? config.gpsTargetAccuracy ?? 40);
    const maximumAccuracy = Number(options.maximumAccuracy ?? config.gpsMaximumAccuracy ?? 300);
    const timeoutMs = Number(options.timeout ?? config.gpsTimeoutMs ?? 25000);
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

    if (!forceFresh && lastGps && Date.now() - new Date(lastGps.capturedAtClient).getTime() <= recentMs) {
      return Promise.resolve(clone(lastGps));
    }

    return new Promise(async (resolve, reject) => {
      const permission = await permissionState('geolocation');
      if (permission === 'denied') {
        reject(new Error('La ubicacion esta bloqueada. Habilitala en los permisos del navegador para Lubayd SA.'));
        return;
      }

      let best = null;
      let finished = false;
      let watchId = null;
      const startedAt = Date.now();

      const cleanup = () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        clearTimeout(timer);
      };

      const finishSuccess = point => {
        if (finished) return;
        finished = true;
        cleanup();
        lastGps = point;
        resolve(clone(point));
      };

      const finishError = error => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      };

      const timer = setTimeout(() => {
        if (best && Number(best.accuracy || Infinity) <= maximumAccuracy) {
          onStatus(`Usando la mejor ubicacion disponible (±${Math.round(best.accuracy)} m).`);
          finishSuccess(best);
        } else {
          finishError(new Error('No se pudo obtener una ubicacion suficientemente precisa. Activa el GPS, sal al exterior y toca Reintentar GPS.'));
        }
      }, timeoutMs);

      onStatus('Solicitando permiso de ubicacion...');
      watchId = navigator.geolocation.watchPosition(position => {
        let point;
        try { point = normalizeGps(position); }
        catch (error) { finishError(error); return; }
        if (!best || Number(point.accuracy || Infinity) < Number(best.accuracy || Infinity)) best = point;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        onStatus(`GPS activo: precision ±${Math.round(point.accuracy)} m · ${elapsed} s`);
        if (Number(point.accuracy || Infinity) <= desiredAccuracy) finishSuccess(point);
      }, error => {
        if (error.code === 1) {
          finishError(new Error('Debes permitir la ubicacion para guardar el registro. Revisa los permisos del sitio.'));
          return;
        }
        if (best && Number(best.accuracy || Infinity) <= maximumAccuracy) {
          finishSuccess(best);
          return;
        }
        if (error.code === 2) onStatus('El GPS no encuentra senal. Verifica que la ubicacion del telefono este activada.');
        if (error.code === 3) onStatus('El GPS esta demorando. Se seguira intentando hasta agotar el tiempo.');
      }, {
        enableHighAccuracy: true,
        timeout: Math.min(timeoutMs, 15000),
        maximumAge: forceFresh ? 0 : recentMs
      });
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo convertir la fotografia.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }

  async function imageSource(file, maxDimension) {
    if ('createImageBitmap' in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        return {
          source: bitmap,
          width: Math.max(1, Math.round(bitmap.width * scale)),
          height: Math.max(1, Math.round(bitmap.height * scale)),
          close: () => bitmap.close?.()
        };
      } catch (_) {}
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('La fotografia no es valida o esta danada.'));
        element.src = url;
      });
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      return {
        source: image,
        width: Math.max(1, Math.round(image.naturalWidth * scale)),
        height: Math.max(1, Math.round(image.naturalHeight * scale)),
        close: () => URL.revokeObjectURL(url)
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async function canvasToJpeg(canvas, quality) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('No se pudo comprimir la fotografia.');
    return blob;
  }

  async function fileToDataUrl(file, options = {}) {
    if (!file) throw new Error('Debes tomar o seleccionar una fotografia.');
    if (!String(file.type || '').startsWith('image/')) throw new Error('El archivo seleccionado no es una fotografia.');
    const maxOriginalBytes = Number(config.maxOriginalPhotoBytes || 30 * 1024 * 1024);
    if (Number(file.size || 0) > maxOriginalBytes) throw new Error('La fotografia original es demasiado grande. Toma una foto con menor resolucion.');

    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    const maxDimension = Number(options.maxDimension || config.maxPhotoDimension || config.maxPhotoWidth || 1024);
    const maxBytes = Number(options.maxBytes || config.maxPhotoBytes || 520000);
    const initialQuality = Number(options.quality || config.photoQuality || 0.62);
    onStatus('Reduciendo la fotografia para evitar cierres de la aplicacion...');

    const decoded = await imageSource(file, maxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) {
      decoded.close();
      throw new Error('El navegador no pudo procesar la fotografía.');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    let quality = Math.max(0.38, Math.min(0.82, initialQuality));
    let blob = await canvasToJpeg(canvas, quality);
    while (blob.size > maxBytes && quality > 0.38) {
      quality = Math.max(0.38, quality - 0.08);
      blob = await canvasToJpeg(canvas, quality);
    }

    decoded.close();
    canvas.width = 1;
    canvas.height = 1;

    if (blob.size > maxBytes * 1.35) throw new Error('No se pudo reducir la fotografia a un tamano seguro.');
    onStatus(`Fotografia optimizada (${Math.round(blob.size / 1024)} KB).`);
    return blobToDataUrl(blob);
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
    button.disabled = Boolean(busy);
    if (busy) button.textContent = `${busyLabel || 'Procesando'}…`;
    else button.innerHTML = button.dataset.defaultHtml;
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  window.Lubayd = {
    config, state, $, $$, clone, normalizeEmail, uid, localDateKey,
    formatDate, formatDateTime, formatTime, formatNumber, escapeHtml, initials,
    toast, confirmDialog, getGps, formatGps, fileToDataUrl, setBusy, emit
  };
})();
