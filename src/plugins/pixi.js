/*
 * Some Tactics classes are shared between the client and server.  Some of them
 * requires PIXI classes.  But, PIXI requires the 'document' object to load
 * modules successfully.  So, provide an alternate, global access point.
 */
import {
  Renderer, BatchRenderer,
  BaseTexture, Texture,
  extensions
} from '@pixi/core';
import { InteractionManager } from '@pixi/interaction';
import { Container } from '@pixi/display';
import { Sprite } from '@pixi/sprite';
import { Graphics } from '@pixi/graphics';
import { Text } from '@pixi/text';
import { Rectangle, Polygon, Point } from '@pixi/math';
import { ColorMatrixFilter } from '@pixi/filter-color-matrix';
import { BlurFilter } from '@pixi/filter-blur';
import { CanvasRenderer } from '@pixi/canvas-renderer';
import { CanvasSpriteRenderer } from '@pixi/canvas-sprite';
import { CanvasGraphicsRenderer } from '@pixi/canvas-graphics';
import '@pixi/canvas-display';
import '@pixi/canvas-text';
import { Extract } from '@pixi/extract';

extensions.add(Extract);
extensions.add(BatchRenderer);
extensions.add(InteractionManager);
extensions.add(CanvasSpriteRenderer);
extensions.add(CanvasGraphicsRenderer);
extensions.add(InteractionManager);

window.PIXI = {
  Renderer,
  CanvasRenderer,
  BaseTexture,
  Texture,
  Container,
  Sprite,
  Graphics,
  Text,
  Rectangle,
  Polygon,
  Point,
  filters: { ColorMatrixFilter, BlurFilter },
};

/*
 * Add support for gradient line styles in canvas graphics
 */
const superCalcCanvasStyle = CanvasGraphicsRenderer.prototype._calcCanvasStyle;
if (superCalcCanvasStyle) {
  CanvasGraphicsRenderer.prototype._calcCanvasStyle = function _calcCanvasStyle(style, tint) {
    if (!style.texture && style.gradient)
      return superCalcCanvasStyle.call(this, style, tint);

		const gradient = this.renderer.context.createLinearGradient(
	    style.gradient.beginPoint.x,
			style.gradient.beginPoint.y,
			style.gradient.endPoint.x,
			style.gradient.endPoint.y,
		);
		for (let i = 0; i < style.gradient.colorStops.length; i++) {
			gradient.addColorStop(...style.gradient.colorStops[i]);
		}

		return gradient;
  };
}

import { LineStyle } from '@pixi/graphics';

const superClone = LineStyle.prototype.clone;
if (superClone) {
  LineStyle.prototype.clone = function clone() {
    const obj = superClone.call(this);
    obj.gradient = this.gradient;

    return obj;
  };
}

if (!superCalcCanvasStyle || !superClone)
  console.warn('Unit info card gradient is broken');
