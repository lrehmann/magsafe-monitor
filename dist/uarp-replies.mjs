const messageNames = { 0: 'Sync', 2: 'Version discovery', 4: 'Information response', 0xffff: 'Apple vendor response' };

export const propertyNames = {
  1: 'Manufacturer', 2: 'Model', 3: 'Serial number', 4: 'Hardware label',
  5: 'Active firmware', 6: 'Staged firmware', 7: 'Statistics', 8: 'Last error',
};

export function decodeUarpReply(usage, reportId, data) {
  if (usage !== 0x46 || reportId !== 0x02 || data.byteLength < 12) return null;
  const type = data.getUint16(6);
  const messageName = messageNames[type];
  const frameLength = data.getUint16(4, true);
  const bodyLength = data.getUint16(8);
  const end = frameLength + 6;
  if (!messageName || end > data.byteLength || bodyLength !== frameLength - 6) return null;
  for (let i = end; i < data.byteLength; i++) if (data.getUint8(i) !== 0) return null;

  const reply = {
    messageName, type, messageId: data.getUint16(10), flags: data.getUint16(0, true),
    transportSequence: data.getUint16(2, true), frameLength, bodyLength,
  };
  switch (type) {
    case 0:
      return bodyLength === 0 ? reply : null;
    case 2:
      return bodyLength === 4 ? { ...reply, status: data.getUint16(12), version: data.getUint16(14) } : null;
    case 0xffff: {
      if (bodyLength < 17 || data.getUint32(12) !== 0xbc096300 || data.getUint8(16) !== 0x21) return null;
      const status = data.getUint32(17);
      const valueLength = data.getUint32(25);
      if (valueLength !== bodyLength - 17) return null;
      return { ...reply, status, appleProperty: data.getUint32(21), valueLength };
    }
    case 4: {
      if (bodyLength < 2) return null;
      const status = data.getUint16(12);
      if (status !== 0) return { ...reply, status };
      if (bodyLength < 10 || data.getUint32(18) !== bodyLength - 10) return null;
      return { ...reply, status, property: data.getUint32(14), valueLength: data.getUint32(18) };
    }
  }
}
