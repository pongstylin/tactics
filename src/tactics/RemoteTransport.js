import clientFactory from 'client/clientFactory.js';
import unitDataMap from 'tactics/unitData.js';
import emitter from 'utils/emitter.js';

const authClient = clientFactory('auth');
const gameClient = clientFactory('game');

export default class RemoteTransport {
  /*
   * The default constructor is not intended for public use.
   */
  constructor(gameId, gameData) {
    Object.assign(this, {
      playerStatus: new Map(),

      // Ready means the object is hydrated with game data.
      whenReady: new Promise((resolve, reject) => {
        this._resolveReady = resolve;
        this._rejectReady = reject;
      }),

      // Started means the game has started (and possibly ended)
      whenStarted: new Promise(resolve => this._resolveStarted = resolve),
      whenTurnStarted: new Promise(resolve => this._resolveTurnStarted = resolve),

      _data: null,
    });

    gameClient
      .on('event', ({ body }) => {
        if (body.group !== `/games/${gameId}`) return;

        this._emit(body);
      })
      .on('open', ({ data }) => {
        // Connection may be lost after listening to events, but before joining
        // the game and getting the data.  In that case, resume is a no-op and
        // the attempt to join will be retried.
        if (!this._data) return;

        if (data.reason === 'resume')
          this._resume();
        else
          this._reset(data.outbox);
      })
      .on('close', () => {
        const myPlayerId = authClient.playerId;
        const playerStatus = [...this.playerStatus].map(([playerId]) => {
          if (playerId === myPlayerId)
            return { playerId, status:'offline' };
          else
            return { playerId, status:'unavailable' };
        });

        this._emit({ type:'playerStatus', data:playerStatus });
      });

    this._watchForDataChanges();

    // For now, joining ended games is ok... unless not authorized.
    if (gameData && gameData.state.endedAt && !authClient.token) {
      this._data = gameData;
      Object.assign(this._data.state, {
        startedAt: new Date(gameData.state.startedAt),
        turnStartedAt: new Date(gameData.state.turnStartedAt),
        endedAt: new Date(gameData.state.endedAt),
      });

      const playerIds = new Set(gameData.state.teams.map(t => t.playerId));
      const playerStatus = [ ...playerIds ].map(playerId => ({ playerId, status:'offline' }));
      this._emit({ type:'playerStatus', data:playerStatus });
      this._resolveReady();
      this._resolveStarted();
      this._resolveTurnStarted();
    }
    else
      this._init(gameId);
  }

  /*
   * Public Properties
   */
  get now() {
    return gameClient.serverNow;
  }

  /*
   * Game Data Properties
   * These are cached and kept in sync for arbitrary access.
   */
  get type() {
    return this._getStateData('type');
  }
  get forkOf() {
    return this._getData('forkOf');
  }
  get teams() {
    return this._getStateData('teams');
  }
  get randomHitChance() {
    return this._getStateData('randomHitChance');
  }
  get turnTimeLimit() {
    return this._getStateData('turnTimeLimit');
  }
  get createdAt() {
    return this._getData('createdAt');
  }
  get createdBy() {
    return this._getData('createdBy');
  }
  get startedAt() {
    return this._getStateData('startedAt');
  }

  get cursor() {
    if (!this._data)
      throw new Error('Not ready');

    const state = this._data.state;

    return Object.clone({
      turnId: state.currentTurnId,
      teamId: state.currentTeamId,
      startedAt: state.turnStartedAt,
      units: state.units,
      actions: state.actions,
      nextActionId: state.actions.length,
      atEnd: !!state.endedAt,
    });
  }
  get currentTurnData() {
    if (!this._data)
      throw new Error('Not ready');

    const state = this._data.state;

    return Object.clone({
      id: state.currentTurnId,
      teamId: state.currentTeamId,
      startedAt: state.turnStartedAt,
      units: state.units,
      actions: state.actions,
    });
  }
  get currentTurnId() {
    return this._getStateData('currentTurnId');
  }
  get currentTeamId() {
    return this._getStateData('currentTeamId');
  }
  get turnStartedAt() {
    return this._getStateData('turnStartedAt');
  }
  get units() {
    return this._getStateData('units');
  }
  get actions() {
    return this._getStateData('actions');
  }

  get winnerId() {
    return this._getStateData('winnerId');
  }
  get endedAt() {
    return this._getStateData('endedAt');
  }

  get playerRequest() {
    return this._getData('playerRequest');
  }
  get chatDisabled() {
    return this._getData('chatDisabled');
  }

