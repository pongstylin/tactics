'use strict';

import Impetus from 'impetus';
import touchPinch from 'touch-pinch';
import { EventEmitter } from 'events';

function panzoom (options) {
  console.log('panzoom');
  if (!options)
    options = {};

  let target;
  if (typeof options.target === 'string')
    target = document.querySelector(options.target);
  else
    target = options.target;

  let current = Object.assign({x:0, y:0, scale:1}, options.initial);
  let emitter = new EventEmitter();

  // Throttle events to screen refresh rate.
  let frame_id = null;
  let postChangeEvent = () => {
    if (frame_id !== null)
      return;

    frame_id = requestAnimationFrame(() => {
      emitter.emit('change', current);
      frame_id = null;
    });
  };

  // One-finger panning
  let impetus = new Impetus({
    source: target,
    update: (x, y) => {
      current.x = x;
      current.y = y;

      postChangeEvent();
    },
    multiplier: 1,
    friction: .75,
    initialValues: [current.x, current.y],
  });

  // Two-finger panning and zooming.
  let pinch = touchPinch(target);
  let last_position;
  let last_scale;
  let getPosition = () => {
    let f1 = pinch.fingers[0];
    let f2 = pinch.fingers[1];

    return {
      x: f2.position[0] * .5 + f1.position[0] * .5,
      y: f2.position[1] * .5 + f1.position[1] * .5,
    };
  };

  pinch.on('start', curr => {
    last_position = getPosition();
    last_scale    = current.scale;

    impetus.pause();
  });
  pinch.on('change', (curr, prev) => {
    if (!pinch.pinching || !last_position) return

    // Pan
    let position = getPosition();
    current.x += (position.x - last_position.x) / current.scale;
    current.y += (position.y - last_position.y) / current.scale;

    // Zoom
    let origin = {
      x: position.x - current.x,
      y: position.y - current.y,
    };
    let new_scale = curr / prev;
    //console.log(origin.x, position.x, current.x);
    console.log(origin.x + new_scale * (current.x - origin.x), current.x + (origin.x - current.x) * (last_scale - current.scale));
    current.scale *= new_scale;
    current.x = origin.x + new_scale * (current.x - origin.x);
    current.y = origin.y + new_scale * (current.y - origin.y);
    //current.x += (origin.x - current.x) * (last_scale - current.scale);
    //current.y += (origin.y - current.y) * (last_scale - current.scale);

    postChangeEvent();
    last_position = position;
    last_scale    = current.scale;
  });
  pinch.on('end', () => {
    if (!last_position) return;
    last_position = null;

    impetus.setValues(current.x, current.y);
    impetus.resume();
  });

  return {
    destroy: function () {
      impetus.destroy();

      pinch.disable();

      cancelAnimationFrame(frame_id);
    },
    on: emitter.addListener.bind(emitter),
    off: emitter.removeListener.bind(emitter),
  }
}

if (window)
  window.panzoom = panzoom;

export { panzoom };
