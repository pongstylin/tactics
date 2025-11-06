/*
const orig = { setTimeout, setInterval, requestAnimationFrame };

for (const fnName of Object.keys(orig))
  window[fnName] = (...args) => {
    console.log(fnName, ...args, new Error().stack);
    return orig[fnName].apply(window, args);
  };
*/

import 'plugins/index.js';
import 'plugins/element.js';
import 'plugins/promise.js';

import 'utils/event.js';

import 'tactics/core.scss';
import 'tactics/core.js';
import 'tactics/animation.js';
import 'tactics/utils-colorstop.js';
import 'components/open.js';
