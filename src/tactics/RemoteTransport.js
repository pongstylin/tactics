'use strict';

import EventEmitter from 'events';
import clientFactory from 'client/clientFactory.js';

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

      _data:    null,
      _emitter: new EventEmitter(),
    });

    gameClient
      .on('event', ({ body }) => {
        if (body.group !== `/games/${gameId}`) return;

        this._emit(body);
      })
      .on('open', ({ data }) => {
        if (data.reason === 'reset')
          this._reset(data.outbox);
        else
          this._resume();
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

    if (gameData && gameData.state.ended) {
      this._data = gameData;
      Object.assign(this._data.state, {
        started:     new Date(gameData.state.started),
        turnStarted: new Date(gameData.state.turnStarted),
        ended:       new Date(gameData.state.ended),
      });
      this._resolveReady();
      this._resolveStarted();
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
  get turnStarted() {
    return this._getStateData('turnStarted');
  }
  get currentTurnId() {
    return this._getStateData('currentTurnId');
  }
  get currentTeamId() {
    return this._getStateData('currentTeamId');
  }
  // This property is not actually kept in sync.  It is only accurate when
  // when loading the game or starting the game.
  get units() {
    return this._getStateData('units');
  }
  get actions() {
    return this._getStateData('actions');
  }
  get winnerId() {
    return this._getStateData('winnerId');
  }

  get created() {
    return this._getData('created');
  }
  get started() {
    return this._getStateData('started');
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
  restart() {
    return gameClient.restart(this._data.id, ...arguments);
  }
  postAction(action) {
    gameClient.postAction(this._data.id, action);
  }
  undo() {
    gameClient.undo(this._data.id);
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
      // Event caught internally to set this.playerStatus.
      this._emit({ type:'playerStatus', data:playerStatus });

      if (gameData.undoRequest)
        gameData.undoRequest.accepts = new Set(gameData.undoRequest.accepts);

      this._data = gameData;
      Object.assign(this._data.state, {
        started:     new Date(gameData.state.started),
        turnStarted: new Date(gameData.state.turnStarted),
      });
      this._data.state.actions.forEach(action => {
        action.created = new Date(action.created);
      });
      this._resolveReady();

      if (gameData.state.started)
        this._resolveStarted();
    }).catch(error => {
      if (error === 'Connection reset')
        return this._init(gameId);

      // The error is assumed to be permanent.
      this._rejectReady(error);
    });
  }
  _resume() {
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
    if (!this._data) return;

    let gameId = this._data.id;
    let resume = {
      turnId: this._data.state.currentTurnId,
      actions: this._data.state.actions.length,
    };

    // Instead of watching the game from its current point, resume watching
    // the game from the point we lost connection.
    gameClient.watchGame(gameId, resume).then(data => {
      this._emit({ type:'playerStatus', data:data.playerStatus });

      data.events.forEach(e => this._emit(e));

      if (data.undoRequest) {
        this._data.undoRequest = data.undoRequest;
        // Inform the game of a change in undo status, if any.
        this._emit({
          type: 'undoRequest',
          data: data.undoRequest,
        });
      }
      else if (this._data.undoRequest) {
        this._data.undoRequest = null;
        // Not sure if the request was rejected or accepted.
        // But 'complete' will result in hiding the dialog, if any.
        this._emit({ type:'undoComplete' });
      }
    });

    // Resend specific lost messages
    outbox.forEach(message => {
      if (message.service !== 'game') return;
      if (message.type !== 'event') return;
      let event = message.body;
      if (event.group !== `/games/${gameId}`) return;

      if (event.type === 'action')
        gameClient.postAction(gameId, event.data);
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
        Object.assign(this._data.state, {
          started:     new Date(data.started),
          turnStarted: new Date(data.turnStarted),
          teams:       data.teams,
          units:       data.units,
        });
        this._resolveStarted();
      })
      .on('startTurn', ({ data }) => {
        Object.assign(this._data.state, {
          turnStarted:   new Date(data.started),
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions:       [],
        });
      })
      .on('action', ({ data:actions }) => {
        this._data.state.actions = actions;
        this._data.state.actions.forEach(action => {
          action.created = new Date(action.created);
        });

        // Clear the undo request to permit a new request.
        this._data.undoRequest = null;
      })
      .on('undoRequest', ({ data }) => {
        this._data.undoRequest = Object.assign({}, data, {
          accepts: new Set(data.accepts),
        });
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
      })
      .on('revert', ({ data }) => {
        Object.assign(this._data.state, {
          turnStarted:   new Date(data.started),
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions:       data.actions,
        });

        this._data.state.actions.forEach(action => {
          action.created = new Date(action.created);
        });
      })
      .on('endGame', ({ data }) => {
        Object.assign(this._data.state, {
          winnerId: data.winnerId,
          ended:    new Date(),
        });
      });
  }

  _getData(name) {
    if (!this._data)
      throw new Error('Not ready');

    return this._clone(this._data[name]);
  }
  _getStateData(name) {
    if (!this._data)
      throw new Error('Not ready');

    return this._clone(this._data.state[name]);
  }

  _clone(value) {
    if (value instanceof Date)
      return value;
    else if (Array.isArray(value))
      return [...value];
    else if (typeof value === 'object' && value !== null)
      return {...value};
    return value;
  }
  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
