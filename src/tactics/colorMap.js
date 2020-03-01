/*
 * The original game had a color table from which a color is picked and saved
 * against your account.  This color dictated the color of units on the board.
 *
 * The original game used color multiplication where each channel may be
 * increased by multiplying it with a number greater than 1 or decreased by
 * multiplying it with a number between 0 and 1.  PIXI supports this with the
 * ColorMatrixFilter, but only with WebGL renderers (game board) and not with
 * canvas renderers (info card).  It would require some work to customize the
 * canvas renderer to support ColorMatrixFilter or to otherwise use the WebGL
 * renderer for the info card.  So, fallback to using PIXI tints instead.  A
 * tint is just a numeric color, so it is not possible to increase a color
 * channel - only decrease.  In other words, 0xFFFFFF means to use the existing
 * red/green/blue of the underlying image, while 0x000000 means to remove all
 * red/green/blue from the underlying image.
 */
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
  ['Blue',   [1.10, 1.45, 0.70]],
  ['Aqua',   [0.70, 1.50, 1.50]],
  ['Green',  [0.65, 0.85, 1.35]],
]);

// Map unit names to IDs until we get rid of the IDs.
const colorMap = new Map();
export default colorMap;

colorMap.set('White',  colorsData[0]);
colorMap.set('Red',    colorsData[2]);
colorMap.set('Yellow', colorsData[7]);
colorMap.set('Green',  colorsData[8]);
colorMap.set('Blue',   colorsData[10]);

export const reverseColorMap = new Map([...colorMap].map(kv => kv.reverse()));
