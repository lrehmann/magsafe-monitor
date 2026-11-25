import { appleVendorId, chargerProfiles, newerFirmwareVersion } from './charger-profiles.mjs?v=13';
import { readBrowserDiagnostics } from './browser-uarp.mjs';
import { readLocalDiagnostics, readLocalStream } from './local-transport.mjs?v=9';
import { pairHelper } from './hosted-helper.mjs';
import { startMonitoring, stopMonitoring, monitorBrowserReport, updateBrowserMonitor } from './live-monitor.mjs?v=13';

const $ = id => document.getElementById(id);
const el = (tag, text = '', className = '') => Object.assign(document.createElement(tag), {textContent: text, className});
const countFormat = new Intl.NumberFormat();
const code = (value, width = 2) => '0x' + value.toString(16).toUpperCase().padStart(width, '0');
const hexBytes = Array.from({length: 256}, (_, i) => i.toString(16).padStart(2, '0'));
const hid = navigator.hid;
const local = location.origin === 'http://127.0.0.1:8778';
const knownA2140Builds = new Set([0x0174, 0x0247, 0x0255, 0x0258]);
const labels = {
  usbIdentity: 'USB identity', manufacturer: 'Manufacturer', model: 'Model', hardware: 'Hardware label',
  activeFirmware: 'Active firmware', stagedFirmware: 'Staged firmware', hardwareFusingType: 'Hardware fusing type',
  statistics: 'UARP statistics', lastError: 'UARP last error', firmwareBuild: 'Firmware build',
  productionMode: 'Production mode flag', provisioningStatus: 'Provisioning status', bootDiagnostics: 'Boot diagnostics',
  updateStatus: 'Update status', bootloaderRevision: 'Bootloader revision', componentRevisions: 'Component revisions',
  hardwareProductId: 'Hardware product ID',
};
const devices = new Map();
const reports = [];
let storedBytes = 0;
let current;
let diagnostics;
let busy = false;
let helper;
let renderTimer;

function selections(items) {
  return items.filter(device => device.vendorId === appleVendorId && chargerProfiles.has(device.productId));
}
const collections = device => device.collections.filter(collection => collection.usagePage === 0xff00);

function renderLog() {
  renderTimer = undefined;
  for (const record of devices.values()) {
    const currentState = record.device.opened ? 'Listening' : record.error || 'Closed';
    record.status.textContent = `${currentState} · ${countFormat.format(record.count)} reports`;
  }
  if (!$('packets').closest('details').open) return;
  const log = $('packets');
  const visible = reports.slice(-40).reverse();
  if (!visible.length) {
    log.replaceChildren(el('p', 'Waiting for HID input reports.', 'empty'));
    return;
  }
  const rows = new Map([...log.children].map(row => [row.dataset.id, row]));
  log.replaceChildren(...visible.map(item => {
    if (rows.has(String(item.id))) return rows.get(String(item.id));
    const row = el('details', '', 'packet');
    row.dataset.id = item.id;
    const usage = item.usage === null ? 'HID' : code(item.usage);
    row.append(el('summary', `${usage} · Report ${code(item.reportId)} · ${item.length} B`, 'mono'));
    row.append(el('pre', item.hex.match(/../g)?.join(' ').toUpperCase() || ''));
    return row;
  }));
}

function store(input) {
  if (reports.length >= 50000 || storedBytes + input.hex.length / 2 > 16 * 1024 * 1024) return;
  storedBytes += input.hex.length / 2;
  reports.push({ id: reports.length + 1, ...input, length: input.hex.length / 2 });
  $('export').disabled = false;
  if (!renderTimer) renderTimer = setTimeout(renderLog, 250);
}

function onInput(record, {data, reportId}) {
  if (current?.controller.signal.aborted || !current) return;
  const candidates = record.collections.filter(collection => collection.inputReports.some(report => report.reportId === reportId));
  const collection = candidates.length === 1 ? candidates[0] : record.collections.length === 1 ? record.collections[0] : null;
  const usage = collection?.usage ?? null;
  const payload = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), n => hexBytes[n]).join('');
  const input = { at: Date.now(), usage, reportId, hex: payload };
  record.count++;
  store({ ...input, interfaceId: record.id });
  if (!current.native && (usage === 0x10 || usage === 0x11)) {
    const frame = reportId ? hexBytes[reportId] + payload : payload;
    monitorBrowserReport({ ...input, hex: frame });
  }
}

