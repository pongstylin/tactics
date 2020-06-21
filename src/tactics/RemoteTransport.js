import EventEmitter from 'events';

import clientFactory from 'client/clientFactory.js';
import unitDataMap from 'tactics/unitData.js';

let authClient = clientFactory('auth');
let gameClient = clientFactory('game');

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

      _data:    null,
      _emitter: new EventEmitter(),
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
        let myPlayerId = authClient.playerId;
        let playerStatus = [...this.playerStatus].map(([playerId]) => {
          if (playerId === myPlayerId)
            return { playerId, status:'offline' };
          else
            return { playerId, status:'unavailable' };
        });

        this._emit({ type:'playerStatus', data:playerStatus });
      });

    this._watchForDataChanges();

    // For now, joining ended games is ok... unless not authorized.
    if (gameData && gameData.state.ended && !authClient.token) {
      this._data = gameData;
      Object.assign(this._data.state, {
        started:     new Date(gameData.state.started),
        turnStarted: new Date(gameData.state.turnStarted),
        ended:       new Date(gameData.state.ended),
      });
      this._resolveReady();
      this._resolveStarted();
      this._resolveTurnStarted();
    }
    else
      this._init(gameId);
  }

  /*
   * Public Methods
   */
  on(eventType, fn) {
    this._emitter.addListener(...arguments);

    return this;
  }
  once(eventType, fn) {
    let listener = () => {
      this.off(eventType, listener);
      fn();
    };

    this.on(eventType, listener);
  }
  off() {
    this._emitter.removeListener(...arguments);

    return this;
  }

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
  get teams() {
    return this._getStateData('teams');
  }
  get turnTimeLimit() {
    return this._getStateData('turnTimeLimit');
  }
  get created() {
    return this._getData('created');
  }
  get createdBy() {
    return this._getData('createdBy');
  }
  get started() {
    return this._getStateData('started');
  }

  get cursor() {
    if (!this._data)
      throw new Error('Not ready');

    let state = this._data.state;

    return Object.clone({
      turnId: state.currentTurnId,
      teamId: state.currentTeamId,
      started: state.turnStarted,
      units: state.units,
      actions: state.actions,
      nextActionId: state.actions.length,
      atEnd: !!state.ended,
    });
  }
  get currentTurnData() {
    if (!this._data)
      throw new Error('Not ready');

    let state = this._data.state;

    return Object.clone({
      id: state.currentTurnId,
      teamId: state.currentTeamId,
      started: state.turnStarted,
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
  get turnStarted() {
    return this._getStateData('turnStarted');
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
  get ended() {
    return this._getStateData('ended');
  }

  get undoRequest() {
    return this._getData('undoRequest');
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
  undo() {
    return gameClient.undo(this._data.id);
  }
  submitAction(action) {
    return gameClient.submitAction(this._data.id, action);
  }
  acceptUndo() {
    gameClient.acceptUndo(this._data.id);
  }
  rejectUndo() {
    gameClient.rejectUndo(this._data.id);
  }
  cancelUndo() {
    gameClient.cancelUndo(this._data.id);
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

      if (gameData.state.started)
        this._resolveStarted();
      if (gameData.state.turnStarted)
        this._resolveTurnStarted();
    }).catch(error => {
      if (error === 'Connection reset')
        return this._init(gameId);

      // The error is assumed to be permanent.
      this._rejectReady(error);
    });
  }
  _resume() {
    // For now, joining ended games is ok.
    //if (this._data.state.ended) return;

    let gameId = this._data.id;

    gameClient.whenAuthorized.then(() => {
      let myPlayerId = authClient.playerId;

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
    // For now, joining ended games is ok.
    //if (this._data.state.ended) return;

    let gameId = this._data.id;
    let state = this._data.state;
    let actions = state.actions;
    let resume;

    if (state.ended)
      resume = { since:'end' };
    else if (state.started)
      resume = {
        turnId: state.currentTurnId,
        nextActionId: actions.length,
        since: actions.length ? actions.last.created : state.turnStarted,
      };
    else
      resume = { since:'start' };

    // Instead of watching the game from its current point, resume watching
    // the game from the point we lost connection.
    gameClient.watchGame(gameId, resume).then(({playerStatus, gameData, newActions}) => {
      this._emit({ type:'playerStatus', data:playerStatus });

      let oldUndoRequest = this._data.undoRequest;
      let newUndoRequest = gameData.undoRequest;
      if (newUndoRequest)
        // Inform the game of a change in undo status, if any.
        this._emit({ type:'undoRequest', data:newUndoRequest });
      else if (oldUndoRequest && oldUndoRequest.status === 'pending')
        // Not sure if the request was rejected or accepted.
        // But 'complete' will result in hiding the dialog, if any.
        this._emit({ type:'undoComplete' });

      if (gameData.state) {
        let oldStarted = this._data.state.started;
        let oldTurnStarted = this._data.state.turnStarted;

        this._data.state.merge(gameData.state);
        if (newActions)
          this._data.state.actions.push(...newActions);

        if (!oldStarted && this._data.state.started)
          this._resolveStarted();
        if (!oldTurnStarted && this._data.state.turnStarted)
          this._resolveTurnStarted();

        this._emit({ type:'change' });
      }
      else if (newActions) {
        this._data.state.actions.push(...newActions);
        this._emit({ type:'change' });
      }

      if (!outbox) return;

      // Resend specific lost messages
      outbox.forEach(message => {
        if (message.type !== 'event') return;
        let event = message.body;
        if (event.service !== 'game') return;
        if (event.group !== `/games/${gameId}`) return;

        if (event.type === 'action')
          gameClient.submitAction(gameId, event.data);
      });
    });
  }

  _watchForDataChanges(gameData) {
    this
      .on('playerStatus', ({ data }) => {
        if (!Array.isArray(data))
          data = [data];

        data.forEach(ps => this.playerStatus.set(ps.playerId, ps.status));
      })
      .on('startGame', ({ data }) => {
        data.started = new Date(data.started);

        Object.assign(this._data.state, {
          started: data.started,
          teams: data.teams,
          units: data.units,
        });
        this._resolveStarted();
        this._emit({ type:'change' });
      })
      .on('startTurn', ({ data }) => {
        data.started = new Date(data.started);

        this.applyActions();

        Object.assign(this._data.state, {
          turnStarted: data.started,
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions: [],
        });
        this._resolveTurnStarted();
        this._emit({ type:'change' });
      })
      .on('action', ({ data:actions }) => {
        actions.forEach(action => {
          action.created = new Date(action.created);
        });

        this._data.state.actions.push(...actions);
        // Clear the undo request to permit a new request.
        this._data.undoRequest = null;
        this._emit({ type:'change' });
      })
      .on('revert', ({ data }) => {
        data.started = new Date(data.started);
        data.actions.forEach(action => {
          action.created = new Date(action.created);
        });

        Object.assign(this._data.state, {
          turnStarted: data.started,
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          units: data.units,
          actions: data.actions,
        });
        this._emit({ type:'change' });
      })
      .on('endGame', ({ data }) => {
        Object.assign(this._data.state, {
          winnerId: data.winnerId,
          ended:    new Date(),
        });
        this._emit({ type:'change' });
      })
      .on('undoRequest', ({ data }) => {
        data.createdAt = new Date(data.createdAt);
        data.accepts = new Set(data.accepts);

        this._data.undoRequest = data;
      })
      .on('undoAccept', ({ data }) => {
        let undoRequest = this._data.undoRequest;
        let teams = this._data.state.teams;

        teams.forEach(team => {
          if (team.playerId === data.playerId)
            undoRequest.accepts.add(team.id);
        });
      })
      .on('undoReject', ({ data }) => {
        let undoRequest = this._data.undoRequest;

        undoRequest.status = 'rejected';
        undoRequest.rejectedBy = data.playerId;
      })
      .on('undoCancel', () => {
        this._data.undoRequest.status = 'cancelled';
      })
      .on('undoComplete', () => {
        this._data.undoRequest.status = 'completed';
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
        if (unit.mHealth <= -unitData.health)
          teamUnits.splice(i, 1);
      }
    }

    return teamsUnits;
  }
  _applyActionResults(teamsUnits, results) {
    if (!results) return;

    let units = teamsUnits.flat();

    for (let result of results) {
      if (result.type === 'summon') {
        teamsUnits[result.teamId].push(result.unit);
      }
      else {
        let unit = units.find(u => u.id === result.unit);

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

  _emit(event) {
    this._emitter.emit(event.type, event);
    this._emitter.emit('event', event);
  }
}
