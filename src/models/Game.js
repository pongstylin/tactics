import uuid from 'uuid/v4';
import GameState from 'tactics/GameState.js';

const gameKeys = new Set([
  'createdBy',
  'isPublic',
]);

const stateKeys = new Set([
  'type',
  'randomFirstTurn',
  'randomHitChance',
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

  fork(playerId, turnId) {
    // Effectively clone this game before converting the clone to a fork
    let forkGame = Game.load(JSON.parse(JSON.stringify(this)));

    forkGame.id = uuid();
    forkGame.isPublic = false;
    forkGame.state.turnTimeLimit = null;
    forkGame.state.teams.forEach(team => {
      team.playerId = playerId;
      team.resetRandom();
    });

    if (forkGame.state.ended) {
      forkGame.state.winnerId = null;
      forkGame.state.ended = null;

      // Don't include the winning turn, otherwise there's just one team left
      if (turnId >= forkGame.state.currentTurnId)
        turnId = forkGame.state.currentTurnId - 1;
    }
    forkGame.state.revert(turnId);

    return forkGame;
  }

  toJSON() {
    return {...this};
  }
}
