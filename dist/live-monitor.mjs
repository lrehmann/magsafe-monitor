import { decodeStreamPacket, hexLabel, streamLayout, streamRecords } from './dotara-stream.mjs?v=12';
import { combinedFields, fieldAliases, fieldLabels } from './live-field-labels.mjs?v=12';
import { chargerProfiles } from './charger-profiles.mjs?v=13';

const $ = id => document.getElementById(id);
const plotGrid = $('live-plots');
const fieldSelect = $('live-fields');
const smoothing = $('live-smoothing');
const plotTemplate = $('live-plot');
const traceTemplate = $('live-trace');
const deviceInfo = $('live-device');
const series = new Map();
const groups = new Map();
const colors = ['#85e2c5', '#f4bd80', '#9ebefa', '#e2a7d3', '#cbc4ff'];
const combinedColors = [...colors, '#f5dc7a', '#73cfed', '#f89c94', '#c6dc9c', '#94aaa5', '#dac8b2'];
const traceDashes = [[], [4, 2], [2, 3], [6, 2, 1, 2]];
const fieldKey = (kind, offset) => `${kind}:${offset}`;
const fieldAddress = (kind, offset) => hexLabel(kind, 4) + ' + ' + hexLabel(offset, 2);
const aliasKeys = new Map(fieldAliases.map(({ source, canonical }) => [fieldKey(...source), fieldKey(...canonical)]));
const aliasAddresses = new Map(fieldAliases.map(({ source, canonical }) => [fieldKey(...canonical), fieldAddress(...source)]));
const canonicalKey = (kind, offset) => {
  const key = fieldKey(kind, offset);
  return aliasKeys.get(key) ?? key;
};
const axisFont = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
const windowMs = 5 * 60_000;
const smoothingMs = 3000;
const recentMs = 3500;
const counter = new Intl.NumberFormat();
const localTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
let active;
let packetCount = 0;
let lastReportAt = 0;
let startedAt = 0;
let pendingRender = 0;
let device;
let fieldAddresses;
let availableGroups;

function state(message, style = 'idle') {
  if ($('live-status-text').textContent !== message) $('live-status-text').textContent = message;
  $('live-status').dataset.state = style;
}

function createPlot(label, sources, wide) {
  const view = plotTemplate.content.firstElementChild.cloneNode(true);
  if (wide) view.classList.add('live-plot--wide');
  const chart = view.querySelector('canvas');
  const legend = view.querySelector('.live-traces');
  view.querySelector('.live-label').textContent = label;
  chart.setAttribute('aria-label', 'Five-minute plot of ' + label);
  const traces = sources.map(({ item, name, color }) => {
    const trace = traceTemplate.content.firstElementChild.cloneNode(true);
    trace.style.setProperty('--plot-color', color);
    const fieldView = trace.querySelector('.live-field');
    fieldView.textContent = item.address;
    trace.querySelector('.live-trace-name').textContent = name;
    legend.append(trace);
    const hexView = item.unidentified ? trace.querySelector('.live-hex') : null;
    return { item, color, fieldView, hexView, valueView: trace.querySelector('.live-value'), timeView: trace.querySelector('.live-sample-time') };
  });
  return { view, chart, traces };
}

for (const [index, record] of streamRecords.entries()) {
  const kind = hexLabel(record.kind, 4);
  const count = record.offsets.length;
  fieldSelect.add(new Option(`${kind} · ${count} ${count === 1 ? 'field' : 'fields'}`, kind));
  for (const offset of record.offsets) {
    const key = fieldKey(record.kind, offset);
    if (aliasKeys.has(key)) continue;
    const address = fieldAddress(record.kind, offset);
    const metadata = fieldLabels[record.kind]?.[offset];
    const [label = 'Unidentified field', unit = '', scale = 1] = metadata || [];
    const color = colors[index % colors.length];
    const recentCopies = aliasAddresses.has(key) ? new Set() : undefined;
    const item = { key, kind: record.kind, offset, label, address, unit, scale, color, encoding: record.encoding, unidentified: !metadata, points: [], recentCopies };
    series.set(key, item);
  }
}

