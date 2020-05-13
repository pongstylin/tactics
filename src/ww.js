/* Web Worker */

import 'plugins/array.js';
import GameState from 'tactics/GameState.js';

const post = (type, data) => {
  self.postMessage({ type:type, data:data });
};

// The state object is stored on 'self' so that it can be inspected.
self.state = null;

self.addEventListener('message', ({data:message}) => {
  let {type, data} = message;

  if (type === 'create') {
    self.state = GameState.create(data)
      .on('event', event => post('event', event));

    post('init', self.state.getData());

    if (!self.state.teams.find(t => !t || !t.set))
      self.state.start();
  }
  else if (type === 'load') {
    self.state = GameState.load(data)
      .on('event', event => post('event', event));
    post('init', self.state.getData());
  }
  else if (type === 'call') {
    let value = self.state[data.method](...data.args);
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
