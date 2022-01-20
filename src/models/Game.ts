import uuid from 'uuid/v4';

import ActiveModel from 'models/ActiveModel.js';
import serializer from 'utils/serializer.js';

import GameState from 'tactics/GameState.js';
import ServerError from 'server/Error.js';

const gameKeys = new Set([
  'createdBy',
  'collection',
  'tags',
]);

const stateKeys = new Set([
  'type',
  'randomFirstTurn',
  'randomHitChance',
  'strictUndo',
  'autoSurrender',
  'turnTimeBuffer',
  'turnTimeLimit',
  'teams',
]);

export default class Game extends ActiveModel {
  protected data: {
    id: string
    playerRequest: any
    state: GameState
    forkOf: any
    collection: string
    tags: Map<string, string | number | boolean>
    createdBy: string
    createdAt: Date
  }

  constructor(data) {
    super();

    data.state.on('*', event => {
      // Clear a player's rejected requests when their turn starts.
      if (data.playerRequest) {
        if (event.type === 'startTurn') {
          const playerId = data.state.teams[event.data.teamId].playerId;
          const oldRejected = data.playerRequest.rejected;
          const newRejected = [ ...oldRejected ].filter(([k,v]) => !k.startsWith(`${playerId}:`));

          if (newRejected.length !== oldRejected.size) {
            if (newRejected.length)
              data.playerRequest.rejected = new Map(newRejected);
            else
              data.playerRequest = null;
          }
        } else if (event.type === 'endGame')
          data.playerRequest = null;
      }

      this.emit('change:state');
    });

    this.data = data;
  }

  static create(gameOptions) {
    const gameData:any = {
      id: uuid(),
      createdAt: new Date(),
      playerRequest: null,
    };

    const stateData:any = {};
    Object.keys(gameOptions).forEach(option => {
      if (stateKeys.has(option))
        stateData[option] = gameOptions[option];
      else if (gameKeys.has(option))
        gameData[option] = gameOptions[option];
    });

    gameData.state = GameState.create(stateData);

    return new Game(gameData);
  }

  get id() {
    return this.data.id;
  }
  get collection() {
    return this.data.collection;
  }
  get state() {
    return this.data.state;
  }
  get forkOf() {
    return this.data.forkOf;
  }
  get isFork() {
    return !!this.data.forkOf;
  }
  get tags() {
    return this.data.tags;
  }
  get createdBy() {
    return this.data.createdBy;
  }
  get createdAt() {
    return this.data.createdAt;
  }

  mergeTags(tags) {
    let changed = false;

    if (!this.data.tags) {
      this.data.tags = tags;
      changed = true;
    } else {
      const thisTags = this.data.tags;
      for (const [ k, v ] of Object.entries(tags)) {
        if (thisTags[k] === v)
          continue;

        thisTags[k] = v;
        changed = true;
      }
    }

    if (changed)
      this.emit('change:mergeTags');

    return changed;
  }

