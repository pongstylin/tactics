import { v4 as uuid } from 'uuid';

import timeLimit, { getTurnTimeLimit } from '#config/timeLimit.js';
import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';

import Team from '#models/Team.js';
import Turn from '#models/Turn.js';
import GameState from '#tactics/GameState.js';
import ServerError from '#server/Error.js';

const gameKeys = new Set([
  'forkOf',
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
]);

const REF_TURN_ID    = 0;
const REF_TURN_AT    = 1;
const REF_TURN_LIMIT = 2;
const REF_ACTION_AT  = 3;

const defaultData = {
  collection: null,
};

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

  constructor(data, props?:ConstructorParameters<typeof ActiveModel>[0]) {
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
    data.state.on('sync', () => this.emit('change:state'));

    this.data = Object.assign({}, defaultData, data);
  }

  static create(gameOptions) {
    const gameData:any = {
      id: uuid(),
      createdAt: new Date(),
      playerRequest: null,
    };

    const stateData:any = {
      numTeams: gameOptions.teams.length,
    };
    Object.keys(gameOptions).forEach(option => {
      if (stateKeys.has(option))
        stateData[option] = gameOptions[option];
      else if (gameKeys.has(option))
        gameData[option] = gameOptions[option];
    });

    if (gameOptions.timeLimitName) {
      stateData.timeLimit = timeLimit[gameOptions.timeLimitName].clone();
      if (gameOptions.rated && stateData.timeLimit.base <= 30)
        stateData.undoMode = 'strict';
    }

    gameData.state = GameState.create(stateData);
    for (const [ slot, teamData ] of gameOptions.teams.entries())
      if (teamData)
        if (teamData instanceof Team)
          gameData.state.join(teamData);
        else
          gameData.state.join(Team.create(Object.assign({}, teamData, {
            slot,
            joinedAt: new Date(),
          })));

    return new Game(gameData, { isClean:false, isPersisted:false });
  }

  get id() {
    return this.data.id;
  }
  get collection() {
    return this.data.collection;
  }
  set collection(collection) {
    this.data.collection = collection;
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
      return (actions as any).last.createdAt;
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
    if (!Array.isArray(actions))
      actions = [ actions ];

    if (this.data.state.endedAt)
      throw new ServerError(409, 'The game has ended');

    const playerRequest = this.data.playerRequest;
    // Only lock out actions made by the player that submitted a request.
    if (playerRequest?.status === 'pending' && playerRequest.createdBy === playerId && actions[0].type !== 'surrender')
      throw new ServerError(409, `A '${playerRequest.type}' request is still pending`);

    const myTeam = this.getTeamForPlayer(playerId);
    if (!myTeam)
      throw new ServerError(403, 'You are not a player in this game.');

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
    if (!team)
      throw new ServerError(403, 'You are not a player in this game.');

    request.teamId = team.id;

    const canUndo = state.canUndo(team);
    if (canUndo === false)
      // The undo is rejected.
      throw new ServerError(403, 'You may not undo right now');
    else if (canUndo === true) {
      // The undo is auto-approved.
      state.undo(team, false);
      return false; // Don't save the request.
    } else if (request.rejected.has(`${request.createdBy}:${request.type}`))
      throw new ServerError(403, `Your '${request.type}' request was already rejected`);

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
    const acceptedTeams = teams.filter(t => request.accepted.has(t!.playerId));

    this.emit({
      type: `playerRequest:accept`,
      data: { playerId },
    });

    if (acceptedTeams.length === teams.length) {
      request.status = 'completed';
      this.emit(`playerRequest:complete`);

      if (request.type === 'undo') {
        teams[request.teamId]!.setUsedUndo();

        this.data.state.undo(teams[request.teamId]!, true);
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

    const board = this.state.board;
    const firstTurn = this.state.getTurn(turnId);

    // Reorder teams based on who needs to go first.
    const teams = this.state.teams.slice();
    const units = firstTurn.units.slice();
    for (let i = 0; i < firstTurn.team!.id; i++) {
      teams.push(teams.shift()!);
      units.push(units.shift()!);
      as = (as + teams.length - 1) % teams.length;
    }

    for (const [ teamId, team ] of teams.entries())
      teams[teamId] = team!.fork({
        id: teamId,
        slot: team!.id,
        position: team!.position,
        set: {
          units: board.rotateUnits(units[teamId], board.getDegree(team!.position, 'N')),
        },
      });

    const forkGame = Game.create({
      forkOf: { gameId:this.data.id, turnId },
      createdBy: clientPara.playerId,
      timeLimitName: vs === 'yourself' ? null : timeLimitName,
      type: this.state.type,
      randomFirstTurn: false,
      randomHitChance: this.state.randomHitChance,
      undoMode: 'loose',
      strictFork: false,
      autoSurrender: false,
      rated: false,
      teams,
    });
    forkGame.state.turns.push(Turn.create({
      id: 0,
      team: teams[0],
      data: {
        units,
        drawCounts: firstTurn.drawCounts ?? null,
      },
    }));
    if (forkGame.state.timeLimit)
      forkGame.state.turns[0].timeLimit = getTurnTimeLimit[forkGame.state.timeLimit.type].call(forkGame.state, forkGame.state.turns[0]);

    if (vs === 'yourself') {
      if (!this.state.endedAt && this.state.undoMode !== 'loose') {
        const myTeam = this.state.teams.find(t => t!.playerId === clientPara.playerId);
        if (myTeam)
          myTeam.setUsedSim();
      }

      for (const team of teams)
        team!.join({}, clientPara);
      forkGame.state.start();
    } else {
      if (teams[as] === undefined)
        throw new ServerError(400, "Invalid 'as' option value");

      teams[as]!.join({}, clientPara);

      const vsIndex = (as + 1) % teams.length;
      if (vs === 'same') {
        const opponents = teams.filter(t => t!.forkOf.playerId !== clientPara.playerId);
        if (opponents.length !== 1)
          throw new ServerError(400, `There is no 'same' opponent`);

        teams[vsIndex]!.reserve(opponents[0]!.forkOf);
      } else if (vs !== 'invite')
        teams[vsIndex]!.reserve(vs);
    }

    return forkGame;
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
      const lastTurn = state.recentTurns?.last;
      gameData.reference = [
        state.currentTurnId,
        lastTurn?.startedAt.toISOString() ?? null,
        lastTurn?.timeLimit ?? null,
        ...(lastTurn?.actions.map(a => a.createdAt.toISOString()) ?? []),
      ];
    }

    if (state.recentTurns) {
      const includeTimeLimit = !!this.state.timeLimit && this.state.teams.some(t => t!.playerId === playerId);

      state.recentTurns = state.recentTurns.map((turn, i) => turn.getDigest(i === 0, i === (state.recentTurns.length - 1), includeTimeLimit));
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

    // locked turn id does not progress in practice games
    // Otherwise, if turns have not progressed, locked turn id hasn't either.
    if (this.data.state.undoMode === 'loose' || toTurnId <= fromTurnId)
      delete state.lockedTurnId;

    // Only patch the from turn if it wasn't reverted or is recent enough and loaded.
    const minFromTurnId = Math.max(toTurnId - 10, this.data.state.lastUnloadedTurnId + 1);
    if (fromTurnId > toTurnId || fromTurnId < minFromTurnId)
      return;

    const fromTurn = fromTurnId === toTurnId ? toTurn : this.data.state.getTurn(fromTurnId).getDigest();
    // Only patch the from turn if it wasn't reverted
    if (fromTurnStartedAt.getTime() !== fromTurn.startedAt.getTime())
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
      const events = gameData.events = [] as { type:string, data:any }[];

      // Catch up the context turn as necessary.
      if (syncActionId < fromTurn.actions.length)
        events.push({ type:'action', data:fromTurn.actions.slice(syncActionId) });

      // Catch up subsequent turns, if any.
      for (let turnId = fromTurnId+1; turnId <= toTurnId; turnId++) {
        const turn = turnId === toTurnId ? toTurn : this.data.state.getTurn(turnId);
        const data:any = {
          startedAt: turn.startedAt,
        };
        if (turnId === toTurnId) {
          data.drawCounts = turn.drawCounts;
          data.timeLimit = turn.timeLimit;
        }

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

  toJSON() {
    const data = super.toJSON();
    data.state = data.state.toJSON();
    delete data.state.numTeams;
    data.state.teams = this.state.teams;
    delete data.state.numTurns;
    data.state.turns = this.state.turns;

    for (const dataProp of Object.keys(defaultData))
      if (defaultData[dataProp] === data[dataProp])
        delete data[dataProp];

    return data;
  }
  toParts(allParts = false) {
    const parts = new Map();

    if (this.clean(allParts))
      parts.set('/', { data:this });

    const state = this.data.state;
    // Warning: team.id is null when first creating the game.
    for (const [ teamId, team ] of state.teams.entries())
      if (team && team.clean(allParts))
        parts.set(`/teams/${teamId}`, { data:team });

    for (const turn of state.turns)
      if (turn && turn.clean(allParts))
        parts.set(`/turns/${turn.id}`, { data:turn });

    // The numTurns data is not synced as turns are pushed.
    // This allows us to track the number of persisted turns.
    // So, we can use it to determine if turns need to be deleted.
    for (let t = state.turns.length; t < state._data.numTurns; t++)
      parts.set(`/turns/${t}`, null);
    state._data.numTurns = state.turns.length;

    return parts;
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
