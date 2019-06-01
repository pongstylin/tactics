'use strict';

import uuid from 'uuid/v4';
import GameState from 'tactics/GameState.js';

export default class Game {
  constructor(data) {
    Object.assign(this, data);
  }

  static create(stateData) {
    return new Game({
      id:      uuid(),
      state:   GameState.create(stateData),
      created: new Date(),
    });
  }

  static load(data) {
    data.state = GameState.load(data.state);

    if (typeof data.created === 'string')
      data.created = new Date(data.created);

    return new Game(data);
  }

  toJSON() {
    let json = {...this};
    json.created = json.created.toISOString();

    return json;
  }
}
