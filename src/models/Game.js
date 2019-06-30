'use strict';

import uuid from 'uuid/v4';
import GameState from 'tactics/GameState.js';

export default class Game {
  constructor(data) {
    Object.assign(this, data);
  }

  static create(stateData) {
    return new Game({
      id:          uuid(),
      state:       GameState.create(stateData),
      created:     new Date(),
      undoRequest: null,
    });
  }

  static load(data) {
    data.state = GameState.load(data.state);

    if (typeof data.created === 'string')
      data.created = new Date(data.created);
    if (data.undoRequest)
      data.undoRequest.accepts = new Set(data.undoRequest.accepts);

    return new Game(data);
  }

  toJSON() {
    let json = {...this};
    json.created = json.created.toISOString();

    if (json.undoRequest)
      json.undoRequest = Object.assign({}, json.undoRequest, {
        accepts: [...json.undoRequest.accepts],
      });

    return json;
  }
}
