import Impetus from 'impetus';
import touchPinch from 'touch-pinch';
import EventEmitter from 'events';

export default function (options) {
  let target;
  if (typeof options.target === 'string')
    target = document.querySelector(options.target);
  else
    target = options.target;

  let initial = options.initial || {};
  let current = Object.assign({
    origin: { x:0, y:0 },
    scale: 1,
    translate: { x:0, y:0 },
  }, initial);
  let locked = !!options.locked;
  let enableOneFinger = options.enableOneFinger || false;
  let minScale = options.minScale || 1;
  let maxScale = options.maxScale || 1;
  let panWidth = options.panWidth;
  let panHeight = options.panHeight;
  let emitter = new EventEmitter();

  if (target.parentElement) {
    if (!panWidth)
      panWidth = target.parentElement.clientWidth;
    if (!panHeight)
      panHeight = target.parentElement.clientHeight;
  }

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

  // Throttle rendering to screen refresh rate.
  let render = () => {
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
  };
  let frame_id = null;
  let postChangeEvent = (f1, f2) => {
    if (frame_id !== null)
      return;

    frame_id = requestAnimationFrame(() => {
      render();
      frame_id = null;
    });
  };

  /*
   * Prevent the content from being panned off screen unless allowed.
   */
  let getBounds = () => {
    let s = current.scale;
    let w = target.clientWidth;
    let h = target.clientHeight;

    // Offset the min/max based on the current origin and scale.
    let ox = -current.origin.x * (1 - s);
    let oy = -current.origin.y * (1 - s);

    // Offset further based on the target offset
    ox -= target.offsetLeft;
    oy -= target.offsetTop;

    let minX = ox / s;
    let maxX = ox / s;
    if (panWidth) {
      minX -= Math.max(0, w*s - panWidth) / s;
      maxX += Math.max(0, panWidth - w*s) / s;
    }

    let minY = oy / s;
    let maxY = oy / s;
    if (panHeight) {
      minY -= Math.max(0, h*s - panHeight) / s;
      maxY += Math.max(0, panHeight - h*s) / s;
    }

    return {
      x: {min:minX, max:maxX},
      y: {min:minY, max:maxY},
    };
  };

  /*
   * One-finger panning
   */
  let paused  = false;
  let impetus = null;

  let startImpetus = () => {
    if (!enableOneFinger) return;

    let bounds = getBounds();

    impetus = new Impetus({
      source: target,
      update: (x, y) => {
        if (paused) return;

        current.translate.x = x;
        current.translate.y = y;

        postChangeEvent();
      },
      multiplier: 1 / current.scale,
      friction: 0.9,
      initialValues: [current.translate.x, current.translate.y],
      boundX: [bounds.x.min, bounds.x.max],
      boundY: [bounds.y.min, bounds.y.max],
      bounce: false,
    });
  };

  let pauseImpetus = () => {
    if (impetus === null || paused) return;

    paused = true;
    impetus.pause();
  };

  let resetImpetus = () => {
    if (impetus === null) return startImpetus();

    let bounds = getBounds();

    impetus.setValues(current.translate.x, current.translate.y);
    impetus.setMultiplier(1 / current.scale);
    impetus.setBoundX([bounds.x.min, bounds.x.max]);
    impetus.setBoundY([bounds.y.min, bounds.y.max]);
  };

  let resumeImpetus = () => {
    if (impetus === null) return startImpetus();

    paused = false;
    resetImpetus();
    impetus.resume();
  };

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
  let setOrigin = (origin) => {
    // Translate to compensate for the change in origin.
    current.translate.x -= (origin.x - current.origin.x) * (1 - current.scale) / current.scale;
    current.translate.y -= (origin.y - current.origin.y) * (1 - current.scale) / current.scale;
    current.origin.x = origin.x;
    current.origin.y = origin.y;
  };

  // The change of distance between two fingers determines the change in zoom.
  let getDistance = (point1, point2) =>
    Math.sqrt((point2.x - point1.x)**2 + (point2.y - point1.y)**2);

  let setFingers = (f1, f2) => {
    // Change the origin without changing position.
    setOrigin(getOrigin(f1, f2));

    // The current scale is calibrated for this distance.
    current.distance = getDistance(f1, f2);

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
    // Change the origin without changing position.
    setOrigin(origin);

    // Adjust scale based on the change in distance.
    current.scale       *= distance / current.distance;
    current.distance     = distance;

    /*
     * Set limits
     */
    let bounds = getBounds();

    current.scale       = Math.max(minScale, Math.min(maxScale, current.scale));
    current.translate.x = Math.max(bounds.x.min, Math.min(bounds.x.max, current.translate.x));
    current.translate.y = Math.max(bounds.y.min, Math.min(bounds.y.max, current.translate.y));

    postChangeEvent(f1, f2);
  };

  pinch.on('start', curr => {
    if (locked) return;

    pauseImpetus();

    let fingers = pinch.fingers;
    let f1 = getTouchPoint(fingers[0].touch);
    let f2 = getTouchPoint(fingers[1].touch);

    setFingers(f1, f2);

    emitter.emit('start');
  });
  pinch.on('change', () => {
    if (locked || !pinch.pinching) return;

    let fingers = pinch.fingers;
    let f1 = getTouchPoint(fingers[0].touch);
    let f2 = getTouchPoint(fingers[1].touch);

    moveFingers(f1, f2);
  });
  pinch.on('end', () => {
    if (locked) return;

    resumeImpetus();

    emitter.emit('stop');
  });

  let instance = {
    transitioningTo: null,

    canZoom: function () {
      let testTransition = self.transitioningTo || current;

      return testTransition.scale < maxScale;
    },
    setFingers: setFingers,
    moveFingers: moveFingers,
    lock: function () {
      locked = true;
      pauseImpetus();
    },
    unlock: function () {
      locked = false;
      resumeImpetus();
    },
    transitionToTransform: function (transform) {
      self.transitioningTo = transform;

      setOrigin(transform.origin);

      let startScale     = current.scale;
      let startTranslate = Object.assign({}, current.translate);

      let wasLocked = locked;
      locked = true;

      let startTime;
      let makeTransition = time => {
        if (!startTime) startTime = time;

        let progress = Math.min(500, time - startTime) / 500;
        if (progress === 1) {
          locked = wasLocked;
          self.transitioning = null;
        }
        else
          requestAnimationFrame(makeTransition);

        // The math may be too simple since scaling and panning isn't synced well.
        // The origin may need to be transitioned as well.
        current.scale = startScale + (transform.scale - startScale) * progress;
        current.translate.x = startTranslate.x + (transform.translate.x - startTranslate.x) * progress;
        current.translate.y = startTranslate.y + (transform.translate.y - startTranslate.y) * progress;

        render();
      };

      requestAnimationFrame(makeTransition);

      return instance;
    },
    // The point x and y must be expressed as a percentage (0 ... 1).
    transitionPointToCenter: function (point, scale) {
      return instance.transitionToTransform({
        // We're scaling from the center of the target
        origin: {
          x: target.clientWidth / 2,
          y: target.clientHeight / 2,
        },
        scale: scale || current.scale,
        translate: {
          x: (0.5 - point.x) * target.clientWidth,
          y: (0.5 - point.y) * target.clientHeight,
        },
      });
    },
    reset: function () {
      Object.assign(current, {
        origin:    {x:0, y:0},
        scale:     1,
        translate: {x:0, y:0},
      }, initial);

      panWidth  = options.panWidth  || target.parentElement.clientWidth;
      panHeight = options.panHeight || target.parentElement.clientHeight;

      if (!locked) resetImpetus();

      postChangeEvent();
    },
    destroy: function () {
      impetus.destroy();

      pinch.disable();

      cancelAnimationFrame(frame_id);
    },
    on: function () {
      emitter.addListener(...arguments);
      return this;
    },
    off: function () {
      emitter.removeListener(...arguments);
      return this;
    },
  };

  Object.defineProperty(instance, 'locked', {
    enumerable: true,
    get: () => locked,
  });

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

  Object.defineProperty(instance, 'transform', {
    enumerable: true,
    get: () => ({
      origin:    Object.assign({}, current.origin),
      scale:     current.scale,
      translate: Object.assign({}, current.translate),
    }),
  });

  if (locked)
    postChangeEvent();
  else
    startImpetus();

  return instance;
}