async function openDevices(selected) {
  const panel = $('interfaces');
  panel.replaceChildren();
  return Promise.all(selected.map(async (device, index) => {
    const descriptor = collections(device);
    const profile = chargerProfiles.get(device.productId);
    const names = descriptor.map(item => profile.interfaces.find(known => known.usage === item.usage)?.name ?? code(item.usage));
    const row = el('div', '', 'channel');
    row.append(el('strong', names.join(' / ') || device.productName || profile.name, 'usage'));
    for (const item of descriptor) {
      const input = item.inputReports.map(report => code(report.reportId)).join(', ');
      const output = item.outputReports.map(report => code(report.reportId)).join(', ');
      const details = [code(item.usage), input && `Input ${input}`, output && `Output ${output}`].filter(Boolean);
      row.append(el('p', details.join(' · '), 'mono'));
    }
    const status = el('p', 'Opening…', 'channel-status');
    row.append(status);
    panel.append(row);
    const record = { device, collections: descriptor, id: index + 1, status, count: 0 };
    devices.set(device, record);
    record.listener = event => onInput(record, event);
    device.addEventListener('inputreport', record.listener);
    try {
      if (!device.opened) await device.open();
      status.textContent = 'Listening';
    } catch (error) {
      device.removeEventListener('inputreport', record.listener);
      record.error = error.message;
      status.textContent = error.message;
    }
    return record;
  }));
}

function resetHidStatus() {
  $('interfaces').replaceChildren(el('p', 'Select a charger to see its interfaces.', 'empty'));
}

function renderDiagnostics(result, productId) {
  diagnostics = result;
  const update = newerFirmwareVersion(productId, result.model?.value, result.activeFirmware?.value);
  const values = $('diagnostic-values');
  values.replaceChildren(...Object.entries(labels).filter(([key]) => result[key]).map(([key, label]) => {
    const cell = el('div');
    const value = String(result[key].value ?? result[key].error);
    const reading = el('dd');
    if (key === 'activeFirmware' && update) {
      reading.append(
        el('span', value, 'mono firmware-outdated'),
        el('small', `Firmware update available (${update}).`, 'firmware-notice'),
      );
    } else {
      reading.className = 'mono';
      reading.textContent = value;
    }
    cell.append(el('dt', label), reading);
    return cell;
  }));
  values.hidden = false;
  $('export').disabled = false;
}

function profileInfo(session, build = 0) {
  const productId = session.productId;
  return {productId, usbVersion: build, usages: session.usages, passive: true,
    mode: productId === 0x0500 && knownA2140Builds.has(build) ? 'dotara' : 'raw'};
}

async function diagnose(session, reader) {
  session.diagnostics?.abort();
  const controller = new AbortController();
  session.diagnostics = controller;
  $('diagnostic-status').textContent = 'Reading charger diagnostics…';
  try {
    const result = await reader(controller.signal);
    if (controller.signal.aborted || current !== session) return;
    renderDiagnostics(result, session.productId);
    if (!session.native) {
      const version = result.activeFirmware?.value?.split('.')[0];
      const build = version && /^\d{1,4}$/.test(version) ? Number.parseInt(version, 16) : 0;
      updateBrowserMonitor(profileInfo(session, build));
    }
    $('diagnostic-status').textContent = 'Read over USB · UARP ' + result.protocolVersion;
  } catch (error) {
    if (!controller.signal.aborted && current === session) $('diagnostic-status').textContent = error.message;
  }
}

