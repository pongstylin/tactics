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
      // Ready means the object is hydrated with state data.
      whenReady: new Promise(resolve => this._resolveReady = resolve),

      // Started means the game has started (and possibly ended)
      whenStarted: new Promise(resolve => this._resolveStarted = resolve),

      _worker:    worker,
      _resolvers: new Map(),
      _emitter:   new EventEmitter(),
    });

    this
      .on('startGame', ({ data }) => {
        Object.assign(this._data.state, {
          started: new Date(data.started),
          teams:   data.teams,
          units:   data.units,
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
        this._data.state.actions.push(...actions);
      })
      .on('revert', ({ data }) => {
        Object.assign(this._data.state, {
          turnStarted: new Date(data.started),
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          // Clone the actions to avoid modifying event data
          actions: [...data.actions],
          units: data.units,
        });
      });
  }

  /*
   * Constructors
   */
  static createGame(gameStateData) {
    let transport = new LocalTransport();
    transport._post({ type:'create', data:gameStateData });

    return transport;
  }

  static loadGame(gameStateData) {
    let transport = new LocalTransport();
    transport._post({ type:'load', data:gameStateData });

    return transport;
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
    return Date.now();
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
  get turnStarted() {
    return this._getStateData('turnStarted');
  }
  get currentTurnId() {
    return this._getStateData('currentTurnId');
  }
  get currentTeamId() {
    return this._getStateData('currentTeamId');
  }
  // This property is not natively actually kept in sync.  The ww only sends
  // units' data at initialization, start of game, or on revert.  But, the game
  // object will keep it in sync as each turn ends.
  get units() {
    return this._getStateData('units');
  }
  set units(units) {
    this._data.state.units = units;
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
  submitAction() {
    return this._call('submitAction', arguments);
  }

  /*
   * Private methods that send messages to the worker.
   */
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

    if (type === 'init') {
      this._data = { state:data };
      this._resolveReady();

      if (data.started)
        this._resolveStarted();
    }
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
    this._emitter.emit('event', event);
  }
}
