import { v4 as uuid } from 'uuid';

import timeLimit from '#config/timeLimit.js';
import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';

import GameState from '#tactics/GameState.js';
import ServerError from '#server/Error.js';

const gameKeys = new Set([
  'createdBy',
  'collection',
  'timeLimitName',
  'tags',
]);

const stateKeys = new Set([
  'type',
  'randomFirstTurn',
  'randomHitChance',
  'undoMode',
  'strictFork',
  'autoSurrender',
  'rated',
  'timeLimit',
  'teams',
]);

const REF_TURN_ID    = 0;
const REF_TURN_AT    = 1;
const REF_TURN_LIMIT = 2;
const REF_ACTION_AT  = 3;

export default class Game extends ActiveModel {
  protected data: {
    id: string
    playerRequest: any
    state: GameState
    forkOf: any
    collection: string
    timeLimitName: string | null
    tags: Map<string, string | number | boolean>
    createdBy: string
    createdAt: Date
  }
  protected isCancelled: boolean = false

  constructor(data, props = undefined) {
    super(props);

    // Clear a player's rejected requests when their turn starts.
    data.state.on('startTurn', event => {
      if (data.playerRequest) {
        const playerId = data.state.currentTurn.team.playerId;
        const oldRejected = data.playerRequest.rejected;
        const newRejected = [ ...oldRejected ].filter(([k,v]) => !k.startsWith(`${playerId}:`));

        if (newRejected.length !== oldRejected.size) {
          if (newRejected.length)
            data.playerRequest.rejected = new Map(newRejected);
          else
            data.playerRequest = null;
        }
      }
    });
    // Clear a player request when game ends.
    data.state.on('endGame', () => {
      data.playerRequest = null;
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

    return new Game(gameData, { isClean:false });
  }

  get id() {
    return this.data.id;
  }
  get collection() {
    return this.data.collection;
  }
  get timeLimitName() {
    return this.data.timeLimitName;
  }
  get state() {
    return this.data.state;
  }
  get rated() {
    return this.data.state.rated;
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
  get updatedAt() {
    const createdAt = this.createdAt;
    const turnStartedAt = this.state.turnStartedAt;
    const actions = this.state.actions;
    const endedAt = this.state.endedAt;

    if (endedAt)
      return endedAt;
    else if (actions?.length)
      return actions.last.createdAt;
    else
      return turnStartedAt || createdAt;
  }
  get startedAt() {
    return this.state.startedAt;
  }
  get turnStartedAt() {
    return this.state.turnStartedAt;
  }
  get endedAt() {
    return this.state.endedAt;
  }

  /*
   * If a game hasn't started yet, it is...
   *   ... "open" if there is a null slot in the team list.
   *   ... "reserved" if there is no null slot in the team list.
   */
  get isReserved() {
    const state = this.data.state;
    if (state.startedAt)
      return false;

    return !state.teams.some(t => t === null);
  }

  getTeamForPlayer(playerId) {
    return this.data.state.getTeamForPlayer(playerId);
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

  setRated(rated, reason) {
    this.state.rated = rated;
    this.state.unratedReason = reason;
    this.emit('change:setRated');
  }

  checkin(team, checkinAt = new Date()) {
    // Stop tracking checkin after game ends.
    if (this.state.endedAt)
      return false;

    let changed = false;

    if (team.checkinAt < checkinAt) {
      team.checkinAt = checkinAt;
      changed = true;
    }

    return changed;
  }
  checkout(team, checkoutAt, lastActiveAt) {
    // Stop tracking checkout after game ends.
    if (this.state.endedAt)
      return false;

    let changed = false;

    if (team.checkoutAt < checkoutAt) {
      team.checkoutAt = checkoutAt;
      changed = true;
    }
    if (team.lastActiveAt < lastActiveAt) {
      team.lastActiveAt = lastActiveAt;
      changed = true;
    }

    return changed;
  }

  submitAction(playerId, actions) {
    if (this.data.state.endedAt)
      throw new ServerError(409, 'The game has ended');

    const playerRequest = this.data.playerRequest;
    // Only lock out actions made by the player that submitted a request.
    if (playerRequest?.status === 'pending' && playerRequest.createdBy === playerId)
      throw new ServerError(409, `A '${playerRequest.type}' request is still pending`);

    const myTeam = this.getTeamForPlayer(playerId);
    if (!myTeam)
      throw new ServerError(403, 'You are not a player in this game.');

    if (!Array.isArray(actions))
      actions = [ actions ];

    for (const action of actions) {
      if (action.type === 'surrender')
        action.declaredBy = playerId;
      else if (myTeam.id === this.data.state.currentTeamId)
        action.teamId = myTeam.id;
      else
        throw new ServerError(409, 'Not your turn!');
    }

    this.data.state.submitAction(actions);
  }

  submitPlayerRequest(playerId, requestType, receivedAt = Date.now()) {
    const oldRequest = this.data.playerRequest;
    if (oldRequest?.status === 'pending')
      throw new ServerError(409, `A '${oldRequest.type}' request is still pending`);

    if (this.getTeamForPlayer(playerId) === null)
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
      saveRequest = this.submitUndoRequest(newRequest, receivedAt);
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
  submitUndoRequest(request, receivedAt = Date.now()) {
    const state = this.data.state;
    if (state.endedAt && state.undoMode !== 'loose')
      throw new ServerError(409, 'Game already ended');

    // Determine the team that is making the request.
    const team = state.getTeamForPlayer(request.createdBy);

    request.teamId = team.id;

    const canUndo = state.canUndo(team, receivedAt);
    if (canUndo === false)
      // The undo is rejected.
      throw new ServerError(403, 'You may not undo right now');
    else if (canUndo === true)
      // The undo is auto-approved.
      state.undo(team, false, receivedAt);
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
    if (state.undoMode === 'loose')
      throw new ServerError(403, 'Truce not required for this game');

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

  fork(clientPara, { turnId, vs, as, timeLimitName }) {
    if (this.state.strictFork && !this.state.endedAt)
      throw new ServerError(403, 'Forking is restricted for this game until it ends.');

    const forkGameData = serializer.clone(this.data);
    forkGameData.state.gameType = this.state.gameType;
    delete forkGameData.collection;

    if (turnId === undefined)
      turnId = forkGameData.state.currentTurnId;
    if (turnId > forkGameData.state.currentTurnId)
      turnId = forkGameData.state.currentTurnId;
    if (vs === undefined)
      vs = 'yourself';

    /*
     * If necessary, roll back to the previous playable turn.
     */
    forkGameData.state.revert(turnId, 0, false, true);
    forkGameData.state.autoPass(true);

    while (turnId > 0) {
      if (forkGameData.state.winningTeams.length) {
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

    forkGameData.createdBy = clientPara.playerId;
    forkGameData.createdAt = new Date();
    forkGameData.id = uuid();
    forkGameData.forkOf = { gameId:this.data.id, turnId:forkGameData.state.currentTurnId };
    forkGameData.state.undoMode = 'loose';
    forkGameData.state.strictFork = false;
    forkGameData.state.autoSurrender = false;
    forkGameData.state.rated = false;

    const teams = forkGameData.state.teams = forkGameData.state.teams.map(t => {
      const team = t.fork();
      team.isClean = false;
      return team;
    });
    forkGameData.state.turns.forEach(t => {
      t.team = teams[t.id % teams.length];
      t.isClean = false;
    });

    if (vs === 'yourself') {
      if (!this.data.state.endedAt && this.data.state.undoMode !== 'loose') {
        const myTeam = this.data.state.teams.find(t => t.playerId === clientPara.playerId);
        if (myTeam)
          myTeam.setUsedSim();
      }

      teams.forEach(t => t.join({}, clientPara));

      forkGameData.timeLimitName = null;
      forkGameData.state.timeLimit = null;
      forkGameData.state.currentTurn.timeLimit = null;
      forkGameData.state.start();
    } else {
      if (teams[as] === undefined)
        throw new ServerError(400, "Invalid 'as' option value");

      teams[as].join({}, clientPara);

      const vsIndex = (as + 1) % teams.length;
      if (vs === 'same') {
        const opponents = teams.filter(t => t.forkOf.playerId !== clientPara.playerId);
        if (opponents.length !== 1)
          throw new ServerError(400, `There is no 'same' opponent`);

        teams[vsIndex].reserve(opponents[0].forkOf);
      } else if (vs !== 'invite')
        teams[vsIndex].reserve(vs);

      forkGameData.timeLimitName = timeLimitName;
      forkGameData.state.timeLimit = timeLimit[timeLimitName].clone();
      forkGameData.state.currentTurn.timeLimit = forkGameData.state.timeLimit.base;
    }

    return new Game(forkGameData, { isClean:false });
  }

  cancel() {
    if (this.isCancelled === true)
      return;
    if (this.state.startedAt)
      throw new ServerError(409, 'Game already started');

    const whenDeleted = {} as {
      promise: Promise<any>
      resolve: (value:any) => void
      reject: (reason?:any) => void
    };
    whenDeleted.promise = new Promise((resolve, reject) => {
      whenDeleted.resolve = resolve;
      whenDeleted.reject = reject;
    });

    this.isCancelled = true;
    this.emit({ type:'delete:cancel', whenDeleted });
    return whenDeleted;
  }
  expire() {
    if (this.isCancelled === true)
      return;
    if (this.state.startedAt)
      throw new ServerError(409, 'Game already started');

    const whenDeleted = {} as {
      promise: Promise<any>
      resolve: (value:any) => void
      reject: (reason?:any) => void
    };
    whenDeleted.promise = new Promise((resolve, reject) => {
      whenDeleted.resolve = resolve;
      whenDeleted.reject = reject;
    });

    this.isCancelled = true;
    this.emit({ type:'delete:expire', whenDeleted });
    return whenDeleted;
  }
  decline() {
    if (this.isCancelled === true)
      return;
    if (this.state.startedAt)
      throw new ServerError(409, 'Game already started');

    const whenDeleted = {} as {
      promise: Promise<any>
      resolve: (value:any) => void
      reject: (reason?:any) => void
    };
    whenDeleted.promise = new Promise((resolve, reject) => {
      whenDeleted.resolve = resolve;
      whenDeleted.reject = reject;
    });

    this.isCancelled = true;
    this.emit({ type:'delete:decline', whenDeleted });
    return whenDeleted.promise;
  }

  getSyncForPlayer(playerId, reference) {
    const gameData = this.toJSON();
    const state = gameData.state = this.state.getDataForPlayer(playerId);

    // Don't care about syncing tags
    delete gameData.tags;

    if (!state.startedAt)
      gameData.reference = 'creation';
    else {
      const lastTurn = state.recentTurns.last;
      gameData.reference = [
        state.currentTurnId,
        lastTurn.startedAt.toISOString(),
        lastTurn.timeLimit,
        ...lastTurn.actions.map(a => a.createdAt.toISOString()),
      ];
    }

    if (state.recentTurns) {
      const includeTimeLimit = !!this.state.timeLimit && this.state.teams.some(t => t.playerId === playerId);

      state.recentTurns = state.recentTurns.map((turn, i) => turn.getDigest(i === 0, includeTimeLimit));
    }

    if (!reference)
      return gameData;

    // These values are set when a game is created and cannot be changed.
    // So, when resuming a game, these values need not be sent.
    delete gameData.id;
    delete gameData.collection;
    delete gameData.timeLimitName;
    delete gameData.createdAt;
    delete gameData.createdBy;

    if (JSON.stringify(reference) === JSON.stringify(gameData.reference)) {
      delete gameData.reference;
      delete gameData.state;
      return gameData;
    }

    // Only some data is mutable after game creation.
    for (const key of Object.keys(state))
      if (![
        'teams', 'startedAt', 'rated', 'unratedReason', 'lockedTurnId', 'currentTurnId', 'recentTurns', 'drawCounts'
      ].includes(key))
        delete state[key];

    if (reference === 'creation')
      return gameData;

    // These fields don't change after game start.
    delete state.teams;
    delete state.startedAt;

    // Lazy implementation.  We know rated / unratedReason hasn't changed if game hasn't ended.
    // But we should also delete if client has seen end game state.
    if (!this.state.endedAt) {
      delete state.rated;
      delete state.unratedReason;
    }

    this._pruneGameState(gameData, reference);

    return gameData;
  }

  _pruneGameState(gameData, reference) {
    const state = gameData.state;
    const toTurnId = gameData.reference[REF_TURN_ID];
    const toTurnLimit = gameData.reference[REF_TURN_LIMIT];
    const toTurn = state.recentTurns.last;
    const fromTurnId = reference[REF_TURN_ID];
    const fromTurnStartedAt = new Date(reference[REF_TURN_AT]);
    const fromTurnLimit = reference[REF_TURN_LIMIT];
    const fromActionId = reference.length - REF_ACTION_AT;
    const fromActionsAt = reference.slice(REF_ACTION_AT).map(d => new Date(d));
    const fromTurn = fromTurnId === toTurnId ? toTurn : this.data.state.turns[fromTurnId]?.getDigest();

    // locked turn id does not progress in practice games
    // Otherwise, if turns have not progressed, locked turn id hasn't either.
    if (this.data.state.undoMode === 'loose' || toTurnId <= fromTurnId)
      delete state.lockedTurnId;

    // Only patch the from turn if it wasn't reverted or if it is recent enough.
    if (!fromTurn || fromTurnId < toTurnId - 10 || fromTurnStartedAt.getTime() !== fromTurn.startedAt.getTime())
      return;

    // Either it hasn't changed or events will catch them up.
    delete state.currentTurnId;
    delete state.recentTurns;

    // Patch the current turn, if necessary.
    state.currentTurn = {};

    /*
     * Revert actions, if necessary.
     * Events will supply subsequent actions, if any.
     */
    for (let actionId = 0; actionId < fromActionId; actionId++) {
      if (actionId > fromTurn.actions.length - 1) {
        state.currentTurn.nextActionId = actionId;
        break;
      } else if (fromActionsAt[actionId].getTime() !== fromTurn.actions[actionId].createdAt.getTime()) {
        state.currentTurn.nextActionId = actionId;
        break;
      }
    }

    /*
     * Update current turn time limit, if necessary.
     */
    if (fromTurnId === toTurnId)
      if (fromTurn.timeLimit && fromTurn.timeLimit !== fromTurnLimit)
        state.currentTurn.timeLimit = this.state.getTurnTimeLimit(fromTurnId);

    /*
     * Use events to catch up to subsequent actions and turns, if any.
     */
    const syncActionId = state.currentTurn.nextActionId ?? fromActionId;

    if (fromTurnId < toTurnId || syncActionId < fromTurn.actions.length) {
      const events = gameData.events = [];

      // Catch up the context turn as necessary.
      if (syncActionId < fromTurn.actions.length)
        events.push({ type:'action', data:fromTurn.actions.slice(syncActionId) });

      // Catch up subsequent turns, if any.
      for (let turnId = fromTurnId+1; turnId <= toTurnId; turnId++) {
        const turn = turnId === toTurnId ? toTurn : this.data.state.turns[turnId];
        const data:any = {
          startedAt: turn.startedAt,
        };
        if (turnId === toTurnId)
          data.timeLimit = turn.timeLimit;

        events.push({ type:'startTurn', data });
        if (turn.actions.length)
          events.push({ type:'action', data:turn.actions });
      }
    }

    if (Object.keys(state.currentTurn).length === 0)
      delete state.currentTurn;
    if (Object.keys(state).length === 0)
      delete gameData.state;
  }

  getPartData() {
    const gameData = this.toJSON();
    const state = gameData.state = this.state.toJSON();

    state.teams = state.teams.length;
    delete state.turns;

    return gameData;
  }
  toParts(allParts = false) {
    const parts = new Map();

    parts.set('/', { data:this.getPartData(), isDirty:this.clean(allParts) });

    for (const [ teamId, team ] of this.data.state.teams.entries())
      if (team)
        parts.set(`/teams/${teamId}`, { data:team, isDirty:team.clean(allParts) });

    for (const turn of this.data.state.turns)
      parts.set(`/turns/${turn.id}`, { data:turn.toJSON(), isDirty:turn.clean(allParts) });

    return parts;
  }
  static fromParts(parts) {
    const gameData = parts.get('/');

    gameData.state.teams = new Array(gameData.state.teams);
    for (let teamId = 0; teamId < gameData.state.teams.length; teamId++)
      gameData.state.teams[teamId] = parts.get(`/teams/${teamId}`) ?? null;

    let turnId = -1;
    gameData.state.turns = new Array();
    while (parts.has(`/turns/${++turnId}`))
      gameData.state.turns[turnId] = parts.get(`/turns/${turnId}`);

    gameData.state = GameState.fromJSON(gameData.state);

    const game = new Game(gameData);
    game.isPersisted = true;
    return game;
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
