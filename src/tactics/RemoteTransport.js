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
      whenReady:    new Promise(resolve => this._ready = resolve),

      _data:    null,
      _emitter: new EventEmitter(),
    });

    gameClient
      .on('event', ({ body }) => {
        if (body.group !== `/games/${gameId}`) return;

        this._emit(body);
      })
      .on('open', () => {
        let myPlayerId = authClient.userId;

        this._emit({
          type: 'playerStatus',
          data: { playerId:myPlayerId, status:'online' },
        });

        gameClient.getPlayerStatus(gameId).then(playerStatus =>
          this._emit({ type:'playerStatus', data:playerStatus })
        );
      })
      .on('close', () => {
        let myPlayerId = authClient.userId;
        let playerStatus = [...this.playerStatus].map(([playerId]) => {
          if (playerId === myPlayerId)
            return { playerId, status:'offline' };
          else
            return { playerId, status:'unavailable' };
        });

        this._emit({ type:'playerStatus', data:playerStatus });
      })
      .on('reset', ({ data:messages }) => {
        let resume = {
          turnId: this._data.state.currentTurnId,
          actions: this._data.state.actions.length,
        };

        // Instead of watching the game from its current point, resume watching
        // the game from the point we lost connection.
        gameClient.watchGame(gameId, resume).then(({playerStatus, events}) => {
          this._emit({ type:'playerStatus', data:playerStatus });

          events.forEach(e => this._emit(e));
        });

        // Resend specific lost messages
        messages.forEach(message => {
          if (message.type !== 'event') return;
          let event = message.body;
          if (event.group !== `/games/${this._data.id}`) return;

          if (event.type === 'action')
            gameClient.postAction(this._data.id, event.data);
        });
      });

    this._watchForDataChanges();

    if (gameData && gameData.state.ended) {
      this._data = gameData;
      this._ready();
    }
    else
      gameClient.watchGame(gameId).then(({playerStatus, gameData}) => {
        this._emit({ type:'playerStatus', data:playerStatus });

        this._data = gameData;
        this._ready();
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

  /*
   * Other Private Methods
   */
  _watchForDataChanges(gameData) {
    this
      .on('playerStatus', ({ data }) => {
        if (!Array.isArray(data))
          data = [data];

        data.forEach(ps => this.playerStatus.set(ps.playerId, ps.status));
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
      .on('revert', ({ data }) => {
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
