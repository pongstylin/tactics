import uuid from 'uuid/v4';
import ServerError from 'server/Error.js';
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

  static create(gameOptions) {
    let gameData = {
      id:          uuid(),
      created:     new Date(),
      undoRequest: null,
    };

    let stateData = {};
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

  fork(clientPara, { turnId, vs, as }) {
    // Effectively clone this game before converting the clone to a fork
    let forkGame = Game.load(JSON.parse(JSON.stringify(this)));

    if (turnId === undefined)
      turnId = forkGame.state.currentTurnId;
    if (turnId < 0)
      turnId = 0;
    if (turnId > forkGame.state.currentTurnId)
      turnId = forkGame.state.currentTurnId;
    // Don't include the winning turn, otherwise there's just one team left
    if (forkGame.state.ended && turnId === forkGame.state.currentTurnId)
      turnId--;
    if (vs === undefined)
      vs = 'you';

    forkGame.state.revert(turnId);
    forkGame.state.autoPass();
    if (forkGame.state.ended)
      throw new ServerError(403, 'Cowardly refusing to fork a game that immediately ends in a draw.');

    forkGame.created = new Date();
    forkGame.id = uuid();
    forkGame.forkOf = { gameId:this.id, turnId:forkGame.state.currentTurnId };
    forkGame.isPublic = false;

    let teams = forkGame.state.teams = forkGame.state.teams.map(t => t.fork());

    if (vs === 'you') {
      teams.forEach(t => t.join({}, clientPara));

      forkGame.state.turnTimeLimit = null;
    } else if (vs === 'private') {
      if (as === undefined)
        throw new ServerError(400, "Required 'as' option");
      if (typeof as !== 'number')
        throw new ServerError(400, "Invalid 'as' option value");
      if (teams[as] === undefined)
        throw new ServerError(400, "Invalid 'as' option value");

      teams[as].join({}, clientPara);

      forkGame.state.started = null;
      forkGame.state.turnStarted = null;
      forkGame.state.turnTimeLimit = 86400;
    } else {
      throw new ServerError(400, "Invalid 'vs' option value");
    }

    return forkGame;
  }

  toJSON() {
    return {...this};
  }
}
