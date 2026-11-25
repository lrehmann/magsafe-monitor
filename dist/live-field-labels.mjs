// Labels in brackets are hypotheses from the captured values or calibration
// layout. The resonance fields were cross-checked against the coil equations.
export const fieldLabels = {
  0x1c74: {
    0x00: ['[Charging power]'],
    0x04: ['[Charging current]'],
    0x08: ['[Control code]'],
    0x0c: ['[Auxiliary temperature 1]'],
    0x10: ['[Auxiliary temperature 2]'],
    0x14: ['Charging thermistor temperature A', '°C'],
  },
  0x0bf8: {
    0x00: ['[Coil test state]'],
    0x0c: ['Coil resonant frequency', 'kHz', 0.001],
    0x10: ['Calculated coil inductance', 'µH', 1e6],
    0x14: ['Coil quality factor (Q)'],
    0x18: ['Equivalent coil AC resistance', 'Ω'],
    0x1c: ['[Full coil DC resistance]', 'Ω'],
    0x20: ['[Quarter coil DC resistance]', 'Ω'],
    0x24: ['Idle thermistor temperature B', '°C'],
  },
  0x3b9c: {
    0x00: ['[Charging power estimate]'],
    0x04: ['[Charging current estimate]'],
    0x08: ['[Control level]'],
    0x0c: ['[Control level ceiling]'],
    0x10: ['[Control state]'],
  },
  0x2384: {
    0x00: ['[Adjusted power estimate]'],
    0x04: ['[Charging power estimate]'],
    0x08: ['[Charging current estimate]'],
    0x0c: ['Mean of four selected terms'],
    0x14: ['Coil AC resistance reference', 'Ω'],
  },
  0x2d14: {
    0x00: ['Adjusted estimate minus reference'],
    0x04: ['Difference threshold mode'],
    0x08: ['Difference threshold'],
    0x0c: ['95% of difference threshold'],
    0x10: ['[Power estimate before adjustment]'],
    0x14: ['[Power estimate after adjustment]'],
    0x18: ['[Adjustment state]'],
    0x1c: ['[Efficiency factor]'],
  },
  0x16d0: {
    0x00: ['[Quarter DC excitation]'],
    0x04: ['[Quarter DC sense]'],
    0x08: ['[Quarter coil DC resistance]', 'Ω'],
    0x0c: ['[Full DC excitation]'],
    0x10: ['[Full DC sense]'],
    0x14: ['[Full coil DC resistance]', 'Ω'],
  },
  0x2ee8: { 0x04: ['[Power estimate]'] },
  0x024c: { 0x00: ['[Status flags]'], 0x04: ['[Voltage monitor]'], 0x08: ['[Packed status bits]'] },
  0x0818: { 0x00: ['[Available power ÷ 1,000]', '', 0.001], 0x04: ['[Status power limit ÷ 1,000]', '', 0.001], 0x08: ['[Drive frequency setting]', 'kHz', 0.001] },
  0x21e4: { 0x00: ['[Signed status code]'], 0x04: ['[Status flag]'] },
  0x1494: { 0x00: ['[Power request]'] },
  0x3450: { 0x00: ['[Internal voltage]'] },
  0x359c: { 0x00: ['[Internal temperature]'] },
  0x360c: { 0x00: ['[Requested power limit ÷ 1,000]', '', 0.001], 0x04: ['[Charging update limit ÷ 1,000]', '', 0.001] },
  0x4894: { 0x00: ['[Idle scan step]'] },
};

// These pairs report the same sample at a shared firmware timestamp.
export const fieldAliases = [
  { source: [0x2384, 0x04], canonical: [0x3b9c, 0x00] },
  { source: [0x2384, 0x08], canonical: [0x3b9c, 0x04] },
];

export const combinedFields = [
  { label: '[Charging power comparison]', wide: true, traces: [
    [0x1c74, 0x00], [0x2ee8, 0x04], [0x2384, 0x00, undefined, 3], [0x3b9c, 0x00, undefined, 2],
    [0x2d14, 0x10], [0x2d14, 0x14], [0x1494, 0x00], [0x0818, 0x00], [0x0818, 0x04],
    [0x360c, 0x00], [0x360c, 0x04],
  ] },
  { label: '[Charging current comparison]', wide: true, traces: [
    [0x1c74, 0x04], [0x3b9c, 0x04],
  ] },
  { label: 'Temperatures', wide: true, traces: [
    [0x1c74, 0x14, 'A · Charging thermistor'], [0x0bf8, 0x24, 'B · Idle thermistor'],
    [0x1c74, 0x0c], [0x1c74, 0x10], [0x359c, 0x00],
  ] },
  { label: 'Coil AC resistance', traces: [
    [0x2384, 0x14, 'Charging reference'], [0x0bf8, 0x18, 'Idle measurement'],
  ] },
  { label: '[Full coil DC resistance]', traces: [
    [0x0bf8, 0x1c, 'Coil test'], [0x16d0, 0x14, 'DC test'],
  ] },
  { label: '[Quarter coil DC resistance]', traces: [
    [0x0bf8, 0x20, 'Coil test'], [0x16d0, 0x08, 'DC test'],
  ] },
];
