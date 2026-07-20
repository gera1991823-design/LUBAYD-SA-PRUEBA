'use strict';

(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const escapeHtml = window.escapeHtml || (value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])));
  const number = (value, digits = 0) => Number(value || 0).toLocaleString('es-UY', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const dateKey = date => {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const todayKey = () => dateKey(new Date());
  const formatDate = value => {
    if (!value) return '—';
    const source = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value;
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const formatDateTime = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' });
  };
  const initials = name => String(name || 'US').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'US';

  const state = {
    profile: null,
    user: null,
    incidents: [],
    machines: [],
    montes: [],
    users: [],
    unsubscribers: [],
    incidentGps: null,
    reportRecords: [],
    lastCloudMeta: null
  };

  const palette = ['#168c4f', '#58aa60', '#98c95c', '#d7df67', '#0b736e', '#e6a63d', '#4e83c4'];

  function notify(title, text = '', type = 'success') {
    const toast = $('#toast');
    if (!toast) return;
    $('#toastTitle').textContent = title;
    $('#toastText').textContent = text;
    toast.classList.remove('hidden', 'error', 'warning');
    if (type !== 'success') toast.classList.add(type);
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
  }

  function isAdmin() {
    return state.profile?.role === 'admin';
  }

  function cleanupSubscriptions() {
    state.unsubscribers.forEach(unsubscribe => {
      try { unsubscribe?.(); } catch (error) { console.warn(error); }
    });
    state.unsubscribers = [];
  }

  function applyRoleInterface() {
    const admin = isAdmin();
    $$('.admin-only').forEach(element => element.classList.toggle('hidden-by-role', !admin));
    $('#operatorDashboard')?.classList.toggle('hidden', admin);
    $('#adminDashboard')?.classList.toggle('hidden', !admin);
    document.body.classList.toggle('is-admin', admin);
    document.body.classList.toggle('is-operator', !admin);
  }

  function subscribeData() {
    cleanupSubscriptions();
    if (!window.LubaydOps?.available || !state.user) return;

    const subscribe = (collection, handler, options) => {
      try {
        const unsubscribe = window.LubaydOps.subscribeCollection(collection, handler, error => {
          console.error(`Suscripción ${collection}:`, error);
          notify('No se pudieron actualizar los datos', error.message || String(error), 'error');
        }, options);
        state.unsubscribers.push(unsubscribe);
      } catch (error) {
        console.warn(`Suscripción ${collection}:`, error);
      }
    };

    subscribe('incidencias', (items, meta) => {
      state.incidents = items.sort((a, b) => String(b.createdAtClient || b.updatedAtClient || '').localeCompare(String(a.createdAtClient || a.updatedAtClient || '')));
      state.lastCloudMeta = meta;
      renderIncidents();
      renderAdminDashboard();
      updateAlertBadges();
    });

    if (isAdmin()) {
      subscribe('maquinas', items => {
        state.machines = items.sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'es'));
        renderMachines();
        renderAdminDashboard();
        fillReportFilters();
      });
      subscribe('montes', items => {
        state.montes = items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
        renderMontes();
        fillReportFilters();
      });
      try {
        const unsubscribeUsers = window.LubaydOps.subscribeUsers(items => {
          state.users = items;
          renderUsers();
          renderAdminDashboard();
        }, error => {
          console.error('Usuarios:', error);
          notify('No se pudieron cargar los usuarios', error.message || String(error), 'error');
        });
        state.unsubscribers.push(unsubscribeUsers);
      } catch (error) {
        console.warn('Usuarios:', error);
      }
    }
  }

  function records() {
    return Array.isArray(window.AppState?.records) ? window.AppState.records : [];
  }

  function recordsForDate(key) {
    return records().filter(record => record.fecha === key);
  }

  function previousDateKey(key) {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() - 1);
    return dateKey(date);
  }

  function deltaLabel(current, previous, suffix = '') {
    if (!previous) return current ? `${number(current)}${suffix} registrado` : 'Sin comparación';
    const percentage = ((current - previous) / Math.abs(previous)) * 100;
    const sign = percentage >= 0 ? '+' : '';
    return `${sign}${number(percentage, 1)}% vs. día anterior`;
  }

  function renderOperatorStatus() {
    if (isAdmin()) return;
    const uid = state.user?.uid;
    const mineToday = recordsForDate(todayKey()).filter(record => !uid || record.createdByUid === uid);
    const title = $('#operatorStatusTitle');
    const text = $('#operatorStatusText');
    if (!title || !text) return;
    if (mineToday.length) {
      const trees = mineToday.reduce((sum, record) => sum + Number(record.arboles || 0), 0);
      title.textContent = `${mineToday.length} parte${mineToday.length === 1 ? '' : 's'} registrado${mineToday.length === 1 ? '' : 's'} hoy`;
      text.textContent = `${number(trees)} árboles procesados. Los datos están disponibles en todos tus dispositivos.`;
    } else {
      title.textContent = 'Todo listo para comenzar';
      text.textContent = 'Todavía no registraste un parte en la jornada de hoy.';
    }
  }

  function renderAdminDashboard() {
    if (!isAdmin()) return;
    const selectedDate = $('#adminDashboardDate')?.value || todayKey();
    const current = recordsForDate(selectedDate);
    const previous = recordsForDate(previousDateKey(selectedDate));
    const sum = (list, field) => list.reduce((total, item) => total + Number(item[field] || 0), 0);
    const trees = sum(current, 'arboles');
    const previousTrees = sum(previous, 'arboles');
    const fuel = sum(current, 'combustible');
    const previousFuel = sum(previous, 'combustible');

    setText('#adminKpiParts', number(current.length));
    setText('#adminKpiPartsDelta', deltaLabel(current.length, previous.length));
    setText('#adminKpiOperators', number(state.users.filter(user => user.active === true).length));
    const activeMachines = state.machines.filter(machine => machine.status === 'activa').length;
    setText('#adminKpiMachines', number(activeMachines || new Set(current.map(record => record.maquina).filter(Boolean)).size));
    setText('#adminKpiMachinesMeta', state.machines.length ? `De ${state.machines.length} registradas` : 'Según partes del día');
    setText('#adminKpiTrees', number(trees));
    setText('#adminKpiTreesDelta', deltaLabel(trees, previousTrees));
    setText('#adminKpiFuel', `${number(fuel, 1)} L`);
    setText('#adminKpiFuelDelta', deltaLabel(fuel, previousFuel, ' L'));

    const totalHours = sum(current, 'horas');
    setText('#adminPerformanceValue', `${number(totalHours ? trees / totalHours : 0, 1)} árb/h`);
    renderMonteDonut(current);
    renderPerformanceChart(selectedDate);
    renderMachineHours(current);
    renderAdminMap(current);
    renderAdminAlerts();
    renderAdminActivity();
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function prepareCanvas(canvas, fixedHeight = 220) {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width || canvas.parentElement?.clientWidth || 320, 260);
    const height = Math.max(rect.height || fixedHeight, fixedHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { context, width, height };
  }

  function renderMonteDonut(list) {
    const canvas = $('#adminMonteChart');
    const legend = $('#adminMonteLegend');
    if (!canvas || !legend) return;
    const grouped = new Map();
    list.forEach(record => grouped.set(record.monte || 'Sin monte', (grouped.get(record.monte || 'Sin monte') || 0) + Number(record.arboles || 0)));
    const entries = [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    const drawing = prepareCanvas(canvas, 210);
    if (!drawing) return;
    const { context: ctx, width, height } = drawing;
    ctx.clearRect(0, 0, width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.34;
    const thickness = radius * 0.38;
    if (!total) {
      ctx.strokeStyle = '#e7eee9';
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      let start = -Math.PI / 2;
      entries.forEach((entry, index) => {
        const angle = (entry[1] / total) * Math.PI * 2;
        ctx.strokeStyle = palette[index % palette.length];
        ctx.lineWidth = thickness;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, start, start + angle);
        ctx.stroke();
        start += angle;
      });
    }
    ctx.fillStyle = '#11233a';
    ctx.textAlign = 'center';
    ctx.font = '700 26px Inter, system-ui, sans-serif';
    ctx.fillText(number(total), centerX, centerY + 3);
    ctx.fillStyle = '#718096';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillText('ÁRBOLES', centerX, centerY + 23);
    legend.innerHTML = entries.length ? entries.map((entry, index) => `<div><i style="--legend-color:${palette[index % palette.length]}"></i><span>${escapeHtml(entry[0])}</span><strong>${total ? Math.round((entry[1] / total) * 100) : 0}%</strong></div>`).join('') : '<div class="empty-state">Sin producción para este día.</div>';
  }

  function dayRange(endKey, days = 7) {
    const end = new Date(`${endKey}T12:00:00`);
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(end);
      date.setDate(end.getDate() - (days - 1 - index));
      return dateKey(date);
    });
  }

  function drawLineChart(canvas, labels, values, options = {}) {
    const drawing = prepareCanvas(canvas, options.height || 230);
    if (!drawing) return;
    const { context: ctx, width, height } = drawing;
    ctx.clearRect(0, 0, width, height);
    const padding = { top: 24, right: 18, bottom: 34, left: 46 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const max = Math.max(...values, 1) * 1.12;
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.strokeStyle = '#e7eee9';
    ctx.fillStyle = '#8390a3';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (plotHeight / 4) * i;
      ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(number(max - (max / 4) * i), padding.left - 8, y + 4);
    }
    const points = values.map((value, index) => ({
      x: padding.left + (labels.length <= 1 ? plotWidth / 2 : (plotWidth / (labels.length - 1)) * index),
      y: padding.top + plotHeight - (Number(value || 0) / max) * plotHeight
    }));
    if (points.length) {
      const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      gradient.addColorStop(0, 'rgba(22,140,79,.24)');
      gradient.addColorStop(1, 'rgba(22,140,79,0)');
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
      ctx.lineTo(points[0].x, height - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = '#168c4f'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      points.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#168c4f'; ctx.lineWidth = 2.5; ctx.stroke(); });
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#8390a3'; ctx.font = '10px Inter, system-ui, sans-serif';
    labels.forEach((label, index) => {
      const x = padding.left + (labels.length <= 1 ? plotWidth / 2 : (plotWidth / (labels.length - 1)) * index);
      ctx.fillText(label, x, height - 10);
    });
  }

  function renderPerformanceChart(selectedDate) {
    const days = dayRange(selectedDate, 7);
    const values = days.map(day => {
      const list = recordsForDate(day);
      const trees = list.reduce((sum, item) => sum + Number(item.arboles || 0), 0);
      const hours = list.reduce((sum, item) => sum + Number(item.horas || 0), 0);
      return hours ? trees / hours : 0;
    });
    drawLineChart($('#adminPerformanceChart'), days.map(day => new Date(`${day}T12:00:00`).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' })), values);
  }

  function renderMachineHours(list) {
    const root = $('#adminMachineHours');
    if (!root) return;
    const grouped = new Map();
    list.forEach(record => grouped.set(record.maquina || 'Sin máquina', (grouped.get(record.maquina || 'Sin máquina') || 0) + Number(record.horas || 0)));
    const entries = [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = Math.max(...entries.map(entry => entry[1]), 1);
    root.innerHTML = entries.length ? entries.map(entry => `<div class="horizontal-bar-row"><span title="${escapeHtml(entry[0])}">${escapeHtml(entry[0])}</span><div><i style="width:${Math.max(5, (entry[1] / max) * 100)}%"></i></div><strong>${number(entry[1], 1)} h</strong></div>`).join('') : '<div class="empty-state">Sin horas registradas para este día.</div>';
  }

  function renderAdminMap(list) {
    const root = $('#adminLocationMap');
    if (!root) return;
    const gpsRecords = list.filter(record => record.gps && Number.isFinite(Number(record.gps.latitude)) && Number.isFinite(Number(record.gps.longitude))).slice(-8);
    root.querySelectorAll('.abstract-pin').forEach(pin => pin.remove());
    root.querySelector('.map-empty')?.classList.toggle('hidden', gpsRecords.length > 0);
    gpsRecords.forEach((record, index) => {
      const pin = document.createElement('a');
      pin.className = `abstract-pin pin-${index % 3}`;
      pin.style.left = `${14 + ((index * 23) % 72)}%`;
      pin.style.top = `${20 + ((index * 31) % 58)}%`;
      pin.href = `https://www.google.com/maps/search/?api=1&query=${record.gps.latitude},${record.gps.longitude}`;
      pin.target = '_blank'; pin.rel = 'noopener';
      pin.title = `${record.maquina || 'Máquina'} · ${record.monte || 'Monte'}`;
      pin.innerHTML = '<svg><use href="#i-pin"></use></svg>';
      root.appendChild(pin);
    });
  }

  function renderAdminAlerts() {
    const root = $('#adminAlertList');
    if (!root) return;
    const open = state.incidents.filter(item => item.status !== 'resuelta').slice(0, 5);
    root.innerHTML = open.length ? open.map(item => `<button type="button" data-incident-open="${escapeHtml(item.id)}"><span class="alert-icon priority-${escapeHtml(item.priority || 'media')}"><svg><use href="#i-alert"></use></svg></span><div><strong>${escapeHtml(item.title || 'Incidencia')}</strong><small>${escapeHtml(item.machine || item.monte || 'Operación')} · ${formatDateTime(item.createdAtClient)}</small></div><em>${priorityLabel(item.priority)}</em></button>`).join('') : '<div class="empty-state success-empty"><svg><use href="#i-check"></use></svg><span>No hay incidencias abiertas.</span></div>';
  }

  function renderAdminActivity() {
    const root = $('#adminActivityList');
    if (!root) return;
    const activity = records().slice(0, 6);
    root.innerHTML = activity.length ? activity.map(record => `<div><span class="activity-avatar">${initials(record.operador)}</span><div><strong>${escapeHtml(record.operador || 'Operador')} envió un parte</strong><small>${escapeHtml(record.monte || 'Sin monte')} · ${formatDateTime(record.createdAt)}</small></div></div>`).join('') : '<div class="empty-state">No hay actividad reciente.</div>';
  }

  function priorityLabel(value) {
    return ({ critica: 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja' })[value] || 'Media';
  }

  function statusLabel(value) {
    return ({ abierta: 'Abierta', en_proceso: 'En proceso', resuelta: 'Resuelta' })[value] || 'Abierta';
  }

  function updateAlertBadges() {
    const open = state.incidents.filter(item => item.status !== 'resuelta').length;
    $$('.ops-alert-badge').forEach(badge => {
      badge.textContent = open > 99 ? '99+' : String(open);
      badge.classList.toggle('hidden', !open);
    });
  }

  function filteredIncidents() {
    const search = ($('#incidentSearch')?.value || '').trim().toLowerCase();
    const status = $('#incidentStatusFilter')?.value || '';
    const priority = $('#incidentPriorityFilter')?.value || '';
    return state.incidents.filter(item => {
      const haystack = [item.title, item.description, item.machine, item.monte, item.createdByName].join(' ').toLowerCase();
      return (!search || haystack.includes(search)) && (!status || item.status === status) && (!priority || item.priority === priority);
    });
  }

  function renderIncidents() {
    setText('#incidentOpenCount', number(state.incidents.filter(item => item.status === 'abierta').length));
    setText('#incidentCriticalCount', number(state.incidents.filter(item => item.status !== 'resuelta' && item.priority === 'critica').length));
    setText('#incidentProgressCount', number(state.incidents.filter(item => item.status === 'en_proceso').length));
    setText('#incidentResolvedCount', number(state.incidents.filter(item => item.status === 'resuelta').length));
    const root = $('#incidentList');
    if (!root) return;
    const list = filteredIncidents();
    root.innerHTML = list.length ? list.map(item => {
      const canManage = isAdmin() || item.createdByUid === state.user?.uid;
      return `<article class="incident-card priority-${escapeHtml(item.priority || 'media')}">
        <div class="incident-card-top"><div class="incident-type-icon"><svg><use href="#i-alert"></use></svg></div><div class="incident-card-title"><div><span>${priorityLabel(item.priority)}</span><em class="status-${escapeHtml(item.status || 'abierta')}">${statusLabel(item.status)}</em></div><h3>${escapeHtml(item.title || 'Incidencia')}</h3><p>${escapeHtml(item.description || 'Sin descripción')}</p></div>${item.photoData ? `<img src="${item.photoData}" alt="Foto de incidencia">` : ''}</div>
        <div class="incident-meta"><span><svg><use href="#i-machine"></use></svg>${escapeHtml(item.machine || 'Sin máquina')}</span><span><svg><use href="#i-mountain"></use></svg>${escapeHtml(item.monte || 'Sin monte')}</span><span><svg><use href="#i-user"></use></svg>${escapeHtml(item.createdByName || 'Usuario')}</span><span><svg><use href="#i-clock"></use></svg>${formatDateTime(item.createdAtClient)}</span></div>
        <div class="incident-card-actions">${canManage && item.status !== 'resuelta' ? `<button data-incident-status="${escapeHtml(item.id)}" data-status="en_proceso">En proceso</button><button class="success" data-incident-status="${escapeHtml(item.id)}" data-status="resuelta">Resolver</button>` : ''}${isAdmin() ? `<button class="danger" data-incident-delete="${escapeHtml(item.id)}"><svg><use href="#i-trash"></use></svg></button>` : ''}</div>
      </article>`;
    }).join('') : '<div class="empty-state large"><svg><use href="#i-alert"></use></svg><strong>No hay incidencias para mostrar</strong><span>Cambia los filtros o registra una nueva incidencia.</span></div>';
    root.querySelectorAll('[data-incident-status]').forEach(button => button.addEventListener('click', () => updateIncidentStatus(button.dataset.incidentStatus, button.dataset.status)));
    root.querySelectorAll('[data-incident-delete]').forEach(button => button.addEventListener('click', () => deleteIncident(button.dataset.incidentDelete)));
  }

  async function updateIncidentStatus(id, status) {
    try {
      await window.LubaydOps.updateIncident(id, { status });
      notify('Incidencia actualizada', `Estado: ${statusLabel(status)}.`);
    } catch (error) {
      notify('No se pudo actualizar', error.message || String(error), 'error');
    }
  }

  async function deleteIncident(id) {
    if (!confirm('¿Eliminar esta incidencia?')) return;
    try {
      await window.LubaydOps.deleteIncident(id);
      notify('Incidencia eliminada', 'El registro fue retirado del sistema.');
    } catch (error) {
      notify('No se pudo eliminar', error.message || String(error), 'error');
    }
  }

  async function captureIncidentGps() {
    state.incidentGps = null;
    setText('#incidentGpsLabel', 'Buscando ubicación actual…');
    if (!navigator.geolocation) {
      setText('#incidentGpsLabel', 'El dispositivo no admite geolocalización.');
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      state.incidentGps = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date().toISOString()
      };
      setText('#incidentGpsLabel', `Ubicación obtenida · precisión ±${Math.round(position.coords.accuracy)} m`);
    }, () => setText('#incidentGpsLabel', 'No se pudo obtener la ubicación. Puedes guardar igualmente.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  }

  function openIncidentForm() {
    $('#incidentFormPanel')?.classList.remove('hidden');
    $('#incidentTitle')?.focus();
    captureIncidentGps();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeIncidentForm() {
    $('#incidentFormPanel')?.classList.add('hidden');
    $('#incidentForm')?.reset();
    state.incidentGps = null;
  }

  async function imageToDataUrl(file) {
    if (!file) return '';
    if (file.size > 8 * 1024 * 1024) throw new Error('La foto supera 8 MB.');
    const bitmap = await createImageBitmap(file);
    const max = 720;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.62);
  }

  async function submitIncident(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const file = $('#incidentPhoto')?.files?.[0];
      const photoData = file ? await imageToDataUrl(file) : '';
      await window.LubaydOps.createIncident({
        title: $('#incidentTitle').value.trim(),
        machine: $('#incidentMachine').value.trim(),
        monte: $('#incidentMonte').value.trim(),
        priority: $('#incidentPriority').value,
        type: $('#incidentType').value,
        description: $('#incidentDescription').value.trim(),
        photoData,
        gps: state.incidentGps
      });
      closeIncidentForm();
      notify('Incidencia registrada', 'Administración ya puede verla y realizar seguimiento.');
    } catch (error) {
      notify('No se pudo guardar', error.message || String(error), 'error');
    } finally {
      submit.disabled = false;
    }
  }

  function renderMachines() {
    const root = $('#machineList');
    if (!root) return;
    const search = ($('#machineSearch')?.value || '').toLowerCase();
    const list = state.machines.filter(item => [item.code, item.model, item.status].join(' ').toLowerCase().includes(search));
    root.innerHTML = list.length ? list.map(item => `<article class="catalog-item"><div class="catalog-item-icon status-${escapeHtml(item.status || 'activa')}"><svg><use href="#i-machine"></use></svg></div><div><strong>${escapeHtml(item.code || 'Sin código')}</strong><span>${escapeHtml(item.model || 'Modelo no indicado')}</span><small>${number(item.hours, 1)} h · ${escapeHtml(item.status || 'activa')}</small></div><div class="catalog-item-actions"><button data-machine-edit="${escapeHtml(item.id)}"><svg><use href="#i-wrench"></use></svg></button><button class="danger" data-machine-delete="${escapeHtml(item.id)}"><svg><use href="#i-trash"></use></svg></button></div></article>`).join('') : '<div class="empty-state">No hay máquinas registradas.</div>';
    root.querySelectorAll('[data-machine-edit]').forEach(button => button.addEventListener('click', () => editMachine(button.dataset.machineEdit)));
    root.querySelectorAll('[data-machine-delete]').forEach(button => button.addEventListener('click', () => removeCatalog('maquinas', button.dataset.machineDelete)));
  }

  function editMachine(id) {
    const item = state.machines.find(machine => machine.id === id);
    if (!item) return;
    $('#machineEditId').value = id;
    $('#machineCode').value = item.code || '';
    $('#machineModel').value = item.model || '';
    $('#machineStatus').value = item.status || 'activa';
    $('#machineHours').value = item.hours || '';
    setText('#machineFormTitle', 'Editar máquina');
    $('#machineCode').focus();
  }

  function resetMachineForm() {
    $('#machineForm')?.reset();
    if ($('#machineEditId')) $('#machineEditId').value = '';
    setText('#machineFormTitle', 'Nueva máquina');
  }

  async function submitMachine(event) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) return event.currentTarget.reportValidity();
    try {
      await window.LubaydOps.saveCatalog('maquinas', {
        code: $('#machineCode').value.trim(),
        model: $('#machineModel').value.trim(),
        status: $('#machineStatus').value,
        hours: Number($('#machineHours').value || 0)
      }, $('#machineEditId').value || null);
      resetMachineForm();
      notify('Máquina guardada', 'El catálogo operativo fue actualizado.');
    } catch (error) {
      notify('No se pudo guardar', error.message || String(error), 'error');
    }
  }

  function renderMontes() {
    const root = $('#monteList');
    if (!root) return;
    const search = ($('#monteSearch')?.value || '').toLowerCase();
    const list = state.montes.filter(item => [item.name, item.species, item.status].join(' ').toLowerCase().includes(search));
    root.innerHTML = list.length ? list.map(item => `<article class="catalog-item"><div class="catalog-item-icon status-${escapeHtml(item.status || 'activo')}"><svg><use href="#i-mountain"></use></svg></div><div><strong>${escapeHtml(item.name || 'Sin nombre')}</strong><span>${escapeHtml(item.species || 'Especie no indicada')}</span><small>${number(item.area, 1)} ha · ${escapeHtml(item.status || 'activo')}</small></div><div class="catalog-item-actions"><button data-monte-edit="${escapeHtml(item.id)}"><svg><use href="#i-wrench"></use></svg></button><button class="danger" data-monte-delete="${escapeHtml(item.id)}"><svg><use href="#i-trash"></use></svg></button></div></article>`).join('') : '<div class="empty-state">No hay montes registrados.</div>';
    root.querySelectorAll('[data-monte-edit]').forEach(button => button.addEventListener('click', () => editMonte(button.dataset.monteEdit)));
    root.querySelectorAll('[data-monte-delete]').forEach(button => button.addEventListener('click', () => removeCatalog('montes', button.dataset.monteDelete)));
  }

  function editMonte(id) {
    const item = state.montes.find(monte => monte.id === id);
    if (!item) return;
    $('#monteEditId').value = id;
    $('#monteName').value = item.name || '';
    $('#monteArea').value = item.area || '';
    $('#monteSpecies').value = item.species || 'Eucalyptus';
    $('#monteStatus').value = item.status || 'activo';
    setText('#monteFormTitle', 'Editar monte');
    $('#monteName').focus();
  }

  function resetMonteForm() {
    $('#monteForm')?.reset();
    if ($('#monteEditId')) $('#monteEditId').value = '';
    setText('#monteFormTitle', 'Nuevo monte');
  }

  async function submitMonte(event) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) return event.currentTarget.reportValidity();
    try {
      await window.LubaydOps.saveCatalog('montes', {
        name: $('#monteName').value.trim(),
        area: Number($('#monteArea').value || 0),
        species: $('#monteSpecies').value,
        status: $('#monteStatus').value
      }, $('#monteEditId').value || null);
      resetMonteForm();
      notify('Monte guardado', 'El catálogo de campo fue actualizado.');
    } catch (error) {
      notify('No se pudo guardar', error.message || String(error), 'error');
    }
  }

  async function removeCatalog(collection, id) {
    if (!confirm('¿Eliminar este registro del catálogo?')) return;
    try {
      await window.LubaydOps.deleteCatalog(collection, id);
      notify('Registro eliminado', 'El catálogo fue actualizado.');
    } catch (error) {
      notify('No se pudo eliminar', error.message || String(error), 'error');
    }
  }

  function renderUsers() {
    const root = $('#usersAdminList');
    if (!root) return;
    const search = ($('#usersSearch')?.value || '').toLowerCase();
    const role = $('#usersRoleFilter')?.value || '';
    const status = $('#usersStatusFilter')?.value || '';
    const list = state.users.filter(user => {
      const matchesSearch = [user.nombre, user.email].join(' ').toLowerCase().includes(search);
      const matchesRole = !role || user.role === role;
      const matchesStatus = !status || (status === 'active' ? user.active === true : user.active !== true);
      return matchesSearch && matchesRole && matchesStatus;
    });
    setText('#usersTotalCount', number(state.users.length));
    setText('#usersActiveCount', number(state.users.filter(user => user.active === true).length));
    setText('#usersAdminCount', number(state.users.filter(user => user.role === 'admin').length));
    setText('#usersOperatorCount', number(state.users.filter(user => user.role === 'operador').length));
    root.innerHTML = list.length ? list.map(user => `<article class="user-admin-row"><div class="user-admin-avatar">${initials(user.nombre || user.email)}</div><div class="user-admin-identity"><strong>${escapeHtml(user.nombre || 'Sin nombre')}</strong><span>${escapeHtml(user.email || 'Sin correo')}</span></div><label><span>Rol</span><select data-user-role="${escapeHtml(user.id)}" ${user.id === state.user?.uid ? 'disabled' : ''}><option value="operador" ${user.role === 'operador' ? 'selected' : ''}>Operador</option><option value="supervisor" ${user.role === 'supervisor' ? 'selected' : ''}>Supervisor</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label><label class="user-active-toggle"><span>${user.active === true ? 'Activo' : 'Desactivado'}</span><input type="checkbox" data-user-active="${escapeHtml(user.id)}" ${user.active === true ? 'checked' : ''} ${user.id === state.user?.uid ? 'disabled' : ''}></label><div class="user-admin-state ${user.active === true ? 'active' : 'inactive'}"><i></i>${user.active === true ? 'Habilitado' : 'Bloqueado'}</div></article>`).join('') : '<div class="empty-state">No hay usuarios que coincidan con los filtros.</div>';
    root.querySelectorAll('[data-user-role]').forEach(select => select.addEventListener('change', () => updateUser(select.dataset.userRole, { role: select.value })));
    root.querySelectorAll('[data-user-active]').forEach(input => input.addEventListener('change', () => updateUser(input.dataset.userActive, { active: input.checked })));
  }

  async function updateUser(uid, patch) {
    try {
      await window.LubaydOps.updateUser(uid, patch);
      notify('Usuario actualizado', 'Los permisos se aplicaron correctamente.');
    } catch (error) {
      notify('No se pudo actualizar', error.message || String(error), 'error');
      renderUsers();
    }
  }

  function reportFilteredRecords() {
    const from = $('#reportDateFrom')?.value || '';
    const to = $('#reportDateTo')?.value || '';
    const operator = $('#reportOperator')?.value || '';
    const machine = $('#reportMachine')?.value || '';
    return records().filter(record => (!from || record.fecha >= from) && (!to || record.fecha <= to) && (!operator || record.operador === operator) && (!machine || record.maquina === machine));
  }

  function fillReportFilters() {
    const operatorSelect = $('#reportOperator');
    const machineSelect = $('#reportMachine');
    if (operatorSelect) {
      const current = operatorSelect.value;
      const operators = [...new Set(records().map(record => record.operador).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      operatorSelect.innerHTML = '<option value="">Todos</option>' + operators.map(value => `<option ${value === current ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
    }
    if (machineSelect) {
      const current = machineSelect.value;
      const machines = [...new Set([...state.machines.map(item => item.code), ...records().map(record => record.maquina)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      machineSelect.innerHTML = '<option value="">Todas</option>' + machines.map(value => `<option ${value === current ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
    }
  }

  function renderReports() {
    if (!isAdmin()) return;
    const list = reportFilteredRecords();
    state.reportRecords = list;
    const trees = list.reduce((sum, item) => sum + Number(item.arboles || 0), 0);
    const hours = list.reduce((sum, item) => sum + Number(item.horas || 0), 0);
    const fuel = list.reduce((sum, item) => sum + Number(item.combustible || 0), 0);
    setText('#reportKpiParts', number(list.length));
    setText('#reportKpiTrees', number(trees));
    setText('#reportKpiHours', `${number(hours, 1)} h`);
    setText('#reportKpiFuel', `${number(fuel, 1)} L`);
    setText('#reportKpiPerformance', `${number(hours ? trees / hours : 0, 1)} árb/h`);

    const byDay = new Map();
    list.forEach(item => byDay.set(item.fecha || 'Sin fecha', (byDay.get(item.fecha || 'Sin fecha') || 0) + Number(item.arboles || 0)));
    const days = [...byDay.keys()].sort().slice(-14);
    drawLineChart($('#reportProductionChart'), days.map(day => formatDate(day).slice(0, 5)), days.map(day => byDay.get(day)), { height: 270 });

    const byOperator = new Map();
    list.forEach(item => {
      const key = item.operador || 'Sin operador';
      const current = byOperator.get(key) || { trees: 0, hours: 0 };
      current.trees += Number(item.arboles || 0); current.hours += Number(item.horas || 0); byOperator.set(key, current);
    });
    const ranking = [...byOperator.entries()].map(([name, values]) => [name, values.hours ? values.trees / values.hours : 0]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = Math.max(...ranking.map(item => item[1]), 1);
    $('#reportOperatorRanking').innerHTML = ranking.length ? ranking.map(item => `<div class="horizontal-bar-row"><span>${escapeHtml(item[0])}</span><div><i style="width:${Math.max(5, (item[1] / max) * 100)}%"></i></div><strong>${number(item[1], 1)}</strong></div>`).join('') : '<div class="empty-state">Sin datos.</div>';

    $('#reportTableBody').innerHTML = list.slice().sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))).map(item => `<tr><td>${formatDate(item.fecha)}</td><td>${escapeHtml(item.operador || '—')}</td><td>${escapeHtml(item.maquina || '—')}</td><td>${escapeHtml(item.monte || '—')}</td><td>${number(item.trozaCantidad || 0)}</td><td>${number(item.pulpaCantidad || 0)}</td><td>${number(item.arboles)}</td><td>${number(item.horas, 1)}</td><td>${number(item.combustible, 1)}</td><td>${number(item.horas ? item.arboles / item.horas : 0, 1)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty-cell">No hay registros para el período seleccionado.</td></tr>';
  }

  function exportReportCsv() {
    const list = state.reportRecords.length || reportFilteredRecords().length ? (state.reportRecords.length ? state.reportRecords : reportFilteredRecords()) : [];
    const rows = [['Fecha', 'Operador', 'Máquina', 'Monte', 'Actividad', 'Troza', 'Pulpa', 'Árboles', 'Horas', 'Combustible', 'Rendimiento']];
    list.forEach(item => rows.push([item.fecha || '', item.operador || '', item.maquina || '', item.monte || '', item.actividad || '', Number(item.trozaCantidad || 0), Number(item.pulpaCantidad || 0), Number(item.arboles || 0), Number(item.horas || 0), Number(item.combustible || 0), Number(item.horas ? item.arboles / item.horas : 0).toFixed(2)]));
    const csv = '\ufeff' + rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `reporte-lubayd-${todayKey()}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    notify('Reporte exportado', 'El archivo CSV puede abrirse directamente en Excel.');
  }

  function renderSync() {
    const online = navigator.onLine;
    setText('#syncHeroTitle', online ? 'Sistema conectado y sincronizando' : 'Trabajando sin conexión');
    setText('#syncHeroText', online ? 'Los cambios se envían a Firebase y quedan disponibles en todos los dispositivos.' : 'Los datos se conservarán localmente hasta recuperar internet.');
    setText('#syncLocalParts', number(records().length));
    setText('#syncLastUpdate', new Date().toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' }));
    setText('#syncBrowserStatus', online ? 'En línea' : 'Sin conexión');
    setText('#syncCloudStatus', state.lastCloudMeta?.hasPendingWrites ? 'Cambios pendientes' : state.lastCloudMeta?.fromCache ? 'Datos locales' : 'Sincronizado');
    $('#sincronizacion')?.classList.toggle('is-offline', !online);
  }

  function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('lubayd_ui_settings_v14') || '{}');
    const theme = settings.theme || 'light';
    const fontSize = settings.fontSize || 'normal';
    const reduceMotion = Boolean(settings.reduceMotion);
    if ($('#themePreference')) $('#themePreference').value = theme;
    if ($('#fontSizePreference')) $('#fontSizePreference').value = fontSize;
    if ($('#reduceMotionPreference')) $('#reduceMotionPreference').checked = reduceMotion;
    if ($('#confirmSavePreference')) $('#confirmSavePreference').checked = settings.confirmSave !== false;
    if ($('#rememberMontePreference')) $('#rememberMontePreference').checked = settings.rememberMonte !== false;
    if ($('#soundPreference')) $('#soundPreference').checked = Boolean(settings.sound);
    applySettings(settings);
  }

  function saveSettings() {
    const settings = {
      theme: $('#themePreference')?.value || 'light',
      fontSize: $('#fontSizePreference')?.value || 'normal',
      reduceMotion: Boolean($('#reduceMotionPreference')?.checked),
      confirmSave: Boolean($('#confirmSavePreference')?.checked),
      rememberMonte: Boolean($('#rememberMontePreference')?.checked),
      sound: Boolean($('#soundPreference')?.checked)
    };
    localStorage.setItem('lubayd_ui_settings_v14', JSON.stringify(settings));
    applySettings(settings);
    notify('Preferencias guardadas', 'La interfaz fue actualizada.');
  }

  function applySettings(settings) {
    document.documentElement.dataset.themePreference = settings.theme || 'light';
    document.documentElement.dataset.fontSize = settings.fontSize || 'normal';
    document.documentElement.classList.toggle('reduce-motion', Boolean(settings.reduceMotion));
  }

  function viewChanged(id) {
    if (id === 'dashboard') { renderOperatorStatus(); renderAdminDashboard(); }
    if (id === 'incidencias') renderIncidents();
    if (id === 'maquinas') renderMachines();
    if (id === 'montes') renderMontes();
    if (id === 'usuarios') renderUsers();
    if (id === 'reportes') { fillReportFilters(); renderReports(); }
    if (id === 'sincronizacion') renderSync();
    closeMobileMore();
  }

  function openMobileMore() {
    $('#mobileMoreSheet')?.classList.remove('hidden');
    document.body.classList.add('mobile-sheet-open');
  }

  function closeMobileMore() {
    $('#mobileMoreSheet')?.classList.add('hidden');
    document.body.classList.remove('mobile-sheet-open');
  }

  function bindEvents() {
    $('#adminDashboardDate') && ($('#adminDashboardDate').value = todayKey());
    $('#adminDashboardDate')?.addEventListener('change', renderAdminDashboard);
    $('#adminDashboardRefresh')?.addEventListener('click', renderAdminDashboard);
    $('#newIncidentBtn')?.addEventListener('click', openIncidentForm);
    $('#closeIncidentForm')?.addEventListener('click', closeIncidentForm);
    $('#cancelIncidentBtn')?.addEventListener('click', closeIncidentForm);
    $('#incidentForm')?.addEventListener('submit', submitIncident);
    ['#incidentSearch', '#incidentStatusFilter', '#incidentPriorityFilter'].forEach(selector => $(selector)?.addEventListener(selector === '#incidentSearch' ? 'input' : 'change', renderIncidents));
    $('#incidentRefreshBtn')?.addEventListener('click', renderIncidents);

    $('#machineForm')?.addEventListener('submit', submitMachine);
    $('#machineFormReset')?.addEventListener('click', resetMachineForm);
    $('#newMachineBtn')?.addEventListener('click', () => { resetMachineForm(); $('#machineCode')?.focus(); });
    $('#machineSearch')?.addEventListener('input', renderMachines);
    $('#monteForm')?.addEventListener('submit', submitMonte);
    $('#monteFormReset')?.addEventListener('click', resetMonteForm);
    $('#newMonteBtn')?.addEventListener('click', () => { resetMonteForm(); $('#monteName')?.focus(); });
    $('#monteSearch')?.addEventListener('input', renderMontes);

    ['#usersSearch', '#usersRoleFilter', '#usersStatusFilter'].forEach(selector => $(selector)?.addEventListener(selector === '#usersSearch' ? 'input' : 'change', renderUsers));
    $('#usersRefreshBtn')?.addEventListener('click', renderUsers);
    $('#applyReportFilters')?.addEventListener('click', renderReports);
    $('#reportExportCsv')?.addEventListener('click', exportReportCsv);
    $('#reportPrintBtn')?.addEventListener('click', () => window.print());
    $('#forceSyncBtn')?.addEventListener('click', () => { renderSync(); notify('Sincronización solicitada', navigator.onLine ? 'Firebase actualizará los cambios pendientes.' : 'El dispositivo continúa sin conexión.', navigator.onLine ? 'success' : 'warning'); });
    window.addEventListener('online', renderSync);
    window.addEventListener('offline', renderSync);

    ['#themePreference', '#fontSizePreference', '#reduceMotionPreference', '#confirmSavePreference', '#rememberMontePreference', '#soundPreference'].forEach(selector => $(selector)?.addEventListener('change', saveSettings));
    $('#resetAppCacheBtn')?.addEventListener('click', async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      }
      notify('Actualización comprobada', 'Recarga la página para aplicar la última versión.');
    });

    $('#mobileMoreBtn')?.addEventListener('click', openMobileMore);
    $('#closeMobileMore')?.addEventListener('click', closeMobileMore);
    $('.mobile-more-backdrop')?.addEventListener('click', closeMobileMore);
    $$('#mobileMoreSheet [data-view-link]').forEach(button => button.addEventListener('click', closeMobileMore));

    document.addEventListener('click', event => {
      const open = event.target.closest('[data-incident-open]');
      if (open) window.LubaydShowView?.('incidencias');
    });
    window.addEventListener('resize', () => {
      if ($('#adminDashboard') && !$('#adminDashboard').classList.contains('hidden')) renderAdminDashboard();
      if ($('#reportes')?.classList.contains('active')) renderReports();
    });
  }

  function initialize(user, profile) {
    state.user = user;
    state.profile = profile;
    applyRoleInterface();
    subscribeData();
    renderOperatorStatus();
    renderAdminDashboard();
    renderIncidents();
    fillReportFilters();
    renderSync();
  }

  window.LubaydOperations = { viewChanged, renderAdminDashboard, renderReports };

  bindEvents();
  loadSettings();
  window.addEventListener('lubayd-profile-ready', event => initialize(event.detail?.user, event.detail?.profile));
  window.addEventListener('lubayd-auth-changed', event => {
    if (!event.detail?.user) {
      cleanupSubscriptions();
      state.user = null; state.profile = null; state.incidents = []; state.machines = []; state.montes = []; state.users = [];
    }
  });
  window.addEventListener('lubayd-records-updated', () => {
    renderOperatorStatus();
    renderAdminDashboard();
    fillReportFilters();
    if ($('#reportes')?.classList.contains('active')) renderReports();
    renderSync();
  });
  if (window.LubaydCurrentUser && window.LubaydCurrentProfile) initialize(window.LubaydCurrentUser, window.LubaydCurrentProfile);
})();
