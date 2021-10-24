import uuid from 'uuid/v4';

import ActiveModel from './ActiveModel';

import GameState from '../tactics/GameState.js';
import ServerError from '../server/Error.js';

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

interface GameData {
  id: string,
  createdAt: Date,
  playerRequest: PReq,
  state: GameState | null,
}

type PReq = {
  rejected: Map<any, any>,
  status: string,
  type: any
  accepted: any,
  teamId?: any,
  createdAt: Date
  createdBy
}

export default class Game extends ActiveModel {
  id: string
  createdAt: Date
  playerRequest: PReq
  state: GameState
  forkOf: any
  isPublic: boolean
  constructor(props) {
    super(props);

    props.state.on('*', event => {
      // Clear a player's rejected requests when their turn starts.
      if (this.playerRequest) {
        if (event.type === 'startTurn') {
          const playerId = props.state.teams[event.data.teamId].playerId;
          const oldRejected = this.playerRequest.rejected;
          const newRejected = [ ...oldRejected ].filter(([k,v]) => !k.startsWith(`${playerId}:`));

          if (newRejected.length !== oldRejected.size) {
            if (newRejected.length)
              this.playerRequest.rejected = new Map(newRejected);
            else
              this.playerRequest = null;
          }
        } else if (event.type === 'endGame')
          this.playerRequest = null;
      }

      this.emit('change:state');
    });
  }

