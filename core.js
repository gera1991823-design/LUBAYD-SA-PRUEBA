/* Lubayd SA V22.0.0 - utilidades compartidas */
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
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const map = Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };
  const formatDate = value => {
    if (!value) return '—';
    const text = String(value).slice(0, 10);
    return new Intl.DateTimeFormat('es-UY', { timeZone: config.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${text}T12:00:00`));
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
    return new Intl.DateTimeFormat('es-UY', { timeZone: config.timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  };
  const formatTime = value => {
    const date = toDate(value);
    if (!date) return '--:--';
    return new Intl.DateTimeFormat('es-UY', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  };
  const formatNumber = (value, digits = 0) => new Intl.NumberFormat('es-UY', { maximumFractionDigits: digits }).format(Number(value) || 0);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
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
  function getGps() {
    if (!navigator.geolocation) return Promise.reject(new Error('Este dispositivo no dispone de GPS.'));
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve({
      latitude: Number(position.coords.latitude),
      longitude: Number(position.coords.longitude),
      accuracy: Number(position.coords.accuracy || 0),
      capturedAtClient: new Date().toISOString()
    }), error => {
      const message = error.code === 1 ? 'Debes permitir la ubicación para continuar.' : 'No se pudo obtener la ubicación.';
      reject(new Error(message));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
  }
  function fileToDataUrl(file) {
    if (!file) return Promise.reject(new Error('Debes tomar o seleccionar una fotografía.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la fotografía.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('La fotografía no es válida.'));
        image.onload = () => {
          const ratio = Math.min(1, config.maxPhotoWidth / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * ratio));
          const height = Math.max(1, Math.round(image.height * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', config.photoQuality));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
    button.disabled = Boolean(busy);
    button.textContent = busy ? `${busyLabel || 'Procesando'}…` : button.dataset.defaultLabel;
  }
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
  window.Lubayd = { config, state, $, $$, clone, normalizeEmail, uid, localDateKey, formatDate, formatDateTime, formatTime, formatNumber, escapeHtml, initials, toast, confirmDialog, getGps, fileToDataUrl, setBusy, emit };
})();