  /*
   * Proxy these methods to the game client.
   * Returns a promise that resolves to the method result, if any.
   */
  getTurnData() {
    return gameClient.getTurnData(this._data.id, ...arguments);
  }
  getTurnActions() {
    return gameClient.getTurnActions(this._data.id, ...arguments);
  }
  submitAction(action) {
    return gameClient.submitAction(this._data.id, action);
  }
  undo() {
    return gameClient.undo(this._data.id);
  }
  truce() {
    return gameClient.truce(this._data.id);
  }
  acceptPlayerRequest() {
    gameClient.acceptPlayerRequest(this._data.id, this.playerRequest.createdAt);
  }
  rejectPlayerRequest() {
    gameClient.rejectPlayerRequest(this._data.id, this.playerRequest.createdAt);
  }
  cancelPlayerRequest() {
    gameClient.cancelPlayerRequest(this._data.id, this.playerRequest.createdAt);
  }

  /*
   * Other Private Methods
   */
  _init(gameId) {
    gameClient.watchGame(gameId).then(({playerStatus, gameData}) => {
      // Event emitted internally to set this.playerStatus.
      this._emit({ type:'playerStatus', data:playerStatus });

      this._data = gameData;
      this._resolveReady();

      if (gameData.state.startedAt)
        this._resolveStarted();
      if (gameData.state.turnStartedAt)
        this._resolveTurnStarted();
    }).catch(error => {
      if (error === 'Connection reset')
        return this._init(gameId);

      // The error is assumed to be permanent.
      this._rejectReady(error);
    });
  }
  _resume() {
    const gameId = this._data.id;

    gameClient.whenAuthorized.then(() => {
      const myPlayerId = authClient.playerId;

      this._emit({
        type: 'playerStatus',
        data: { playerId:myPlayerId, status:'online' },
      });

      gameClient.getPlayerStatus(gameId).then(playerStatus =>
        this._emit({ type:'playerStatus', data:playerStatus })
      );
    });
  }
  _reset(outbox) {
    const gameId = this._data.id;
    const state = this._data.state;
    const actions = state.actions;
    let resume;

    if (state.endedAt)
      resume = { since:'end' };
    else if (state.startedAt)
      resume = {
        turnId: state.currentTurnId,
        nextActionId: actions.length,
        since: actions.length ? actions.last.createdAt : state.turnStartedAt,
      };
    else
      resume = { since:'start' };

    // Instead of watching the game from its current point, resume watching
    // the game from the point we lost connection.
    gameClient.watchGame(gameId, resume).then(({ playerStatus, gameData, newActions }) => {
      this._emit({ type:'playerStatus', data:playerStatus });

      const oldRequest = this._data.playerRequest;
      const newRequest = gameData.playerRequest;
      if (newRequest)
        // Inform the game of a change in player request status, if any.
        this._emit({ type:`playerRequest`, data:newRequest });
      else if (oldRequest && oldRequest.status === 'pending')
        // Not sure if the request was rejected or accepted.
        // But 'complete' will result in hiding the dialog, if any.
        this._emit({ type:`playerRequest:complete` });

      if (gameData.state) {
        const oldStarted = this._data.state.startedAt;
        const oldTurnStarted = this._data.state.turnStartedAt;

        this._data.state.merge(gameData.state);
        if (newActions)
          this._data.state.actions.push(...newActions);

        if (!oldStarted && this._data.state.startedAt)
          this._resolveStarted();
        if (!oldTurnStarted && this._data.state.turnStartedAt)
          this._resolveTurnStarted();

        this._emit({ type:'change' });
      } else if (newActions) {
        this._data.state.actions.push(...newActions);
        this._emit({ type:'change' });
      }

      if (!outbox) return;

      // Resend specific lost messages
      outbox.forEach(message => {
        if (message.type !== 'event') return;
        const event = message.body;
        if (event.service !== 'game') return;
        if (event.group !== `/games/${gameId}`) return;

        if (event.type === 'action')
          gameClient.submitAction(gameId, event.data);
      });
    }).catch(error => {
      // Ignore a connection reset since a new connection will trigger a retry.
      if (error === 'Connection reset')
        return;
      throw error;
    });
  }