const combined = combinedFields.map(({ label, traces, wide }) => {
  const sources = traces.map(([kind, offset, name, colorIndex], index) => {
    const item = series.get(fieldKey(kind, offset));
    return { item, name: name ?? item.label, color: combinedColors[colorIndex ?? index] };
  });
  return createPlot(label, sources, wide);
});
const plotByField = new Map(combined.flatMap(plot => plot.traces.map(({ item }) => [item.key, plot])));
const individual = [];
for (const item of series.values()) {
  if (plotByField.has(item.key)) continue;
  const plot = createPlot(item.label, [{ item, name: item.encoding || '', color: item.color }]);
  plotByField.set(item.key, plot);
  individual.push(plot);
}
for (const record of streamRecords) {
  const plots = record.offsets.map(offset => plotByField.get(canonicalKey(record.kind, offset)));
  groups.set(hexLabel(record.kind, 4), Array.from(new Set(plots)));
}
groups.set('combined', combined);
groups.set('all', [...combined, ...individual]);
fieldSelect.options[0].textContent = `All ${series.size} fields`;

function selectedPlots(group) {
  if (availableGroups && group !== 'all' && group !== 'combined' && !availableGroups.has(group)) return [];
  return groups.get(group).filter(plot => plot.traces.some(({item}) => !fieldAddresses || fieldAddresses.has(item.key)));
}

function showGroup() {
  const group = selectedPlots(fieldSelect.value);
  const firstChannel = { 0x0174: 8, 0x0258: 4 }[device?.usbVersion];
  for (const plot of group) {
    for (const { item, fieldView } of plot.traces) {
      const alias = aliasAddresses.get(item.key);
      const address = fieldAddresses
        ? fieldAddresses.get(item.key) || 'Layout unverified'
        : [item.address, alias].filter(Boolean).join(' / ');
      const auxiliary = item.kind === 0x1c74 && (item.offset === 0x0c || item.offset === 0x10);
      fieldView.textContent = auxiliary && firstChannel ? `${address} · ADC ${firstChannel + (item.offset === 0x10 ? 1 : 0)}` : address;
    }
  }
  plotGrid.replaceChildren(...group.map(plot => plot.view));
  scheduleRender();
}

function setDevice(info) {
  device = info;
  const raw = info?.mode === 'raw';
  const legacyLayout = info?.usbVersion === 0x0174 && !raw ? streamLayout(info.usbVersion) : undefined;
  availableGroups = legacyLayout && new Set(legacyLayout.map(record => hexLabel(record.kind, 4)));
  fieldAddresses = legacyLayout
    ? new Map(legacyLayout.flatMap(record => record.offsets.map(offset => [
      fieldKey(record.kind, offset), fieldAddress(record.wireKind, offset),
    ])))
    : undefined;
  for (const option of fieldSelect.options) option.disabled = !selectedPlots(option.value).length;
  if (fieldSelect.selectedOptions[0]?.disabled) fieldSelect.value = 'all';
  fieldSelect.options[0].textContent = `All ${fieldAddresses?.size ?? series.size} fields`;
  deviceInfo.hidden = !info;
  if (info) {
    const identity = `${chargerProfiles.get(info.productId)?.name ?? 'MagSafe'} · 05AC:${hexLabel(info.productId, 4).slice(2)}`;
    const version = info.usbVersion ? `USB version ${hexLabel(info.usbVersion, 4)}` : '';
    const inputs = info.usages.map(usage => 'FF00:' + hexLabel(usage, 2).slice(2)).join(', ');
    const mode = raw || info.passive ? 'Passive USB capture' : info.usbVersion === 0x0258 ? 'Live-verified layout' : 'Firmware-matched layout';
    deviceInfo.textContent = [identity, version, inputs, mode].filter(Boolean).join(' · ');
  }
  $('live-toolbar').hidden = raw || !info;
  plotGrid.hidden = raw || !info;
  showGroup();
}

function formatRaw(value) {
  const magnitude = Math.abs(value);
  if (magnitude && (magnitude < 0.001 || magnitude >= 1e7)) return value.toExponential(4);
  return Number(value.toPrecision(7)).toString();
}

