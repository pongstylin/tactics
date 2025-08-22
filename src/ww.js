/* Web Worker */

import 'plugins/index.js';
import Team from '#models/Team.js';
import GameState from 'tactics/GameState.js';
import serializer from 'utils/serializer.js';

// The state object is stored on 'self' so that it can be inspected.
self.state = null;
self.data = null;

const post = (type, data) => {
  if (type === 'sync') {
    const state = self.state.getData();
    state.recentTurns = state.recentTurns.map((turn, i) => turn.getDigest(i === 0, i === (state.recentTurns.length - 1), false));
    data.data = { state };
  }

  self.postMessage(serializer.stringify({ type, data }));
};

self.addEventListener('message', ({ data:message }) => {
  const { type, data } = message;

  if (type === 'create') {
    self.data = data;

    const { teams, ...stateData } = data.clone();
    stateData.numTeams = teams.length;

    self.state = GameState.create(stateData)
      .on('sync', event => post('sync', event));

    post('init', self.state.getData());

    for (const [ slot, teamData ] of teams.entries())
      self.state.join(Team.create(Object.assign({}, teamData, {
        slot,
        joinedAt: new Date(),
      })));
    self.state.start();
  } else if (type === 'restart') {
    const { teams, ...stateData } = self.data.clone();
    stateData.numTeams = teams.length;

    self.state = GameState.create(stateData)
      .on('sync', event => post('sync', event));

    post('init', self.state.getData());

    for (const [ slot, teamData ] of teams.entries())
      self.state.join(Team.create(Object.assign({}, teamData, {
        slot,
        joinedAt: new Date(),
      })));
    self.state.start();
  } else if (type === 'call') {
    const value = self.state[data.method](...data.args);
    // The method in the reply is only useful for debugging.
    const message = { id:data.id, method:data.method };

    if (value instanceof Promise)
      value.then(v => post('reply', { ...message, value:v }));
    else if (value !== undefined)
      post('reply', { ...message, value:value });
    else
      post('reply', message);
  }
});
