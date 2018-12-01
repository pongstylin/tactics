'use strict';

// Thank you!
// https://stackoverflow.com/questions/9043805/test-if-two-lines-intersect-javascript-function
PIXI.Polygon.prototype.intersects = function (x1, y1, x2, y2) {
  const length = this.points.length / 2;

  // Loop through each side of the polygon
  for (let i = 0, j = length - 1; i < length; j = i++) {
    const x3 = this.points[i * 2];
    const y3 = this.points[(i * 2) + 1];
    const x4 = this.points[j * 2];
    const y4 = this.points[(j * 2) + 1];

    const det = (x2 - x1) * (y4 - y3) - (x4 - x3) * (y2 - y1);
    if (det === 0) continue;

    /*
     * There is a bug that a line might exactly pass through the corner of two sides.
     * Might it be adressed by using '<=' instead of '<'?
     */
    const lambda = ((y4 - y3) * (x4 - x1) + (x3 - x4) * (y4 - y1)) / det;
    const gamma  = ((y1 - y2) * (x4 - x1) + (x2 - x1) * (y4 - y1)) / det;
    const intersects = (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);

    if (intersects)
      return true;
  }

  return false;
};