function useNative(session, transport) {
  session.native = true;
  startMonitoring(profileInfo(session), (signal, publish) => transport.stream(signal, message => {
    if (message.type === 'ready' && message.productId !== session.productId) {
      throw new Error('The helper sees a different charger. Select the connected device again.');
    }
    publish(message);
  }), error => {
    session.native = false;
    startMonitoring({ ...profileInfo(session), notice: error.message });
    if (!local) {
      $('helper').hidden = false;
      $('helper-status').textContent = error.message;
    }
  });
  void diagnose(session, transport.diagnostics);
}

async function stopSession() {
  if (current) {
    current.controller.abort();
    current.diagnostics?.abort();
    current = undefined;
  }
  stopMonitoring();
  $('stop').disabled = true;
  await Promise.all([...devices.values()].map(async ({device, listener}) => {
    device.removeEventListener('inputreport', listener);
    if (device.opened) await device.close().catch(() => {});
  }));
  renderLog();
}

async function connect(pick) {
  if (busy || !hid) return;
  busy = true;
  $('connect').disabled = true;
  try {
    const selected = selections(pick
      ? await hid.requestDevice({filters: [...chargerProfiles.keys()].map(productId => ({vendorId: appleVendorId, productId}))})
      : await hid.getDevices());
    if (!selected.length) return;
    await stopSession();
    devices.clear();
    reports.length = storedBytes = 0;
    diagnostics = undefined;
    $('export').disabled = true;
    $('diagnostic-values').hidden = true;
    const productId = selected[0].productId;
    const chosen = selected.filter(device => device.productId === productId);
    const session = {controller: new AbortController(), productId, usages: [...new Set(chosen.flatMap(device => collections(device).map(item => item.usage)))]};
    current = session;
    $('diagnostic-status').textContent = 'Opening charger interfaces…';
    const opened = await openDevices(chosen);
    if (current !== session) return;
    const available = opened.filter(record => record.device.opened);
    if (!available.length) throw new Error('Chrome could not open the selected charger.');
    $('stop').disabled = false;
    $('helper').hidden = local || productId !== 0x0500 || Boolean(helper);
    if (local) useNative(session, {stream: readLocalStream, diagnostics: readLocalDiagnostics});
    else if (helper && productId === 0x0500) useNative(session, helper);
    else {
      startMonitoring(profileInfo(session));
      const uarp = available.find(record => record.collections.some(item => item.usage === 0x46))?.device;
      void diagnose(session, signal => readBrowserDiagnostics(uarp, signal));
    }
    renderLog();
  } catch (error) {
    $('diagnostic-status').textContent = error.message;
  } finally {
    busy = false;
    $('connect').disabled = false;
  }
}

$('connect').addEventListener('click', () => void connect(true));
$('stop').addEventListener('click', () => void stopSession());
$('packets').closest('details').addEventListener('toggle', renderLog);
$('pair-helper').addEventListener('click', async () => {
  $('pair-helper').disabled = true;
  $('helper-status').textContent = 'Waiting for the Mac helper window…';
  try {
    helper = await pairHelper();
    $('helper').hidden = true;
    if (current?.productId === 0x0500) useNative(current, helper);
  } catch (error) {
    $('helper-status').textContent = error.message;
  } finally {
    $('pair-helper').disabled = false;
  }
});
$('export').addEventListener('click', () => {
  const capture = { diagnostics, interfaces: [...devices.values()].map(record => ({
    id: record.id, vendorId: record.device.vendorId, productId: record.device.productId,
    productName: record.device.productName, collections: record.collections,
  })), reports };
  const url = URL.createObjectURL(new Blob([JSON.stringify(capture)], {type:'application/json'}));
  const link = el('a');
  link.href = url;
  link.download = 'magsafe-capture-' + new Date().toISOString().replaceAll(':','-') + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
resetHidStatus();
if (hid) {
  hid.addEventListener('disconnect', ({device}) => {
    if (!devices.has(device)) return;
    if ([...devices.keys()].some(other => other !== device && other.opened)) {
      renderLog();
      return;
    }
    void stopSession();
    $('diagnostic-status').textContent = 'Charger disconnected.';
  });
  if (local) void connect(false);
} else {
  $('connect').disabled = true;
  $('diagnostic-status').textContent = 'Open this page in desktop Chrome with WebHID available.';
}
