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
  WebGPURenderer,
  CanvasSource,
  Texture,

  BlurFilter,
  ColorMatrixFilter,

  EventSystem,
  Ticker,

  isWebGLSupported,
  isWebGPUSupported,
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
  isWebGLSupported,
  isWebGPUSupported,
  autoDetectRenderer: async options => {
    const preference = localStorage.getItem('preferredRenderer');
    if (preference === 'webgpu' && await isWebGPUSupported()) {
      const webGPUOptions = { ...options, ...options.webgpu };
      delete webGPUOptions.webgl;
      delete webGPUOptions.webgpu;
      const renderer = new WebGPURenderer();
      await renderer.init(webGPUOptions);
      return renderer;
    }

    return autoDetectRenderer(Object.assign({
      preference,
      failIfMajorPerformanceCaveat: false,
    }, options));
  },
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
