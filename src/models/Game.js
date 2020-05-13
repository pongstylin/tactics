import uuid from 'uuid/v4';
import GameState from 'tactics/GameState.js';

const gameKeys = new Set([
  'createdBy',
  'isPublic',
]);

const stateKeys = new Set([
  'type',
  'randomFirstTurn',
  'turnTimeLimit',
  'teams',
]);

export default class Game {
  constructor(data) {
    Object.assign(this, data);
  }

  static create(gameType, gameOptions) {
    if (!gameOptions.teams)
      throw new Error(`Required 'teams' option`);

    let gameData = {
      id:          uuid(),
      created:     new Date(),
      undoRequest: null,
    };

    let stateData = { type:gameType.id };
    Object.keys(gameOptions).forEach(option => {
      if (stateKeys.has(option))
        stateData[option] = gameOptions[option];
      else if (gameKeys.has(option))
        gameData[option] = gameOptions[option];
      else
        throw new Error(`No such game option: ${option}`);
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
    return {...this};
  }
}
