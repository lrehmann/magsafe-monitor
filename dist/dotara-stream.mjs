export function hexLabel(value, digits) {
  return '0x' + value.toString(16).toUpperCase().padStart(digits, '0');
}

// Offsets are relative to the record body. The encodings give the observed
// values a numeric representation. Field meanings and units are unverified.
export const streamRecords = [
  { kind: 0x1c74, bytes: 36, offsets: [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14] },
  { kind: 0x0bf8, bytes: 40, offsets: [0x00, 0x04, 0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24] },
  { kind: 0x3b9c, bytes: 20, offsets: [0x00, 0x04, 0x08, 0x0c, 0x10] },
  { kind: 0x2384, bytes: 24, offsets: [0x00, 0x04, 0x08, 0x0c, 0x14] },
  { kind: 0x2d14, bytes: 32, offsets: [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c] },
  { kind: 0x16d0, bytes: 24, offsets: [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14] },
  { kind: 0x2ee8, bytes: 16, offsets: [0x04, 0x08] },
  { kind: 0x024c, bytes: 32, encoding: 'u32', offsets: [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c] },
  { kind: 0x051c, bytes: 16, encoding: 'u32', offsets: [0x0c] },
  { kind: 0x0818, bytes: 44, encoding: 'u32', offsets: [0x00, 0x04, 0x08, 0x10, 0x14, 0x20, 0x24, 0x28] },
  { kind: 0x21e4, bytes: 8, encoding: 'i32', offsets: [0x00, 0x04] },
  { kind: 0x1494, bytes: 4, offsets: [0x00] },
  { kind: 0x3450, bytes: 4, offsets: [0x00] },
  { kind: 0x359c, bytes: 4, offsets: [0x00] },
  { kind: 0x360c, bytes: 8, encoding: 'u32', offsets: [0x00, 0x04] },
  { kind: 0x4894, bytes: 4, encoding: 'u32', offsets: [0x00] },
  { kind: 0x1e00, bytes: 4, encoding: 'u32', offsets: [0x00] },
  { kind: 0x34f4, bytes: 4, encoding: 'u32', offsets: [0x00] },
  { kind: 0x1d60, bytes: 8, encoding: 'u32', offsets: [0x00, 0x04] },
  { kind: 0x2258, bytes: 8, encoding: 'u32', offsets: [0x00, 0x04] },
  { kind: 0x3c64, bytes: 12, encoding: 'u32', offsets: [0x08] },
];
const recordsByKind = new Map(streamRecords.map(record => [record.kind, record]));
const emptyRecordKinds = new Set([0x0958, 0x09c0]);

// The earlier firmware keeps the USB descriptor while using other log IDs.
// Only include writers whose body size and field order match in the images.
const legacyRecords = [
  [0x1c34, 0x1c74, 24],
  [0x3128, 0x2ee8, 16],
  [0x37c4, 0x360c, 8],
].map(([wireKind, kind, bytes]) => ({ ...recordsByKind.get(kind), wireKind, bytes }));
const legacyByWireKind = new Map(legacyRecords.map(record => [record.wireKind, record]));
const legacyEmptyKinds = new Set([0x0bd0]);

export function streamLayout(version) {
  return version === 0x0174 ? legacyRecords : streamRecords;
}

export function decodeStreamPacket(hex, version) {
  if (!hex.startsWith('0290') || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return [];
  const bytes = Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
  const view = new DataView(bytes.buffer);
  const legacy = version === 0x0174;
  const registry = legacy ? legacyByWireKind : recordsByKind;
  const emptyKinds = legacy ? legacyEmptyKinds : emptyRecordKinds;
  const samples = [];
  let lastClock = 0;
  let offset = 2;

  // Each record begins with a little-endian clock, type and sequence number.
  // Empty markers can precede the next header immediately. Only decode
  // records whose type and body length match a known layout.
  while (offset + 8 <= bytes.length) {
    const clock = view.getUint32(offset, true);
    const kind = view.getUint16(offset + 4, true);
    const nextSequence = (view.getUint16(offset + 6, true) + 1) & 0xffff;
    const body = offset + 8;
    let next = bytes.length;
    const firstBoundary = emptyKinds.has(kind) ? body : body + 4;
    for (let position = firstBoundary; position + 8 <= bytes.length; position += 4) {
      const delta = (view.getUint32(position, true) - clock) >>> 0;
      if (delta < 30_000 && view.getUint16(position + 6, true) === nextSequence) {
        next = position;
        break;
      }
    }

    const record = registry.get(kind);
    if (record?.bytes === next - body) {
      for (const offset of record.offsets) {
        const position = body + offset;
        const rawWord = view.getUint32(position, true);
        let value;
        if (record.encoding === 'u32') value = rawWord;
        else if (record.encoding === 'i32') value = view.getInt32(position, true);
        else value = view.getFloat32(position, true);
        samples.push({ kind: record.kind, offset, value, rawWord, clock });
      }
    }
    lastClock = clock;
    offset = next;
  }

  return samples.map(sample => ({ ...sample, ageMs: (lastClock - sample.clock) >>> 0 }));
}
