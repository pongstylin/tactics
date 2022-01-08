import unitDataMap from 'tactics/unitData.js';
import emitter from 'utils/emitter.js';

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
      whenReady: new Promise(),

      // Started means the game has started (and possibly ended)
      whenStarted: new Promise(),
      whenTurnStarted: new Promise(),

      _worker:    worker,
      _resolvers: new Map(),
    });

    this
      .on('startGame', ({ data }) => {
        data.startedAt = new Date(data.startedAt);

        Object.assign(this._data.state, {
          startedAt: data.startedAt,
          teams: data.teams,
          units: data.units,

          // Useful when restarting an offline game
          endedAt: null,
          winnerId: null,
        });
        this.whenStarted.resolve();
        this._emit({ type:'change' });
      })
      .on('startTurn', ({ data }) => {
        data.startedAt = new Date(data.startedAt);

        this.applyActions();

        Object.assign(this._data.state, {
          turnStartedAt: data.startedAt,
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions: [],
        });
        this.whenTurnStarted.resolve();
        this._emit({ type:'change' });
      })
      .on('action', ({ data:actions }) => {
        actions.forEach(action => {
          action.createdAt = new Date(action.createdAt);
        });

        this._data.state.actions.push(...actions);
        this._emit({ type:'change' });
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
        Object.assign(this._data.state, {
          winnerId: data.winnerId,
          endedAt: new Date(),
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

  /*
   * Public Properties
   */
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
  get startedAt() {
    return this._getStateData('startedAt');
  }

  get cursor() {
    if (!this._data)
      throw new Error('Not ready');

    let state = this._data.state;

    return Object.clone({
      turnId: state.currentTurnId,
      teamId: state.currentTeamId,
      startedAt: state.turnStartedAt,
      units: state.units,
      actions: state.actions,
      nextActionId: state.actions.length,
      atEnd: !!this.endedAt,
    });
  }
  get currentTurnData() {
    if (!this._data)
      throw new Error('Not ready');

    let state = this._data.state;

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
    this.whenReady = new Promise();
    this.whenStarted = new Promise();
    this.whenTurnStarted = new Promise();

    this._post({ type:'restart' });
  }
  submitAction() {
    return this._call('submitAction', arguments);
  }

  /*
   * Private methods that send messages to the worker.
   */
  _call(method, args) {
    const resolvers = this._resolvers;
    const id = ++counter;

    this._post({
      type: 'call',
      // Convert arguments to a true Array.
      data: { id:id, method:method, args:Array.from(args) },
    });

    const promise = new Promise();
    resolvers.set(id, promise);

    return promise;
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
    const {type, data} = message;

    if (type === 'init') {
      this._data = { state:data };
      this.whenReady.resolve();

      if (data.startedAt)
        this.whenStarted.resolve();
      if (data.turnStartedAt)
        this.whenTurnStarted.resolve();
    }
    else if (type === 'event')
      this._emit(data);
    else if (type === 'reply') {
      const resolvers = this._resolvers;

      const promise = resolvers.get(data.id);
      if (!promise)
        throw new Error('No such resolver id: '+data.id);

      resolvers.delete(data.id);
      promise.resolve(data.value);
    }
    else
      console.warn('Unhandled message', message);
  }
}

emitter(LocalTransport);
