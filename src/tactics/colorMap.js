'use strict';

/*
 * The original game had a color table from which a color is picked and saved
 * against your account.  This color dictated the color of units on the board.
 *
 * The original color IDs and colors are known and represented here, although
 * the original color is commented out and replaced with more vivid colors.
 */
const colorsData = [
  0,
  0,
  0xFF0000,//0xFF6057,
  0,
  0,
  0,
  0,
  0xFFEE00,//0xFCEE5C,
  0x88FF00,//0xC4FE7C,
  0,
  0x0088FF//0x789EFF
];

// Map unit names to IDs until we get rid of the IDs.
const colorMap = new Map();
export default colorMap;

colorMap.set('White',  0xFFFFFF);
colorMap.set('Red',    colorsData[2]);
colorMap.set('Yellow', colorsData[7]);
colorMap.set('Green',  colorsData[8]);
colorMap.set('Blue',   colorsData[10]);

export const reverseColorMap = new Map([...colorMap].map(kv => kv.reverse()));
