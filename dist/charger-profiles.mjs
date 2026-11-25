export const appleVendorId = 0x05ac;
export const chargerProfiles = new Map([
  [0x0500, { name: 'A2140', interfaces: [
    { usage: 0x11, name: 'Inductive Tx', usbInterface: 2, inputId: 0x02, payloadBytes: 257 },
    { usage: 0x0b, name: 'Device Management', usbInterface: 0, inputId: 0xe0, payloadBytes: 257 },
    { usage: 0x46, name: 'USB Power Delivery (UFP)', usbInterface: 1, inputId: 0x02, payloadBytes: 4096, outputId: 0x02 },
  ] }],
  [0x0506, { name: '25W MagSafe Charger', interfaces: [
    { usage: 0x10, name: 'Inductive USB input', inputId: 0x00, payloadBytes: 257 },
    { usage: 0x11, name: 'Inductive Tx', inputId: 0x00, payloadBytes: 257 },
    { usage: 0x46, name: 'USB Power Delivery (UFP)', inputId: 0x02, payloadBytes: 4096, outputId: 0x02 },
  ] }],
]);

// Verified 2026-11-25 against Apple's MobileAsset catalogs for UARP.A2140
// (10M3761) and UARP.A2580 (2A168, shared by A2580 and A3250).
// The 0x0506 USB ID is also used by A3502. Require a model for that ID.
const firmwareBaselines = new Map([
  [0x0500, { models: ['A2140'], version: '258.0.0.0' }],
  [0x0506, { models: ['A2580', 'A3250'], version: '148.0.0.0' }],
]);

export function newerFirmwareVersion(productId, model, activeVersion) {
  const baseline = firmwareBaselines.get(productId);
  const modelNumber = model?.match(/\bA\d{4}\b/i)?.[0].toUpperCase();
  if (!baseline || (modelNumber ? !baseline.models.includes(modelNumber) : productId !== 0x0500)) return;
  // A decoded UARP firmware version has four decimal components.
  if (typeof activeVersion !== 'string' || !/^\d{1,10}(?:\.\d{1,10}){3}$/.test(activeVersion)) return;
  const installed = activeVersion.split('.').map(Number);
  if (!installed.some(Boolean)) return;
  const latest = baseline.version.split('.').map(Number);
  const difference = latest.findIndex((part, index) => installed[index] !== part);
  if (difference >= 0 && installed[difference] < latest[difference]) return baseline.version;
}
