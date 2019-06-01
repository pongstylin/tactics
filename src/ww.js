'use strict';

/* Web Worker */

import 'plugins/array.js';
import GameState from 'tactics/GameState.js';

const post = (type, data) => {
  self.postMessage({ type:type, data:data });
};

// The state object is stored on 'self' so that it can be inspected.
self.state = null;

self.addEventListener('message', ({data:message}) => {
  let state = self.state;
  let {type, data} = message;

  if (type === 'create') {
    self.state = state = GameState.create(data);
    post('init', state.getData());
  }
  else if (type === 'load') {
    self.state = state = GameState.load(data);
    post('init', state.getData());
  }
  else if (type === 'subscribe')
    state.on(data.type, event => post('event', event));
  else if (type === 'call') {
    let value = state[data.method](...data.args);
    // The method in the reply is only useful for debugging.
    let message = { id:data.id, method:data.method };

    if (value instanceof Promise)
      value.then(v => post('reply', { ...message, value:v }));
    else if (value !== undefined)
      post('reply', { ...message, value:value });
    else
      post('reply', message);
  }
});
