'use strict';

import Impetus from 'impetus';
import touchPinch from 'touch-pinch';
import { EventEmitter } from 'events';

function panzoom (options) {
  let target;
  if (typeof options.target === 'string')
    target = document.querySelector(options.target);
  else
    target = options.target;

  let initial = options.initial || {};
  let current = Object.assign({
    origin:    {x:0, y:0},
    scale:     1,
    translate: {x:0, y:0},
  }, initial);
  let minScale = options.minScale || 1;
  let maxScale = options.maxScale || 1;
  let allowOffScreen = !!options.allowOffScreen;
  let emitter = new EventEmitter();

  /*
   * ** For Testing Only **
   *
   * Begin Test
   *   Tactics.panzoom.setFingers({x:420-88,y:294-28}, {x:420+88,y:294-28});
   * Zoom Test
   *   Tactics.panzoom.moveFingers({x:420-88*2,y:294-28}, {x:420+88*2,y:294-28});
   * Pan Test
   *   Tactics.panzoom.moveFingers({x:420-88*2+88,y:294-28}, {x:420+88*2+88,y:294-28});
   * Pan & Zoom Test
   *   Tactics.panzoom.moveFingers({x:420-88,y:294-28}, {x:420+88,y:294-28});
  let createMarker = text => {
    let marker = document.createElement('DIV');
    Object.assign(marker.style, {
      position: 'absolute',
      color: '#ffffff',
      fontWeight: 'bold',
    });
    marker.appendChild(document.createTextNode(text));
    document.body.appendChild(marker);

    return marker;
  };
  let setMarker = (marker, point) => {
    Object.assign(marker.style, {
      top:  target.offsetTop  + (point.y - marker.clientHeight/2) + 'px',
      left: target.offsetLeft + (point.x - marker.clientWidth/2)  + 'px',
    });
  };
  let origin_marker = createMarker('+');
  let f1_marker = createMarker('1');
  let f2_marker = createMarker('2');
   */

  // Throttle events to screen refresh rate.
  let frame_id = null;
  let postChangeEvent = (f1, f2) => {
    if (frame_id !== null)
      return;

    frame_id = requestAnimationFrame(() => {
      console.log(current.origin, current.scale, current.translate);
      let scale     = 'scale('+current.scale+')';
      let translate = 'translate('+current.translate.x+'px,'+current.translate.y+'px)';

      Object.assign(target.style, {
        transformOrigin: current.origin.x+'px '+current.origin.y+'px 0',

        // It is important to scale first
        transform: scale+' '+translate,
      });

      /* ** For Testing Only **
      setMarker(origin_marker, current.origin);
      if (f1) setMarker(f1_marker, f1);
      if (f2) setMarker(f2_marker, f2);
      */

      emitter.emit('change', current);
      frame_id = null;
    });
  };

  /*
   * Prevent the content from being panned off screen unless allowed.
   */
  let boundedX = x => {
    if (allowOffScreen) return x;

    // Offset the min/max based on the current origin and scale.
    let s = current.scale;
    let w = target.clientWidth;
    let ox = -current.origin.x * (1 - s);

    let minX = (ox - (w*s - w)) / s;
    let maxX = ox / s;

    if (x < minX) return minX;
    if (x > maxX) return maxX;
    return x;
  };

  let boundedY = y => {
    if (allowOffScreen) return y;

    // Offset the min/max based on the origin and scale.
    let s = current.scale;
    let h = target.clientHeight;
    let oy = -current.origin.y * (1 - s);

    let minY = (oy - (h*s - h)) / s;
    let maxY = oy / s;

    if (y < minY) return minY;
    if (y > maxY) return maxY;
    return y;
  };

  // One-finger panning
  let paused = false;
  let impetus = new Impetus({
    source: target,
    update: (x, y) => {
      if (paused) return;

      let bx = boundedX(x);
      let by = boundedY(y);

      if (bx !== x || by !== y)
        impetus.setValues(bx, by);

      if (current.translate.x === bx && current.translate.y === by) return;

      current.translate.x = bx;
      current.translate.y = by;

      postChangeEvent();
    },
    multiplier: 1 / current.scale,
    friction: 0.9,
    initialValues: [current.translate.x, current.translate.y],
  });

  /*
   * Two-finger panning and zooming.
   */
  let pinch = touchPinch(target);

  let getTouchPoint = touch => ({
    x: touch.clientX - target.offsetLeft,
    y: touch.clientY - target.offsetTop,
  });

  // The origin/center of the zoom is the mid-point between two fingers.
  let getOrigin = (point1, point2) => ({
    x: (point1.x + point2.x) / 2,
    y: (point1.y + point2.y) / 2,
  });

  // The change of distance between two fingers determines the change in zoom.
  let getDistance = (point1, point2) =>
    Math.sqrt((point2.x - point1.x)**2 + (point2.y - point1.y)**2);

  let setFingers = (f1, f2) => {
    let origin   = getOrigin(f1, f2);
    let distance = getDistance(f1, f2);

    // Translate to compensate for the change in origin.
    current.translate.x -= (origin.x - current.origin.x) * (1 - current.scale) / current.scale;
    current.translate.y -= (origin.y - current.origin.y) * (1 - current.scale) / current.scale;
    current.origin.x = origin.x;
    current.origin.y = origin.y;

    // The current scale is calibrated for this distance.
    current.distance = distance;

    postChangeEvent(f1, f2);
  };

  let moveFingers = (f1, f2) => {
    let origin   = getOrigin(f1, f2);
    let distance = getDistance(f1, f2);

    /*
     * Pan
     */
    current.translate.x += (origin.x - current.origin.x) / current.scale;
    current.translate.y += (origin.y - current.origin.y) / current.scale;

    /*
     * Zoom
     */
    // Translate to compensate for the change in origin.
    current.translate.x -= (origin.x - current.origin.x) * (1 - current.scale) / current.scale;
    current.translate.y -= (origin.y - current.origin.y) * (1 - current.scale) / current.scale;
    current.origin.x     = origin.x;
    current.origin.y     = origin.y;

    // Adjust scale based on the change in distance.
    current.scale       *= distance / current.distance;
    current.distance     = distance;

    /*
     * Set limits
     */
    current.scale       = Math.max(minScale, Math.min(maxScale, current.scale));
    current.translate.x = boundedX(current.translate.x);
    current.translate.y = boundedY(current.translate.y);

    postChangeEvent(f1, f2);
  };

  pinch.on('start', curr => {
    paused = true;
    impetus.pause();

    let fingers = pinch.fingers;
    let f1 = getTouchPoint(fingers[0].touch);
    let f2 = getTouchPoint(fingers[1].touch);

    setFingers(f1, f2);
  });
  pinch.on('change', () => {
    if (!pinch.pinching) return;

    let fingers = pinch.fingers;
    let f1 = getTouchPoint(fingers[0].touch);
    let f2 = getTouchPoint(fingers[1].touch);

    moveFingers(f1, f2);
  });
  pinch.on('end', () => {
    paused = false;
    impetus.setValues(current.translate.x, current.translate.y);
    impetus.setMultiplier(1 / current.scale);
    impetus.resume();
  });

  let instance = {
    setFingers: setFingers,
    moveFingers: moveFingers,
    reset: function () {
      paused = true;
      impetus.pause();

      Object.assign(current, {
        origin:    {x:0, y:0},
        scale:     1,
        translate: {x:0, y:0},
      }, initial);

      impetus.setValues(current.translate.x, current.translate.y);
      impetus.setMultiplier(1 / current.scale);
      impetus.resume();
      paused = false;

      postChangeEvent();
    },
    destroy: function () {
      impetus.destroy();

      pinch.disable();

      cancelAnimationFrame(frame_id);
    },
    on: emitter.addListener.bind(emitter),
    off: emitter.removeListener.bind(emitter),
  };

  Object.defineProperty(instance, 'initial', {
    enumerable: true,
    get: ()  => initial,
    set: (v) => initial = v,
  });

  Object.defineProperty(instance, 'minScale', {
    enumerable: true,
    get: ()  => minScale,
    set: (v) => {
      if (current.scale < v) {
        current.scale = v;
        postChangeEvent();
      }
      return minScale = v;
    },
  });

  Object.defineProperty(instance, 'maxScale', {
    enumerable: true,
    get: ()  => maxScale,
    set: (v) => {
      if (current.scale > v) {
        current.scale = v;
        postChangeEvent();
      }
      return maxScale = v;
    },
  });

  return instance;
}

if (window)
  window.panzoom = panzoom;

export { panzoom };
