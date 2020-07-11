import EventEmitter from 'events';

import unitDataMap from 'tactics/unitData.js';

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
      whenTurnStarted: new Promise(resolve => this._resolveTurnStarted = resolve),

      _worker:    worker,
      _resolvers: new Map(),
      _emitter:   new EventEmitter(),
    });

    this
      .on('startGame', ({ data }) => {
        data.started = new Date(data.started);

        Object.assign(this._data.state, {
          started: data.started,
          teams: data.teams,
          units: data.units,

          // Useful when restarting an offline game
          ended: null,
          winnerId: null,
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
        this._applyActionResults(result.results);
    }
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
      atEnd: !!this.ended,
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
    this.whenReady = new Promise(resolve => this._resolveReady = resolve);
    this.whenStarted = new Promise(resolve => this._resolveStarted = resolve);
    this.whenTurnStarted = new Promise(resolve => this._resolveTurnStarted = resolve);

    this._post({ type:'restart' });
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

    return Object.clone(this._data[name]);
  }

  _getStateData(name) {
    if (!this._data)
      throw new Error('Not ready');

    return Object.clone(this._data.state[name]);
  }

  _onMessage(message) {
    let {type, data} = message;

    if (type === 'init') {
      this._data = { state:data };
      this._resolveReady();

      if (data.started)
        this._resolveStarted();
      if (data.turnStarted)
        this._resolveTurnStarted();
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
