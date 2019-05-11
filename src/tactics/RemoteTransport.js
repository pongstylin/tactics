'use strict';

import EventEmitter from 'events';
import clientFactory from 'client/clientFactory.js';

let gameClient = clientFactory('game');

export default class RemoteTransport {
  /*
   * The default constructor is not intended for public use.
   */
  constructor(gameId) {
    Object.assign(this, {
      playerStatus: {},
      whenReady:    new Promise(resolve => this._ready = resolve),

      _data:        null,
      _emitter:     new EventEmitter(),
      _listener:    event => this._emit(event),
    });

    gameClient.on('event', ({ body }) => {
      if (body.group !== `/games/${gameId}`) return;

      this._emit(body);
    });

    this._watchForDataChanges();

    gameClient.getGameData(gameId).then(gameData => {
      this._data = gameData;
      if (this._data.state.started)
        this._ready();

      if (gameData.state.ended) return;

      return gameClient.watchGame(gameId).then(playerStatus => {
        playerStatus.forEach(ps => this._emit({
          type: 'playerStatus',
          data: ps,
        }));
      });
    });
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
  get currentTurnId() {
    return this._getStateData('currentTurnId');
  }
  get currentTeamId() {
    return this._getStateData('currentTeamId');
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

  get created() {
    return this._getData('created');
  }
  get started() {
    return this._getStateData('started');
  }
  get ended() {
    return this._getStateData('ended');
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
    return gameClient.undo(this._data.id, ...arguments);
  }
  restart() {
    return gameClient.restart(this._data.id, ...arguments);
  }
  postAction(action) {
    gameClient.postAction(this._data.id, action);
  }

  destroy() {
    gameClient.unwatchGame(this._data.id, this._listener);
  }

  /*
   * Other Private Methods
   */
  _watchForDataChanges(gameData) {
    this
      .on('playerStatus', ({ data }) => {
        this.playerStatus[data.playerId] = data.status;
      })
      .on('startGame', ({ data:stateData }) => {
        this._data.state = stateData;
        this._ready();
      })
      .on('startTurn', ({ data }) => {
        Object.assign(this._data.state, {
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions:       [],
        });
      })
      .on('action', ({ data:actions }) => {
        this._data.state.actions.push(...actions);
      })
      .on('reset', ({ data }) => {
        Object.assign(this._data.state, {
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions:       data.actions,
        });
      })
      .on('endGame', ({ data }) => {
        Object.assign(this._data.state, {
          winnerId: data.winnerId,
          ended:    new Date().toISOString(),
        });
      });
  }

  _getData(name) {
    if (!this._data)
      throw new Error('Not ready');

    let clone = value => {
      if (typeof value === 'object' && value !== null)
        return Array.isArray(value) ? [...value] : {...value};
      return value;
    };

    return clone(this._data[name]);
  }
  _getStateData(name) {
    if (!this._data)
      throw new Error('Not ready');

    let clone = value => {
      if (typeof value === 'object' && value !== null)
        return Array.isArray(value) ? [...value] : {...value};
      return value;
    };

    return clone(this._data.state[name]);
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
