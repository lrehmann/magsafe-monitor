import { decodeUarpReply } from './uarp-replies.mjs';

const propertyKeys = { 1: 'manufacturer', 2: 'model', 4: 'hardware', 5: 'activeFirmware', 6: 'stagedFirmware', 7: 'statistics', 8: 'lastError' };
const decoder = new TextDecoder();
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join(' ').toUpperCase();

export function uarpRequest(type, messageId, argument) {
  const size = type === 1 ? 2 : type === 3 ? 4 : 0;
  const frame = new Uint8Array(12 + size);
  const view = new DataView(frame.buffer);
  view.setUint16(0, 0x4002, true);
  view.setUint16(2, messageId + 1, true);
  view.setUint16(4, size + 6, true);
  view.setUint16(6, type);
  view.setUint16(8, size);
  view.setUint16(10, messageId);
  if (size) view.setUint16(frame.length - 2, argument);
  return frame.subarray(1);
}

function receiveReply(device, type, id, argument, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    function complete(value, error) {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      device.removeEventListener('inputreport', receive);
      if (error) reject(error);
      else resolve(value);
    }
    const cancel = () => complete(undefined, signal.reason);
    const receive = event => {
      const reply = decodeUarpReply(0x46, event.reportId, event.data);
      if (!reply || reply.type !== (type === 0 ? 0 : type + 1)) return;
      if (type === 3 && reply.status === 0 && reply.property !== argument) return;
      complete({ reply, data: event.data });
    };
    const timer = setTimeout(() => complete(undefined, new Error('The charger did not respond to a diagnostic request.')), 850);
    signal.addEventListener('abort', cancel, { once: true });
    device.addEventListener('inputreport', receive);
    device.sendReport(0x02, uarpRequest(type, id, argument)).catch(error => complete(undefined, error));
  });
}

export async function readBrowserDiagnostics(device, signal) {
  if (!device) throw new Error('The selected charger has no open UARP interface.');
  let id = 0;
  await receiveReply(device, 0, id++, 0, signal);
  const { reply } = await receiveReply(device, 1, id++, 1, signal);
  if (reply.status || !reply.version) throw new Error('The charger rejected the diagnostic handshake.');
  const result = { protocolVersion: reply.version };
  for (const [property, key] of Object.entries(propertyKeys)) {
    try {
      const { data, reply: response } = await receiveReply(device, 3, id++, Number(property), signal);
      if (response.status) {
        result[key] = { error: `Device status ${response.status}` };
        continue;
      }
      const bytes = new Uint8Array(data.buffer, data.byteOffset + 22, response.valueLength);
      let value = hex(bytes);
      if (Number(property) <= 4) value = decoder.decode(bytes);
      if ((property === '5' || property === '6') && bytes.length === 16) {
        const version = Array.from({length: 4}, (_, i) => data.getUint32(22 + i * 4));
        value = version.some(Boolean) ? version.join('.') : 'None';
      }
      result[key] = { value, hex: hex(bytes) };
    } catch (error) {
      if (signal.aborted) throw error;
      result[key] = { error: 'No reply' };
    }
  }
  return result;
}
