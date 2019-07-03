'use strict';

import EventEmitter from 'events';

var counter = 0;

export default class LocalTransport {
  /*
   * The default constructor is not intended for public use.
   */
  constructor() {
    let worker = new Worker('ww.min.js');
    worker.addEventListener('message', ({data:message}) => this._onMessage(message));

    Object.assign(this, {
      whenReady:   new Promise(resolve => this._ready = resolve),

      _worker:     worker,
      _subscribed: new Set(),
      _resolvers:  new Map(),
      _emitter:    new EventEmitter(),
    });
  }

  /*
   * Constructors
   */
  static createGame(gameData) {
    let transport = new LocalTransport();
    transport._post({ type:'create', data:gameData.data });

    return transport;
  }

  static loadGame(gameData) {
    let transport = new LocalTransport();
    transport._post({ type:'load', data:gameData.data });

    return transport;
  }

  /*
   * Public Methods
   */
  on(eventType, fn) {
    this._emitter.addListener(...arguments);
    this._subscribe(eventType);

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
  get actions() {
    return this._getStateData('actions');
  }

  get started() {
    return this._getStateData('started');
  }
  get ended() {
    return this._getStateData('ended');
  }

  /*
   * Proxy these methods to the worker game object.
   * Returns a promise that resolves to the method result, if any.
   */
  getTurnData() {
    return this._call('getTurnData', arguments);
  }
  getTurnActions() {
    return this._call('getTurnActions', arguments);
  }
  join() {
    return this._call('join', arguments);
  }
  undo() {
    return this._call('undo', arguments);
  }
  restart() {
    return this._call('restart', arguments);
  }
  postAction() {
    return this._call('postAction', arguments);
  }

  /*
   * Private methods that send messages to the worker.
   */
  _subscribe(eventType) {
    let subscribed = this._subscribed;
    if (subscribed.has(eventType)) return;
    subscribed.add(eventType);

    this._post({
      type: 'subscribe',
      data: { type:eventType },
    });
  }

  _call(method, args) {
    let resolvers = this._resolvers;
    let id = ++counter;

    this._post({
      type: 'call',
      // Convert arguments to a true Array.
      data: { id:id, method:method, args:Array.from(args) },
    });

    return new Promise(resolve => resolvers.set(id, resolve));
  }

  _post(message) {
    this._worker.postMessage(message);
    return this;
  }

  /*
   * Other Private Methods
   */
  _startSync(gameData) {
    this._data = {};
    this._data.state = gameData;

    if (!gameData.ended)
      this
        .on('startGame', ({data:stateData}) => {
          this._data.state = stateData;
        })
        .on('startTurn', ({ data }) => {
          Object.assign(this._data.state, {
            currentTurnId: data.turnId,
            currentTeamId: data.teamId,
            actions:       [],
          });
        })
        .on('action', ({data:actions}) => {
          this._data.state.actions.push(...actions);
        })
        .on('reset', ({data}) => {
          Object.assign(this._data.state, {
            currentTurnId: data.turnId,
            currentTeamId: data.teamId,
            actions:       data.actions,
          });
        });

    this._ready();
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

  _onMessage(message) {
    let {type, data} = message;

    if (type === 'init')
      this._startSync(data);
    else if (type === 'event')
      this._emit(data);
    else if (type === 'reply') {
      let resolvers = this._resolvers;

      let resolve = resolvers.get(data.id);
      if (!resolve)
        throw new Error('No such resolver id: '+data.id);

      resolvers.delete(data.id);
      resolve(data.value);
    }
    else
      console.warn('Unhandled message', message);
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
