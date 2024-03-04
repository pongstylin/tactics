import { v4 as uuid } from 'uuid';
import util from 'util';

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
  'strictUndo',
  'strictFork',
  'autoSurrender',
  'rated',
  'timeLimit',
  'teams',
]);

const REF_TURN_ID    = 0;
const REF_TURN_AT    = 1;
const REF_TURN_LIMIT = 2;
const REF_ENDED_AT   = 3;
const REF_ACTION_AT  = 4;

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

  constructor(data) {
    super();

    data.state.on('sync', ({ data:event }) => {
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
  get timeLimitName() {
    return this.data.timeLimitName;
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

  checkin(team, checkinAt = new Date()) {
    let changed = false;

    if (team.checkinAt < checkinAt) {
      team.checkinAt = checkinAt;
      changed = true;
    }

    if (changed)
      this.emit('change:checkin');
    return changed;
  }
  checkout(team, checkoutAt, lastActiveAt) {
    let changed = false;

    if (team.checkoutAt < checkoutAt) {
      team.checkoutAt = checkoutAt;
      changed = true;
    }
    if (team.lastActiveAt < lastActiveAt) {
      team.lastActiveAt = lastActiveAt;
      changed = true;
    }

    if (changed)
      this.emit('change:checkout');
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
    if (state.endedAt && state.rated)
      throw new ServerError(409, 'Game already ended');

    // Determine the team that is making the request.
    const team = state.isPracticeGame && state._actions.length === 0
      ? state.getPreviousTeam()
      : state.getTeamForPlayer(request.createdBy);

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
    if (!state.rated)
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

  fork(clientPara, { turnId, vs, as }) {
    if (this.state.strictFork && !this.state.endedAt)
      throw new ServerError(403, 'Forking is restricted for this game until it ends.');

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
    forkGameData.state.autoPass(true);
    forkGameData.state.lockedTurnId = forkGameData.state.getFirstTurnId() - 1;

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

    forkGameData.createdBy = clientPara.playerId;
    forkGameData.createdAt = new Date();
    forkGameData.id = uuid();
    forkGameData.forkOf = { gameId:this.data.id, turnId:forkGameData.state.currentTurnId };
    forkGameData.state.strictUndo = false;
    forkGameData.state.strictFork = false;
    forkGameData.state.autoSurrender = false;
    forkGameData.state.rated = false;
    forkGameData.state.flaggedForFarming = false;

    const teams = forkGameData.state.teams = forkGameData.state.teams.map(t => t.fork());

    if (vs === 'you') {
      if (!this.data.state.endedAt && this.data.state.rated) {
        const myTeam = this.data.state.teams.find(t => t.playerId === clientPara.playerId);
        if (myTeam) {
          myTeam.setUsedSim();
          this.emit('change:fork');
        }
      }

      teams.forEach(t => t.join({}, clientPara));

      forkGameData.timeLimitName = null;
      forkGameData.state.timeLimit = null;
      forkGameData.state.start();
    } else if (vs === 'private') {
      if (teams[as] === undefined)
        throw new ServerError(400, "Invalid 'as' option value");

      teams[as].join({}, clientPara);

      forkGameData.timeLimitName = 'day';
      forkGameData.state.timeLimit = timeLimit.day.clone();
      forkGameData.state.startedAt = null;
      forkGameData.state.turnStartedAt = null;
    }

    return new Game(forkGameData);
  }

  cancel() {
    if (this.isCancelled === true)
      return;
    if (this.state.startedAt)
      throw new ServerError(409, 'Game already started');

    this.isCancelled = true;
    this.emit('delete');
  }

  getSyncForPlayer(playerId, reference) {
    const gameData = this.toJSON();
    const state = gameData.state = this.state.getDataForPlayer(playerId);

    // Don't care about syncing tags
    delete gameData.tags;

    if (!state.startedAt)
      gameData.reference = 'creation';
    else
      gameData.reference = [
        state.currentTurnId,
        state.turnStartedAt.toISOString(),
        state.currentTurnTimeLimit,
        state.endedAt ? state.endedAt.toISOString() : null,
        ...state.actions.map(a => a.createdAt.toISOString()),
      ];

    if (!reference) {
      this._addRecentTurns(gameData, playerId);
      return gameData;
    }

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

    delete gameData.state.type;
    delete gameData.state.randomFirstTurn;
    delete gameData.state.randomHitChance;
    delete gameData.state.timeLimit;
    delete gameData.state.strictUndo;
    delete gameData.state.strictFork;
    delete gameData.state.autoSurrender;
    delete gameData.state.rated;
    delete gameData.state.flaggedForFarming;

    if (reference === 'creation') {
      this._addRecentTurns(gameData, playerId);
      return gameData;
    }

    // These values are set when a game starts and cannot be changed.
    // So, when resuming a game, these values need not be sent.
    delete state.startedAt;
    delete state.teams;

    this._pruneGameState(gameData, reference);
    this._addRecentTurns(gameData, playerId);

    return gameData;
  }

  _pruneGameState(gameData, reference) {
    const state = gameData.state;
    const fromTurnId = reference[REF_TURN_ID];
    const fromTurnStartedAt = reference[REF_TURN_AT];
    const fromTurnLimit = reference[REF_TURN_LIMIT];
    const fromEndedAt = reference[REF_ENDED_AT];
    const fromActionId = reference.length - REF_ACTION_AT;
    const fromActionsAt = reference.slice(REF_ACTION_AT);
    const toTurnId = gameData.reference[REF_TURN_ID];
    const toTurnLimit = state.currentTurnTimeLimit;
    const toEndedAt = gameData.reference[REF_ENDED_AT];

    // If the turn doesn't exist anymore...
    // Or if they are too far behind, just prune a couple things
    if (fromTurnId > toTurnId || fromTurnId < toTurnId - 10) {
      if (fromTurnLimit === toTurnLimit)
        delete state.currentTurnTimeLimit;

      if (fromEndedAt === toEndedAt) {
        delete state.endedAt;
        delete state.winnerId;
      }

      return;
    }

    gameData.events = [];

    const toTurn = {
      id: state.currentTurnId,
      teamId: state.currentTeamId,
      startedAt: state.turnStartedAt,
      timeLimit: state.currentTurnTimeLimit,
      units: state.units,
      actions: state.actions,
    };
    const turn = fromTurnId === toTurnId ? toTurn : this.state.getTurnData(fromTurnId);
    const toTurnStartedAt = turn.startedAt.toISOString();
    const toActionId = turn.actions.length;
    const toActionsAt = turn.actions.map(a => a.createdAt.toISOString());

    // Whether fromTurnId is old or current, we aren't changing it yet
    delete state.lockedTurnId;
    delete state.currentTurnId;
    delete state.currentTeamId;

    if (fromTurnId === toTurnId) {
      if (fromTurnStartedAt === toTurnStartedAt)
        delete state.turnStartedAt;
      if (fromTurnLimit === toTurnLimit)
        delete state.currentTurnTimeLimit;
    } else /* fromTurnId < toTurnId */ {
      // These values will be communicated via 'startTurn' events.
      delete state.turnStartedAt;
      delete state.currentTurnTimeLimit;
    }

    // Don't need the units at start of turn if they were already seen
    if (fromTurnStartedAt === toTurnStartedAt) {
      delete state.units;

      if (fromActionId === toActionId && fromActionsAt.last === toActionsAt.last)
        // Actions are unchanged
        delete state.actions;
      else if (fromActionId) {
        const actionId = fromActionsAt.findIndex((aAt,i) => aAt !== toActionsAt[i]);
        if (actionId === -1) {
          // No actions have changed and there are more!
          gameData.events.push({ type:'action', data:turn.actions.slice(fromActionId) });
          delete state.actions;
        } else if (actionId === 0) {
          // All actions have changed, replace them!
          state.actions = turn.actions;
        } else {
          // Some actions have changed or disappeared, truncate!
          gameData.actionId = actionId;

          // Push actions, if necessary
          if (toActionId > actionId)
            gameData.events.push({ type:'action', data:turn.actions.slice(actionId) });

          delete state.actions;
        }
      } else if (toActionId) {
        gameData.events.push({ type:'action', data:turn.actions });

        delete state.actions;
      }
    } else {
      state.units = turn.units;
      if (fromActionId || turn.actions.length)
        state.actions = turn.actions;
      else
        delete state.actions;
    }

    for (let turnId = fromTurnId+1; turnId <= toTurnId; turnId++) {
      const nextTurn = turnId === toTurnId ? toTurn : this.state.getTurnData(turnId);

      gameData.events.push({
        type: 'startTurn',
        data: {
          turnId: nextTurn.id,
          teamId: nextTurn.teamId,
          startedAt: nextTurn.startedAt,
          timeLimit: nextTurn.timeLimit ?? null,
        },
      });
      if (nextTurn.actions.length)
        gameData.events.push({ type:'action', data:nextTurn.actions });
    }

    if (toEndedAt)
      gameData.events.push({ type:'endGame', data:{ winnerId:state.winnerId } });

    if (fromEndedAt) {
      state.endedAt = null;
      state.winnerId = null;
    } else {
      delete state.endedAt;
      delete state.winnerId;
    }

    if (Object.keys(state).length === 0)
      delete gameData.state;
    if (gameData.events.length === 0)
      delete gameData.events;
  }

  /*
   * Provide enough back history to support undo detection.
   */
  _addRecentTurns(gameData, playerId) {
    const state = this.data.state;

    // Only required for active games
    if (!state.startedAt || state.endedAt)
      return;

    // Not required for practice games
    if (state.isPracticeGame)
      return;

    const currentTurnId = gameData.state?.currentTurnId;

    // Only needed when changing the current turn
    if (currentTurnId === undefined)
      return;

    const team = state.getTeamForPlayer(playerId);

    // Not needed for observers
    if (team === null)
      return;

    // Provide the turns that lead back to the last actionable turn
    const minTurnId = state.getTeamFirstTurnId(team);
    const teams = state.teams;
    const turns = [];
    for (let turnId = currentTurnId - 1; turnId >= minTurnId; turnId--) {
      const turn = state.getTurnData(turnId);
      turns.unshift(turn);

      if (teams[turn.teamId].playerId !== playerId)
        continue;
      if (turn.actions.length === 1 && turn.actions[0].type === 'endTurn' && turn.actions[0].forced)
        continue;
      break;
    }

    if (turns.length === 0)
      return;

    gameData.recentTurns = {
      units: turns[0].units,
      turns: turns.map(t => ({
        turnId: t.id,
        teamId: t.teamId,
        startedAt: t.startedAt,
        timeLimit: t.timeLimit ?? null,
        actions: t.actions,
      })),
    };

    delete gameData.state.units;
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
