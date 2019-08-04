'use strict';

import uuid from 'uuid/v4';
import GameState from 'tactics/GameState.js';

const gameOptions = new Set([
  'isPublic',
]);

const stateOptions = new Set([
  'type',
  'randomFirstTurn',
  'turnTimeLimit',
  'teams',
]);

export default class Game {
  constructor(data) {
    Object.assign(this, data);
  }

  static create(gameOptions) {
    let gameData = {
      id:          uuid(),
      created:     new Date(),
      undoRequest: null,
    };

    let stateData = {};
    Object.keys(gameOptions).forEach(option => {
      if (stateOptions.has(option))
        stateData[option] = gameOptions[option];
      else
        gameData[option] = gameOptions[option];
    });

    gameData.state = GameState.create(stateData);

    return new Game(gameData);
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

    if (json.undoRequest)
      json.undoRequest = Object.assign({}, json.undoRequest, {
        accepts: [...json.undoRequest.accepts],
      });

    return json;
  }
}