  static create(gameOptions) {
    const gameData: GameData = {
      id: uuid(),
      createdAt: new Date(),
      playerRequest: null,
      state: null
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

    if (typeof data.createdAt === 'string')
      data.createdAt = new Date(data.createdAt);
    if (data.playerRequest) {
      data.playerRequest.createdAt = new Date(data.playerRequest.createdAt);
      data.playerRequest.accepted = new Set(data.playerRequest.accepted);
      data.playerRequest.rejected = new Map(data.playerRequest.rejected);
    }

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
    if (this.state.endedAt)
      throw new ServerError(409, 'The game has ended');

    const playerRequest = this.playerRequest;
    if (playerRequest?.status === 'pending')
      throw new ServerError(409, `A '${playerRequest.type}' request is still pending`);

    const myTeams = this.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(403, 'You are not a player in this game.');

    if (!Array.isArray(action))
      action = [ action ];

    if (action[0].type === 'surrender')
      action[0].declaredBy = playerId;
    else if (myTeams.includes(this.state.currentTeam))
      action.forEach(a => a.teamId = this.state.currentTeamId);
    else
      throw new ServerError(409, 'Not your turn!');

    this.state.submitAction(action);
  }

  submitPlayerRequest(playerId, requestType) {
    const oldRequest = this.playerRequest;
    if (oldRequest?.status === 'pending')
      throw new ServerError(409, `A '${requestType}' request is still pending`);

    if (this.state.teams.findIndex(t => t.playerId === playerId) === -1)
      throw new ServerError(401, 'You are not a player in this game.');

    const newRequest = {
      createdAt: new Date(),
      createdBy: playerId,
      status: 'pending',
      type: requestType,
      accepted: new Set([ playerId ]),
      rejected: oldRequest?.rejected || new Map(),
    };

    let saveRequest = false;
    if (requestType === 'undo')
      saveRequest = this.submitUndoRequest(newRequest);
    else if (requestType === 'truce')
      saveRequest = this.submitTruceRequest(newRequest);

    if (saveRequest) {
      this.playerRequest = newRequest;

      // The request is sent to all players.  The initiator may cancel.
      this.emit({
        type: `playerRequest`,
        data: newRequest,
      });
      this.emit('change:submitPlayerRequest');
    }
  }
  submitUndoRequest(request) {
    const state = this.state;
    const teams = state.teams;
    if (state.endedAt) {
      const myTeams = teams.filter(t => t.playerId === request.createdBy);
      const isPracticeGame = myTeams.length === teams.length;
      const isForkGame = !!this.forkOf;
      if (!isPracticeGame && !isForkGame)
        throw new ServerError(409, 'Game already ended');
    }

    // Determine the team that is making the request.
    let team = state.currentTeam;
    let prevTeamId = (team.id === 0 ? teams.length : team.id) - 1;
    if (team.playerId === request.createdBy) {
      const prevTeam = teams[prevTeamId];
      if (prevTeam.playerId === request.createdBy && state._actions.length === 0)
        team = prevTeam;
    } else {
      while (team.playerId !== request.createdBy) {
        prevTeamId = (team.id === 0 ? teams.length : team.id) - 1;
        team = teams[prevTeamId];
      }
    }

    request.teamId = team.id;

    const canUndo = state.canUndo(team);
    if (canUndo === false)
      // The undo is rejected.
      throw new ServerError(403, 'You may not undo right now');
    else if (canUndo === true)
      // The undo is auto-approved.
      state.undo(team);
    else if (request.rejected.has(`${request.createdBy}:${request.type}`))
      throw new ServerError(403, `Your '${request.type}' request was already rejected`);
    else
      return true;
  }
  submitTruceRequest(request) {
    if (request.rejected.has(`${request.createdBy}:${request.type}`))
      throw new ServerError(403, `Your '${request.type}' request was already rejected`);

    const state = this.state;
    if (state.endedAt)
      throw new ServerError(409, 'Game already ended');
    else {
      const teams = state.teams;
      const myTeams = teams.filter(t => t.playerId === request.createdBy);
      const isPracticeGame = myTeams.length === teams.length;
      const isForkGame = !!this.forkOf;
      if (isPracticeGame || isForkGame)
        throw new ServerError(403, 'Truce not required for this game');
    }

    return true;
  }
  acceptPlayerRequest(playerId, createdAt) {
    const request = this.playerRequest;
    if (request?.status !== 'pending')
      throw new ServerError(409, 'No request');
    if (+createdAt !== +request.createdAt)
      throw new ServerError(409, 'No matching request');
    if (request.accepted.has(playerId))
      throw new ServerError(409, 'Already accepted request');

    request.accepted.add(playerId);

    const teams = this.state.teams;
    const acceptedTeams = teams.filter(t => request.accepted.has(t.playerId));

    this.emit({
      type: `playerRequest:accept`,
      data: { playerId },
    });

    if (acceptedTeams.length === teams.length) {
      request.status = 'completed';
      this.emit(`playerRequest:complete`);

      if (request.type === 'undo') {
        teams[request.teamId].usedUndo = true;

        this.state.undo(teams[request.teamId], true);
      } else if (request.type === 'truce')
        this.state.end('truce');
    }

    this.emit('change:acceptPlayerRequest');
  }
  rejectPlayerRequest(playerId, createdAt) {
    const request = this.playerRequest;
    if (request?.status !== 'pending')
      throw new ServerError(409, 'No request');
    if (+createdAt !== +request.createdAt)
      throw new ServerError(409, 'No matching request');

    request.status = 'rejected';
    request.rejected.set(`${request.createdBy}:${request.type}`, playerId);

    this.emit({
      type: `playerRequest:reject`,
      data: { playerId },
    });
    this.emit('change:rejectPlayerRequest');
  }
  cancelPlayerRequest(playerId, createdAt) {
    const request = this.playerRequest;
    if (request?.status !== 'pending')
      throw new ServerError(409, 'No request');
    if (+createdAt !== +request.createdAt)
      throw new ServerError(409, 'No matching request');
    if (playerId !== request.createdBy)
      throw new ServerError(403, 'Not your request');

    request.status = 'cancelled';

    this.emit(`playerRequest:cancel`);
    this.emit('change:cancelPlayerRequest');
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
    if (vs === undefined)
      vs = 'you';

    /*
     * If necessary, roll back to the previous playable turn.
     */
    forkGame.state.revert(turnId);
    while (turnId > 0) {
      if (forkGame.state.winningTeams.length < 2) {
        forkGame.state.revert(--turnId);
        continue;
      }

      const draw = forkGame.state.autoPass();
      if (draw) {
        forkGame.state.revert(--turnId);
        continue;
      }

      break;
    }

    forkGame.createdAt = new Date();
    forkGame.id = uuid();
    forkGame.forkOf = { gameId:this.id, turnId:forkGame.state.currentTurnId };
    forkGame.isPublic = false;

    const teams = forkGame.state.teams = forkGame.state.teams.map(t => t.fork());

    if (vs === 'you') {
      if (
        !this.state.endedAt &&
        !this.forkOf &&
        new Set(this.state.teams.map(t => t.playerId)).size > 1
      ) {
        const myTeam = this.state.teams.find(t => t.playerId === clientPara.playerId);
        if (myTeam) {
          myTeam.usedSim = true;
          this.emit('change:fork');
        }
      }

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

      forkGame.state.startedAt = null;
      forkGame.state.turnStartedAt = null;
      forkGame.state.turnTimeLimit = 86400;
    } else {
      throw new ServerError(400, "Invalid 'vs' option value");
    }

    return forkGame;
  }
}
