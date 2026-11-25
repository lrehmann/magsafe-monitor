import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newerFirmwareVersion } from '../dist/charger-profiles.mjs';
import { decodeStreamPacket, streamLayout } from '../dist/dotara-stream.mjs';
import { decodeUarpReply } from '../dist/uarp-replies.mjs';

function record(clock, kind, sequence, body) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(clock);
  header.writeUInt16LE(kind, 4);
  header.writeUInt16LE(sequence, 6);
  return Buffer.concat([header, body]);
}

function packet(...records) {
  return Buffer.concat([Buffer.from([0x02, 0x90]), ...records]).toString('hex');
}

test('decodes consecutive A2140 float and integer records', () => {
  const charge = Buffer.alloc(36);
  charge.writeFloatLE(7.25, 0);
  charge.writeFloatLE(0.5, 4);
  charge.writeFloatLE(32.75, 0x14);
  const budget = Buffer.alloc(44);
  budget.writeUInt32LE(18000, 4);
  const reports = packet(record(1000, 0x1c74, 4, charge), record(1057, 0x0818, 5, budget));
  const readings = decodeStreamPacket(reports, 0x0258);

  assert.deepEqual(readings.find(sample => sample.kind === 0x1c74 && sample.offset === 0x14), {
    kind: 0x1c74, offset: 0x14, value: 32.75, rawWord: 0x42030000, clock: 1000, ageMs: 57,
  });
  assert.equal(readings.find(sample => sample.kind === 0x0818 && sample.offset === 4).value, 18000);
  assert.deepEqual(decodeStreamPacket(reports.slice(0, -4), 0x0258).map(sample => sample.kind), Array(6).fill(0x1c74));
  assert.deepEqual(decodeStreamPacket('0290nothex', 0x0258), []);
});

test('maps the legacy USB revision to its firmware-specific record ID and size', () => {
  const charge = Buffer.alloc(24);
  charge.writeFloatLE(22.5, 0x14);
  const reports = packet(record(1000, 0x1c34, 1, charge));
  const readings = decodeStreamPacket(reports, 0x0174);

  assert.deepEqual(streamLayout(0x0174).map(item => item.wireKind), [0x1c34, 0x3128, 0x37c4]);
  assert.equal(readings.find(sample => sample.kind === 0x1c74 && sample.offset === 0x14).value, 22.5);
  assert.deepEqual(decodeStreamPacket(reports, 0x0258), []);
});

test('validates the frame for an active-firmware UARP reply', () => {
  const frame = new DataView(new ArrayBuffer(38));
  frame.setUint16(4, 32, true);
  frame.setUint16(6, 4);
  frame.setUint16(8, 26);
  frame.setUint32(14, 5);
  frame.setUint32(18, 16);
  frame.setUint32(22, 258);

  const reply = decodeUarpReply(0x46, 0x02, frame);
  assert.equal(reply.property, 5);
  assert.equal(reply.valueLength, 16);
  assert.equal(decodeUarpReply(0x11, 0x02, frame), null);
  frame.setUint32(18, 17);
  assert.equal(decodeUarpReply(0x46, 0x02, frame), null);
});

test('compares active firmware within the verified charger model', () => {
  const cases = [
    [0x0500, 'A2140', '255.0.0.0', '258.0.0.0'],
    [0x0500, 'A2140', '258.0.0.0', undefined],
    [0x0500, 'A2140', '259.0.0.0', undefined],
    [0x0506, 'A2580', '136.0.0.0', '148.0.0.0'],
    [0x0506, 'A3250', '128.0.0.0', '148.0.0.0'],
    [0x0506, 'A3502', '136.0.0.0', undefined],
    [0x0506, 'A3503', '136.0.0.0', undefined],
    [0x0506, undefined, '136.0.0.0', undefined],
    [0x0506, 'A2580', '00 00 00 00', undefined],
  ];
  for (const [productId, model, active, expected] of cases) {
    assert.equal(newerFirmwareVersion(productId, model, active), expected, `${model} ${active}`);
  }
});
