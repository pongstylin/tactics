import uuid from 'uuid/v4';

import ActiveModel from 'models/ActiveModel.js';

import GameState from 'tactics/GameState.js';
import ServerError from 'server/Error.js';

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

export default class Game extends ActiveModel {
  constructor(props) {
    super(props);

    props.state.on('event', () => this.emit('change:state'));
  }

  static create(gameOptions) {
    const gameData = {
      id:          uuid(),
      created:     new Date(),
      undoRequest: null,
    };

    const stateData = {};
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

  checkout(playerId, checkoutAt) {
    let changed = false;

    for (const team of this.state.teams) {
      if (team?.playerId === playerId && team.checkoutAt < checkoutAt) {
        team.checkoutAt = checkoutAt;
        changed = true;
      }
    }

    if (changed)
      this.emit('change:checkout');
    return changed;
  }

  submitAction(playerId, action) {
    if (this.state.ended)
      throw new ServerError(409, 'The game has ended');

    const undoRequest = this.undoRequest || {};
    if (undoRequest.status === 'pending')
      throw new ServerError(409, 'An undo request is still pending');

    const myTeams = this.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(403, 'You are not a player in this game.');

    if (!Array.isArray(action))
      action = [action];

    if (action[0].type === 'surrender')
      action[0].declaredBy = playerId;
    else if (myTeams.includes(this.state.currentTeam))
      action.forEach(a => a.teamId = this.state.currentTeamId);
    else
      throw new ServerError(409, 'Not your turn!');

    this.state.submitAction(action);

    // Clear a rejected undo request after an action is performed.
    if (this.undoRequest) {
      this.undoRequest = null;
      this.emit('change:clearUndo');
    }
  }

  requestUndo(playerId) {
    const state = this.state;
    const teams = state.teams;

    // Determine the team that is requesting the undo.
    let team = state.currentTeam;
    let prevTeamId = (team.id === 0 ? teams.length : team.id) - 1;
    if (team.playerId === playerId) {
      const prevTeam = teams[prevTeamId];
      if (prevTeam.playerId === playerId && state._actions.length === 0)
        team = prevTeam;
    } else {
      while (team.playerId !== playerId) {
        prevTeamId = (team.id === 0 ? teams.length : team.id) - 1;
        team = teams[prevTeamId];
      }
    }

    // In case a player controls multiple teams...
    const myTeams = teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(401, 'You are not a player in this game.');

    if (state.ended)
      throw new ServerError(403, 'The game has ended');

    const undoRequest = this.undoRequest;
    if (undoRequest) {
      if (undoRequest.status === 'pending')
        throw new ServerError(409, 'An undo request is still pending');
      else if (undoRequest.status === 'rejected')
        if (undoRequest.teamId === team.id)
          throw new ServerError(403, 'Your undo request was rejected');
    }

    const canUndo = state.canUndo(team);
    if (canUndo === false)
      // The undo is rejected.
      throw new ServerError(403, 'You can not undo right now');
    else if (canUndo === true)
      // The undo is auto-approved.
      state.undo(team);
    else {
      // The undo request requires approval from the other player(s).
      this.undoRequest = {
        createdAt: new Date(),
        status: 'pending',
        teamId: team.id,
        accepts: new Set(myTeams.map(t => t.id)),
      };

      // The request is sent to all players.  The initiator may cancel.
      this.emit({
        type: 'undo:undoRequest',
        data: Object.assign({}, this.undoRequest, {
          accepts: [ ...this.undoRequest.accepts ],
        }),
      });
      this.emit('change:requestUndo');
    }
  }
  acceptUndo(playerId) {
    const undoRequest = this.undoRequest;
    if (!undoRequest)
      throw new ServerError(400, 'No undo request');
    else if (undoRequest.status !== 'pending')
      throw new ServerError(400, 'Undo request is not pending');

    const teams = this.state.teams;
    const myTeams = teams.filter(t => t.playerId === playerId);

    myTeams.forEach(t => undoRequest.accepts.add(t.id));

    this.emit({
      type: 'undo:undoAccept',
      data: { playerId },
    });

    if (undoRequest.accepts.size === teams.length) {
      undoRequest.status = 'completed';
      teams[undoRequest.teamId].usedUndo = true;

      this.emit('undo:undoComplete');

      this.state.undo(teams[undoRequest.teamId], true);
    }

    this.emit('change:acceptUndo');
  }
  rejectUndo(playerId) {
    const undoRequest = game.undoRequest;
    if (!undoRequest)
      throw new ServerError(400, 'No undo request');
    else if (undoRequest.status !== 'pending')
      throw new ServerError(400, 'Undo request is not pending');

    undoRequest.status = 'rejected';
    undoRequest.rejectedBy = playerId;

    this.emit({
      type: 'undo:undoReject',
      data: { playerId },
    });
    this.emit('change:rejectUndo');
  }
  cancelUndo(playerId) {
    const undoRequest = this.undoRequest;
    if (!undoRequest)
      throw new ServerError(400, 'No undo request');
    else if (undoRequest.status !== 'pending')
      throw new ServerError(400, 'Undo request is not pending');

    const requestorId = this.state.teams[undoRequest.teamId].playerId;
    if (playerId !== requestorId)
      throw new ServerError(403, 'Only requesting player may cancel undo');

    undoRequest.status = 'cancelled';

    this.emit('undo:undoCancel');
    this.emit('change:cancelUndo');
  }

  fork(clientPara, { turnId, vs, as }) {
    // Effectively clone this game before converting the clone to a fork
    const forkGame = Game.load(JSON.parse(JSON.stringify(this)));

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

    const teams = forkGame.state.teams = forkGame.state.teams.map(t => t.fork());

    if (vs === 'you') {
      teams.forEach(t => t.join({}, clientPara));

      forkGame.state.turnTimeLimit = null;
      forkGame.state.start();
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
}