  checkout(playerId, checkoutAt) {
    let changed = false;

    for (const team of this.data.state.teams) {
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
    if (this.data.state.endedAt)
      throw new ServerError(409, 'The game has ended');

    const playerRequest = this.data.playerRequest;
    if (playerRequest?.status === 'pending')
      throw new ServerError(409, `A '${playerRequest.type}' request is still pending`);

    const myTeams = this.data.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(403, 'You are not a player in this game.');

    if (!Array.isArray(action))
      action = [ action ];

    if (action[0].type === 'surrender')
      action[0].declaredBy = playerId;
    else if (myTeams.includes(this.data.state.currentTeam))
      action.forEach(a => a.teamId = this.data.state.currentTeamId);
    else
      throw new ServerError(409, 'Not your turn!');

    this.data.state.submitAction(action);
  }

  submitPlayerRequest(playerId, requestType) {
    const oldRequest = this.data.playerRequest;
    if (oldRequest?.status === 'pending')
      throw new ServerError(409, `A '${requestType}' request is still pending`);

    if (this.data.state.teams.findIndex(t => t.playerId === playerId) === -1)
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
      this.data.playerRequest = newRequest;

      // The request is sent to all players.  The initiator may cancel.
      this.emit({
        type: `playerRequest`,
        data: newRequest,
      });
      this.emit('change:submitPlayerRequest');
    }
  }
  submitUndoRequest(request) {
    const state = this.data.state;
    const teams = state.teams;
    if (state.endedAt) {
      const myTeams = teams.filter(t => t.playerId === request.createdBy);
      const isPracticeGame = myTeams.length === teams.length;
      const isForkGame = !!this.data.forkOf;
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

    const state = this.data.state;
    if (state.endedAt)
      throw new ServerError(409, 'Game already ended');
    else {
      const teams = state.teams;
      const myTeams = teams.filter(t => t.playerId === request.createdBy);
      const isPracticeGame = myTeams.length === teams.length;
      const isForkGame = !!this.data.forkOf;
      if (isPracticeGame || isForkGame)
        throw new ServerError(403, 'Truce not required for this game');
    }

    return true;
  }
  acceptPlayerRequest(playerId, createdAt) {
    const request = this.data.playerRequest;
    if (request?.status !== 'pending')
      throw new ServerError(409, 'No request');
    if (+createdAt !== +request.createdAt)
      throw new ServerError(409, 'No matching request');
    if (request.accepted.has(playerId))
      throw new ServerError(409, 'Already accepted request');

    request.accepted.add(playerId);

    const teams = this.data.state.teams;
    const acceptedTeams = teams.filter(t => request.accepted.has(t.playerId));

    this.emit({
      type: `playerRequest:accept`,
      data: { playerId },
    });

    if (acceptedTeams.length === teams.length) {
      request.status = 'completed';
      this.emit(`playerRequest:complete`);

      if (request.type === 'undo') {
        teams[request.teamId].setUsedUndo();

        this.data.state.undo(teams[request.teamId], true);
      } else if (request.type === 'truce')
        this.data.state.end('truce');
    }

    this.emit('change:acceptPlayerRequest');
  }
  rejectPlayerRequest(playerId, createdAt) {
    const request = this.data.playerRequest;
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
    const request = this.data.playerRequest;
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
    const forkGameData = serializer.clone(this.data);
    delete forkGameData.collection;

    if (turnId === undefined)
      turnId = forkGameData.state.currentTurnId;
    if (turnId > forkGameData.state.currentTurnId)
      turnId = forkGameData.state.currentTurnId;
    if (vs === undefined)
      vs = 'you';

    /*
     * If necessary, roll back to the previous playable turn.
     */
    forkGameData.state.revert(turnId);
    forkGameData.state.autoPass();

    while (turnId > 0) {
      if (forkGameData.state.winningTeams.length < 2) {
        forkGameData.state.revert(--turnId);
        continue;
      }

      const draw = forkGameData.state.autoPass();
      if (draw) {
        forkGameData.state.revert(--turnId);
        continue;
      }

      break;
    }

    forkGameData.createdAt = new Date();
    forkGameData.id = uuid();
    forkGameData.forkOf = { gameId:this.data.id, turnId:forkGameData.state.currentTurnId };
    forkGameData.state.turnTimeBuffer = null;

    const teams = forkGameData.state.teams = forkGameData.state.teams.map(t => t.fork());

    if (vs === 'you') {
      if (
        !this.data.state.endedAt &&
        !this.data.forkOf &&
        new Set(this.data.state.teams.map(t => t.playerId)).size > 1
      ) {
        const myTeam = this.data.state.teams.find(t => t.playerId === clientPara.playerId);
        if (myTeam) {
          myTeam.setUsedSim();
          this.emit('change:fork');
        }
      }

      teams.forEach(t => t.join({}, clientPara));

      forkGameData.state.turnTimeLimit = null;
      forkGameData.state.start();
    } else if (vs === 'private') {
      if (teams[as] === undefined)
        throw new ServerError(400, "Invalid 'as' option value");

      teams[as].join({}, clientPara);

      forkGameData.state.startedAt = null;
      forkGameData.state.turnStartedAt = null;
      forkGameData.state.turnTimeLimit = 86400;
    }

    return new Game(forkGameData);
  }
};

serializer.addType({
  name: 'Game',
  constructor: Game,
  schema: {
    type: 'object',
    required: [ 'id', 'playerRequest', 'state', 'createdBy', 'createdAt' ],
    properties: {
      id: { type:'string', format:'uuid' },
      collection: { type:'string' },
      playerRequest: {
        type: [ 'object', 'null' ],
        required: [ 'type', 'status', 'accepted', 'rejected', 'createdBy', 'createdAt' ],
        properties: {
          type: {
            type: 'string',
            enum: [ 'undo', 'truce' ],
          },
          status: {
            type: 'string',
            enum: [ 'pending', 'completed', 'rejected', 'cancelled' ],
          },
          accepted: {
            type: 'array',
            subType: 'Set',
            items: {
              type: 'string',
              format: 'uuid',
            },
          },
          rejected: {
            type: 'array',
            subType: 'Map',
            items: {
              type: 'array',
              items: [
                { type:'string' },
                { type:'string' },
              ],
              additionalItems: false,
            },
          },
          createdBy: { type:'string', format:'uuid' },
          createdAt: { type:'string', subType:'Date' },
        },
        additionalProperties: false,
      },
      forkOf: {
        type: 'object',
        required: [ 'gameId', 'turnId' ],
        properties: {
          gameId: { type:'string', format:'uuid' },
          turnId: { type:'number', minimum:0 },
        },
        additionalProperties: false,
      },
      state: { $ref:'GameState' },
      createdBy: { type:'string', format:'uuid' },
      createdAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