  _watchForDataChanges(gameData) {
    this
      .on('playerStatus', ({ data }) => {
        if (!Array.isArray(data))
          data = [data];

        data.forEach(ps => this.playerStatus.set(ps.playerId, ps));
      })
      .on('startGame', ({ data }) => {
        data.startedAt = new Date(data.startedAt);

        Object.assign(this._data.state, {
          startedAt: data.startedAt,
          teams: data.teams,
          units: data.units,
        });
        this._resolveStarted();
        this._emit({ type:'change' });
      })
      .on('startTurn', ({ data }) => {
        data.startedAt = new Date(data.startedAt);

        // Clear a player's rejected requests when their turn starts.
        if (this._data.playerRequest) {
          const playerId = this._data.state.teams[data.teamId].playerId;
          const oldRejected = this._data.playerRequest.rejected;
          const newRejected = [ ...oldRejected ].filter(([k,v]) => !k.startsWith(`${playerId}:`))

          if (newRejected.length !== oldRejected.size) {
            if (newRejected.length)
              this._data.playerRequest.rejected = new Map(newRejected);
            else
              this._data.playerRequest = null;
          }
        }

        this.applyActions();

        Object.assign(this._data.state, {
          turnStartedAt: data.startedAt,
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions: [],
        });
        this._resolveTurnStarted();
        this._emit({ type:'change' });
      })
      .on('action', ({ data:actions }) => {
        let state = this._data.state;

        actions.forEach(action => {
          action.createdAt = new Date(action.createdAt);
        });

        state.actions.push(...actions);

        // Emit a change so that the game state cursor can pick up on the new
        // action before it is potentially cleared in the next step.
        this._emit({ type:'change' });

        /*
         * If the new action is an 'endTurn' action, update the state so that it
         * recognizes the new turn.  This is mostly useful when the game ends
         * and a 'startTurn' event never follows.  We could also just push the
         * new turn during an 'endGame' event, but connection lag can delay it.
         */
        if (actions.last.type === 'endTurn') {
          this.applyActions();

          Object.assign(state, {
            turnStartedAt: actions.last.createdAt,
            currentTurnId: state.currentTurnId + 1,
            currentTeamId: (state.currentTeamId + 1) % state.teams.length,
            actions: [],
          });

          this._emit({ type:'change' });
        }
      })
      .on('revert', ({ data }) => {
        data.startedAt = new Date(data.startedAt);
        data.actions.forEach(action => {
          action.createdAt = new Date(action.createdAt);
        });

        Object.assign(this._data.state, {
          turnStartedAt: data.startedAt,
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          units: data.units,
          actions: data.actions,
          endedAt: null,
          winnerId: null,
        });
        this._emit({ type:'change' });
      })
      .on('endGame', ({ data }) => {
        this._data.playerRequest = null;
        Object.assign(this._data.state, {
          winnerId: data.winnerId,
          endedAt: new Date(),
        });
        this._emit({ type:'change' });
      })
      .on('playerRequest', ({ data:request }) => {
        request.createdAt = new Date(request.createdAt);
        request.accepted = new Set(request.accepted);
        request.rejected = new Map(request.rejected);

        this._data.playerRequest = request;
      })
      .on('playerRequest:accept', ({ data }) => {
        this._data.playerRequest.accepted.add(data.playerId);
      })
      .on('playerRequest:reject', ({ data }) => {
        const playerRequest = this._data.playerRequest;

        playerRequest.status = 'rejected';
        playerRequest.rejected.set(`${playerRequest.createdBy}:${playerRequest.type}`, data.playerId);
      })
      .on('playerRequest:cancel', () => {
        this._data.playerRequest.status = 'cancelled';
      })
      .on('playerRequest:complete', () => {
        this._data.playerRequest.status = 'completed';
      });
  }

  /*
   * Kinda sucks that this duplicates some board logic.
   * But the board logic is more than we need.
   */
  applyActions(teamsUnits = this._data.state.units, actions = this._data.state.actions) {
    let units = teamsUnits.flat();

    for (let action of actions) {
      if ('unit' in action) {
        let unit = units.find(u => u.id === action.unit);

        if (action.assignment)
          unit.assignment = action.assignment;
        if (action.direction)
          unit.direction = action.direction;
        if ('colorId' in action)
          unit.colorId = action.colorId;
      }

      this._applyActionResults(teamsUnits, action.results);
    }

    // Remove dead units
    for (let teamUnits of teamsUnits) {
      for (let i = teamUnits.length-1; i > -1; i--) {
        let unit = teamUnits[i];
        let unitData = unitDataMap.get(unit.type);
        if (unit.mHealth === -unitData.health)
          teamUnits.splice(i, 1);
      }
    }

    return teamsUnits;
  }
  _applyActionResults(teamsUnits, results) {
    if (!results) return;

    const units = teamsUnits.flat();

    for (const result of results) {
      if (result.type === 'summon') {
        teamsUnits[result.teamId].push(result.unit);
      } else {
        const unit = units.find(u => u.id === result.unit);

        Object.assign(unit, result.changes);
      }

      if (result.results)
        this._applyActionResults(teamsUnits, result.results);
    }
  }

  _getData(name) {
    if (!this._data)
      throw new Error('Not ready');

    return Object.clone(this._data[name]);
  }
  _getStateData(name) {
    if (!this._data)
      throw new Error('Not ready');

    return Object.clone(this._data.state[name]);
  }
}

emitter(RemoteTransport);