function renderChart(plot, start, end, valueKey) {
  const { chart, traces } = plot;
  const visible = traces.map(({ item, color }) => ({ color, points: item.points.filter(point => point.at >= start && point.at <= end) }));
  chart.hidden = visible.every(trace => !trace.points.length);
  if (chart.hidden) return;

  const width = chart.clientWidth;
  const chartHeight = chart.clientHeight;
  if (!width || !chartHeight) return;
  const pixelScale = window.devicePixelRatio || 1;
  const canvasWidth = Math.round(width * pixelScale);
  const canvasHeight = Math.round(chartHeight * pixelScale);
  if (chart.width !== canvasWidth || chart.height !== canvasHeight) {
    chart.width = canvasWidth;
    chart.height = canvasHeight;
  }
  const ctx = chart.getContext('2d');
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  ctx.clearRect(0, 0, width, chartHeight);
  ctx.font = axisFont;

  let min = Infinity;
  let max = -Infinity;
  for (const { points } of visible) {
    for (const point of points) {
      const value = point[valueKey];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const padding = (max - min) * 0.08 || Math.max(Math.abs(min) * 0.005, 1e-8);
  min -= padding;
  max += padding;
  const ticks = [min, (min + max) / 2, max].map(value => ({ value, label: formatRaw(value) }));
  const bottom = chartHeight - 24;
  const top = 18;
  const left = Math.ceil(Math.max(...ticks.map(tick => ctx.measureText(tick.label).width))) + 10;
  const right = width - 10;
  if (right <= left) return;
  const x = at => left + (at - start) / (end - start) * (right - left);
  const y = value => bottom - (value - min) / (max - min) * (bottom - top);
  ctx.fillStyle = '#adbdcf';
  ctx.strokeStyle = '#2c3c50';
  ctx.lineWidth = 1;
  for (const { value, label } of ticks) {
    const line = y(value);
    ctx.beginPath();
    ctx.moveTo(left, line);
    ctx.lineTo(right, line);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(label, left - 6, line + 4);
  }
  const timeTicks = width < 300 ? 2 : 4;
  for (let step = 0; step <= timeTicks; step++) {
    const at = start + (end - start) * step / timeTicks;
    ctx.textAlign = step === 0 ? 'left' : step === timeTicks ? 'right' : 'center';
    ctx.fillText('+' + Math.round((at - startedAt) / 1000) + 's', x(at), bottom + 16);
  }
  for (const [index, { color, points }] of visible.entries()) {
    if (!points.length) continue;
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(traceDashes[index % traceDashes.length]);
    ctx.beginPath();
    let previous;
    const markers = [];
    for (const point of points) {
      if (previous && point.at - previous.at <= recentMs) ctx.lineTo(x(point.at), y(point[valueKey]));
      else {
        ctx.moveTo(x(point.at), y(point[valueKey]));
        markers.push(point);
      }
      previous = point;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (markers.at(-1) !== previous) markers.push(previous);
    ctx.beginPath();
    for (const point of markers) {
      ctx.moveTo(x(point.at) + 2.5, y(point[valueKey]));
      ctx.arc(x(point.at), y(point[valueKey]), 2.5, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function renderReadings(displayed) {
  const valueKey = smoothing.checked ? 'median' : 'value';
  const now = Date.now();
  const receiving = active?.ready && lastReportAt && now - lastReportAt <= recentMs;
  const start = Math.max(startedAt || lastReportAt, lastReportAt - windowMs);
  const end = Math.max(start + 10_000, lastReportAt || start);
  const lastSampleAt = item => item.latestRaw?.at ?? item.points.at(-1)?.at;
  const isLive = item => receiving && now - lastSampleAt(item) <= recentMs;
  for (const plot of displayed) {
    for (const { item, valueView, timeView, hexView } of plot.traces) {
      const latest = item.points.at(-1);
      const live = isLive(item);
      const at = lastSampleAt(item);
      valueView.textContent = latest && item.latestRaw?.hasValue !== false ? [formatRaw(latest[valueKey]), item.unit].filter(Boolean).join(' ') : '—';
      valueView.classList.toggle('stale', Boolean(active && at !== undefined && !live));
      if (hexView) {
        hexView.hidden = !item.latestRaw;
        if (item.latestRaw) hexView.querySelector('code').textContent = hexLabel(item.latestRaw.word, 8);
      }
      if (at !== undefined) timeView.textContent = (live ? 'Live · ' : 'Last seen ') + localTime.format(at);
      else if (fieldAddresses && !fieldAddresses.has(item.key)) timeView.textContent = 'Unavailable for this firmware';
      else timeView.textContent = receiving ? 'Absent from recent USB reports' : 'No sample yet';
    }
    renderChart(plot, start, end, valueKey);
  }
  const liveCount = Array.from(series.values()).filter(isLive).length;
  if (!active?.ready) return;
  if (!lastReportAt && device?.notice) state(device.notice, 'problem');
  else if (!lastReportAt) state(device?.passive ? 'Listening for USB input reports' : 'Monitoring · waiting for USB reports', 'live');
  else if (!receiving) state('Monitoring · no recent USB reports', 'live');
  else if (device?.mode === 'raw') state('Receiving raw USB reports', 'live');
  else if (liveCount) state('Receiving USB reports · ' + liveCount + (liveCount === 1 ? ' live field' : ' live fields'), 'live');
  else state('Receiving USB reports · no readings in the tracked fields', 'live');
}

function scheduleRender() {
  if (!pendingRender) {
    pendingRender = requestAnimationFrame(() => {
      pendingRender = 0;
      $('live-packets').textContent = counter.format(packetCount);
      renderReadings(device?.mode === 'raw' ? [] : selectedPlots(fieldSelect.value));
    });
  }
}

function addPoint(points, sampleAt, value) {
  const at = Math.max(points.at(-1)?.at ?? sampleAt, sampleAt);
  const values = [value];
  for (let i = points.length - 1; i >= 0 && points[i].at >= at - smoothingMs; i--) {
    values.push(points[i].value);
  }
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  points.push({ at, value, median });
}

function receive(message) {
  if (message.type === 'error') throw new Error(message.message);
  if (message.type === 'ready') {
    active.ready = true;
    setDevice(message);
    scheduleRender();
    return;
  }
  if (message.type === 'heartbeat') {
    scheduleRender();
    return;
  }
  if (message.type !== 'report') return;

  const at = message.at;
  startedAt ||= at;
  lastReportAt = at;
  packetCount++;
  const samples = device?.mode === 'dotara' ? decodeStreamPacket(message.hex, device.usbVersion) : [];
  for (const sample of samples) {
    const item = series.get(canonicalKey(sample.kind, sample.offset));
    if (item.recentCopies) {
      const copy = `${sample.clock}:${sample.rawWord}`;
      if (item.recentCopies.has(copy)) continue;
      item.recentCopies.add(copy);
      // Both records can arrive in separate USB reports. Retain recent
      // identities so a repeated reading contributes once to the median.
      if (item.recentCopies.size > 128) item.recentCopies.delete(item.recentCopies.values().next().value);
    }
    const sampleAt = Math.max(startedAt, item.latestRaw?.at ?? startedAt, at - Math.min(sample.ageMs, 3000));
    const hasValue = Number.isFinite(sample.value);
    if (item.unidentified) item.latestRaw = { at: sampleAt, word: sample.rawWord, hasValue };
    if (hasValue) addPoint(item.points, sampleAt, sample.value * item.scale);
  }
  for (const item of series.values()) {
    while (item.points.length > 1 && item.points[1].at < at - windowMs) item.points.shift();
  }
  scheduleRender();
}

export function startMonitoring(info, transport, onError) {
  stopMonitoring();
  const session = { controller: new AbortController(), ready: false, browser: !transport };
  active = session;
  packetCount = lastReportAt = startedAt = 0;
  for (const item of series.values()) {
    item.points = [];
    item.latestRaw = undefined;
    item.recentCopies?.clear();
  }
  setDevice(undefined);
  state('Opening the charger’s USB stream…');
  scheduleRender();
  if (!transport) {
    receive({ type: 'ready', ...info });
    return;
  }
  void transport(session.controller.signal, message => {
    if (active === session) receive(message);
  }).then(() => { throw new Error('The USB stream ended. Select the charger to reconnect.'); }).catch(error => {
    if (active !== session) return;
    stopMonitoring();
    if (onError) onError(error);
    else state(error.message, 'problem');
  });
}

export function stopMonitoring() {
  if (!active) return;
  active.controller.abort();
  active = undefined;
  state('Monitoring stopped');
  scheduleRender();
}

export function updateBrowserMonitor(info) {
  if (active?.browser) receive({ type: 'ready', ...info });
}

export function monitorBrowserReport(message) {
  if (active?.browser) receive({ type: 'report', ...message });
}

setInterval(() => { if (active?.browser) scheduleRender(); }, 1000);
window.addEventListener('pagehide', stopMonitoring);
fieldSelect.addEventListener('change', showGroup);
smoothing.addEventListener('change', scheduleRender);
new ResizeObserver(scheduleRender).observe(plotGrid);
showGroup();
