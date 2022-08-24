/*
 * Transition 'color1' to 'color2' by 'stop' percent.
 *   When stop is 0: returns color1
 *   When stop is 1: returns color2
 *   When stop is 0.5: returns equal blend of color1 and color2
 *
 * Example: getColorStop(0x000000, 0xFFFFFF, 0.75);
 *   The returned color will be 25% black and 75% white.
 */
Tactics.utils.getColorStop = function (color1, color2, stop) {
  if (isNaN(color1) || color1 === null)
    throw new TypeError('color1 is not a number');
  if (isNaN(color2) || color2 === null)
    throw new TypeError('color2 is not a number');
  if (isNaN(stop) || stop === null)
    throw new TypeError('stop is not a number');
  stop = Math.max(0, Math.min(1, stop));

  const c1R = (color1 & 0xFF0000) >> 16;
  const c1G = (color1 & 0x00FF00) >> 8;
  const c1B = (color1 & 0x0000FF);

  const c2R = (color2 & 0xFF0000) >> 16;
  const c2G = (color2 & 0x00FF00) >> 8;
  const c2B = (color2 & 0x0000FF);

  const cR = Math.floor(c1R*(1-stop) + c2R*stop);
  const cG = Math.floor(c1G*(1-stop) + c2G*stop);
  const cB = Math.floor(c1B*(1-stop) + c2B*stop);

  return (cR << 16) + (cG << 8) + cB;
};

Tactics.utils.getColorFilterStop = function (color1, color2, stop) {
  if (!Array.isArray(color1) || color1.length !== 3)
    throw new TypeError('color1 is not a color filter');
  if (!Array.isArray(color2) || color2.length !== 3)
    throw new TypeError('color2 is not a color filter');
  if (isNaN(stop) || stop === null)
    throw new TypeError('stop is not a number');
  stop = Math.max(0, Math.min(1, stop));

  const c1R = color1[0];
  const c1G = color1[1];
  const c1B = color1[2];

  const c2R = color2[0];
  const c2G = color2[1];
  const c2B = color2[2];

  const cR = c1R * (1-stop) + c2R * stop;
  const cG = c1G * (1-stop) + c2G * stop;
  const cB = c1B * (1-stop) + c2B * stop;

  return [ cR, cG, cB ];
};
