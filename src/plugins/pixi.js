import {
  Matrix,
  Point,
  Polygon,
  Rectangle,

  Container,
  FillGradient,
  Graphics,
  Sprite,
  Text,

  autoDetectRenderer,
  CanvasSource,
  Texture,

  BlurFilter,
  ColorMatrixFilter,

  EventSystem,
  Ticker,
} from 'pixi.js';

if (EventSystem.prototype.updateCursor)
  throw new Error('EventSystem has a conflicting updateCursor method');
Object.defineProperty(EventSystem.prototype, 'updateCursor', {
  value: function () {
    const rootBoundary = this.rootBoundary;
    if (!rootBoundary.rootTarget)
      return;

    const pointer = this.pointer;
    if (pointer.pointerType === 'mouse') {
      const target = rootBoundary.hitTest(pointer.global.x, pointer.global.y);
      this.setCursor(target?.cursor ?? null);
    }
  },
});

for (const tickerName of [ 'shared', 'system' ]) {
  const ticker = Ticker[tickerName];
  ticker.autoStart = false;
  ticker.stop();
}

/*
 * While pixi.js no longer requires the DOM to import modules, importing it will
 * bloat bundle sizes when PIXI isn't technically used.  So, a global is used
 * instead.
 */
window.PIXI = {
  autoDetectRenderer: options => autoDetectRenderer(Object.assign({ failIfMajorPerformanceCaveat:false }, options)),
  filters: { ColorMatrixFilter, BlurFilter },

  CanvasSource,
  Container,
  FillGradient,
  Graphics,
  Matrix,
  Point,
  Polygon,
  Rectangle,
  Sprite,
  Text,
  Texture,
};
