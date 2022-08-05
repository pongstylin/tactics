const colorsData = [
  0xFFFFFF,
  0,
  0xFF0000,
  0,
  0,
  0,
  0,
  0xFFEE00,
  0x88FF00,
  0,
  0x0088FF
];

/*
 * These are the actual color multipliers from the original game.
 */
export const colorFilterMap = new Map([
  ['Black',  [1.00, 1.00, 1.00]],
  ['White',  [1.99, 1.99, 1.99]],
  ['Red',    [1.45, 0.55, 0.50]],
  ['Pink',   [1.99, 1.25, 1.30]],
  ['Purple', [1.10, 0.95, 1.35]],
  ['Orange', [1.99, 1.20, 0.01]],
  ['Brown',  [1.05, 0.80, 0.60]],
  ['Yellow', [1.99, 1.85, 0.70]],
  ['Green',  [1.10, 1.45, 0.70]],
  ['Teal',   [0.70, 1.50, 1.50]],
  ['Blue',   [0.65, 0.85, 1.35]],
]);

export const numifyColorFilter = rgb => {
  const scale = Math.max(1, ...rgb);
  const r = Math.round(rgb[0] / scale * 0xFF);
  const g = Math.round(rgb[1] / scale * 0xFF);
  const b = Math.round(rgb[2] / scale * 0xFF);

  return r * 0x010000 + g * 0x000100 + b;
};

// Map unit names to IDs until we get rid of the IDs.
const colorMap = new Map();
export default colorMap;

colorMap.set('White',  colorsData[0]);
colorMap.set('Red',    colorsData[2]);
colorMap.set('Yellow', colorsData[7]);
colorMap.set('Green',  colorsData[8]);
colorMap.set('Blue',   colorsData[10]);

export const reverseColorMap = new Map([...colorMap].map(kv => kv.reverse()));
