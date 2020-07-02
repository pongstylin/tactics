/*
 * Some Tactics classes are shared between the client and server.  Some of them
 * requires PIXI classes.  But, PIXI requires the 'document' object to load
 * modules successfully.  So, provide an alternate, global access point.
 */
import {
  Renderer, BatchRenderer,
  BaseTexture, Texture,
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

Renderer.registerPlugin('extract', Extract);
Renderer.registerPlugin('batch', BatchRenderer);
Renderer.registerPlugin('interaction', InteractionManager);
CanvasRenderer.registerPlugin('sprite', CanvasSpriteRenderer);
CanvasRenderer.registerPlugin('graphics', CanvasGraphicsRenderer);
CanvasRenderer.registerPlugin('interaction', InteractionManager);

window.PIXI = {
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
import { SHAPES } from '@pixi/math';

CanvasGraphicsRenderer.prototype.render = function render(graphics) {
  let renderer = this.renderer;
  let context = renderer.context;
  let worldAlpha = graphics.worldAlpha;
  let transform = graphics.transform.worldTransform;
  let resolution = renderer.resolution;

  context.setTransform(
    transform.a * resolution,
    transform.b * resolution,
    transform.c * resolution,
    transform.d * resolution,
    transform.tx * resolution,
    transform.ty * resolution
  );

  // update tint if graphics was dirty
  if (
    graphics.canvasTintDirty !== graphics.geometry.dirty
      || graphics._prevTint !== graphics.tint
  ) {
    this.updateGraphicsTint(graphics);
  }

  renderer.setBlendMode(graphics.blendMode);

  let graphicsData = graphics.geometry.graphicsData;

  for (let i = 0; i < graphicsData.length; i++) {
    let data = graphicsData[i];
    let shape = data.shape;
    let fillStyle = data.fillStyle;
    let lineStyle = data.lineStyle;

    let fillColor = data._fillTint;
    let lineColor = data._lineTint;

    context.lineWidth = lineStyle.width;

    if (data.type === SHAPES.POLY) {
      context.beginPath();

      let points = shape.points;
      let holes = data.holes;
      let outerArea = (void 0);
      let innerArea = (void 0);
      let px = (void 0);
      let py = (void 0);

      context.moveTo(points[0], points[1]);

      for (let j = 2; j < points.length; j += 2) {
        context.lineTo(points[j], points[j + 1]);
      }

      if (shape.closeStroke) {
        context.closePath();
      }

      if (holes.length > 0) {
        outerArea = 0;
        px = points[0];
        py = points[1];
        for (let j$1 = 2; j$1 + 2 < points.length; j$1 += 2) {
          outerArea += ((points[j$1] - px) * (points[j$1 + 3] - py))
            - ((points[j$1 + 2] - px) * (points[j$1 + 1] - py));
        }

        for (let k = 0; k < holes.length; k++) {
          points = holes[k].shape.points;

          if (!points)
          {
            continue;
          }

          innerArea = 0;
          px = points[0];
          py = points[1];
          for (let j$2 = 2; j$2 + 2 < points.length; j$2 += 2) {
            innerArea += ((points[j$2] - px) * (points[j$2 + 3] - py))
              - ((points[j$2 + 2] - px) * (points[j$2 + 1] - py));
          }

          if (innerArea * outerArea < 0) {
            context.moveTo(points[0], points[1]);

            for (let j$3 = 2; j$3 < points.length; j$3 += 2) {
              context.lineTo(points[j$3], points[j$3 + 1]);
            }
          }
          else {
            context.moveTo(points[points.length - 2], points[points.length - 1]);

            for (let j$4 = points.length - 4; j$4 >= 0; j$4 -= 2) {
              context.lineTo(points[j$4], points[j$4 + 1]);
            }
          }

          if (holes[k].shape.closeStroke) {
            context.closePath();
          }
        }
      }

      if (fillStyle.visible) {
        context.globalAlpha = fillStyle.alpha * worldAlpha;

        context.fillStyle = "#" + ((("00000" + ((fillColor | 0).toString(16)))).substr(-6));
        context.fill();
      }

      if (lineStyle.visible) {
        context.globalAlpha = lineStyle.alpha * worldAlpha;
        if (lineStyle.gradient) {
          let gradient = context.createLinearGradient(
            lineStyle.gradient.beginPoint.x,
            lineStyle.gradient.beginPoint.y,
            lineStyle.gradient.endPoint.x,
            lineStyle.gradient.endPoint.y,
          );
          for (let i = 0; i < lineStyle.gradient.colorStops.length; i++) {
            gradient.addColorStop(...lineStyle.gradient.colorStops[i]);
          }
          context.strokeStyle = gradient;
        }
        else {
          context.strokeStyle = "#" + ((("00000" + ((lineColor | 0).toString(16)))).substr(-6));
        }
        context.stroke();
      }
    }
    else if (data.type === SHAPES.RECT) {
      if (fillStyle.visible) {
        context.globalAlpha = fillStyle.alpha * worldAlpha;
        context.fillStyle = "#" + ((("00000" + ((fillColor | 0).toString(16)))).substr(-6));
        context.fillRect(shape.x, shape.y, shape.width, shape.height);
      }
      if (lineStyle.visible) {
        context.globalAlpha = lineStyle.alpha * worldAlpha;
        context.strokeStyle = "#" + ((("00000" + ((lineColor | 0).toString(16)))).substr(-6));
        context.strokeRect(shape.x, shape.y, shape.width, shape.height);
      }
    }
    else if (data.type === SHAPES.CIRC) {
      // TODO - need to be Undefined!
      context.beginPath();
      context.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
      context.closePath();

      if (fillStyle.visible) {
        context.globalAlpha = fillStyle.alpha * worldAlpha;
        context.fillStyle = "#" + ((("00000" + ((fillColor | 0).toString(16)))).substr(-6));
        context.fill();
      }

      if (lineStyle.visible) {
        context.globalAlpha = lineStyle.alpha * worldAlpha;
        context.strokeStyle = "#" + ((("00000" + ((lineColor | 0).toString(16)))).substr(-6));
        context.stroke();
      }
    }
    else if (data.type === SHAPES.ELIP) {
      // ellipse code taken from: http://stackoverflow.com/questions/2172798/how-to-draw-an-oval-in-html5-canvas

      let w = shape.width * 2;
      let h = shape.height * 2;

      let x = shape.x - (w / 2);
      let y = shape.y - (h / 2);

      context.beginPath();

      let kappa = 0.5522848;
      let ox = (w / 2) * kappa; // control point offset horizontal
      let oy = (h / 2) * kappa; // control point offset vertical
      let xe = x + w; // x-end
      let ye = y + h; // y-end
      let xm = x + (w / 2); // x-middle
      let ym = y + (h / 2); // y-middle

      context.moveTo(x, ym);
      context.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
      context.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
      context.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
      context.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);

      context.closePath();

      if (fillStyle.visible) {
        context.globalAlpha = fillStyle.alpha * worldAlpha;
        context.fillStyle = "#" + ((("00000" + ((fillColor | 0).toString(16)))).substr(-6));
        context.fill();
      }
      if (lineStyle.visible) {
        context.globalAlpha = lineStyle.alpha * worldAlpha;
        context.strokeStyle = "#" + ((("00000" + ((lineColor | 0).toString(16)))).substr(-6));
        context.stroke();
      }
    }
    else if (data.type === SHAPES.RREC) {
      let rx = shape.x;
      let ry = shape.y;
      let width = shape.width;
      let height = shape.height;
      let radius = shape.radius;

      let maxRadius = Math.min(width, height) / 2 | 0;

      radius = radius > maxRadius ? maxRadius : radius;

      context.beginPath();
      context.moveTo(rx, ry + radius);
      context.lineTo(rx, ry + height - radius);
      context.quadraticCurveTo(rx, ry + height, rx + radius, ry + height);
      context.lineTo(rx + width - radius, ry + height);
      context.quadraticCurveTo(rx + width, ry + height, rx + width, ry + height - radius);
      context.lineTo(rx + width, ry + radius);
      context.quadraticCurveTo(rx + width, ry, rx + width - radius, ry);
      context.lineTo(rx + radius, ry);
      context.quadraticCurveTo(rx, ry, rx, ry + radius);
      context.closePath();

      if (fillStyle.visible) {
        context.globalAlpha = fillStyle.alpha * worldAlpha;
        context.fillStyle = "#" + ((("00000" + ((fillColor | 0).toString(16)))).substr(-6));
        context.fill();
      }
      if (lineStyle.visible) {
        context.globalAlpha = lineStyle.alpha * worldAlpha;
        context.strokeStyle = "#" + ((("00000" + ((lineColor | 0).toString(16)))).substr(-6));
        context.stroke();
      }
    }
  }
};

import { LineStyle } from '@pixi/graphics';

LineStyle.prototype.clone = function clone() {
  let obj = new LineStyle();
  obj.color = this.color;
  obj.alpha = this.alpha;
  obj.texture = this.texture;
  obj.matrix = this.matrix;
  obj.visible = this.visible;
  obj.width = this.width;
  obj.alignment = this.alignment;
  obj.native = this.native;
  obj.gradient = this.gradient;

  return obj;
};
