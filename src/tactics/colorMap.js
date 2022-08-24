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

export const numifyColor = color => {
  if (typeof color === 'number')
    return color;
  else if (typeof color === 'string')
    return numifyColorFilter(colorFilterMap.get(color));
  else
    return numifyColorFilter(color);
};
