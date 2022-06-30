import Team from 'models/Team.js';
import Board from 'tactics/Board.js';
import unitDataMap from 'tactics/unitData.js';
import emitter from 'utils/emitter.js';

export default class Transport {
  constructor(props = {}) {
    Object.assign(this, {
      board: new Board(),

      // Ready means the object is hydrated with game data.
      whenReady: new Promise(),

      // Started means the game has started (and possibly ended)
      whenStarted: new Promise(),
      whenTurnStarted: new Promise(),

      _data: null,

      ...props,
    });
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
  get forkOf() {
    return this._getData('forkOf');
  }
  get teams() {
    return this._getStateData('teams');
  }
  get randomHitChance() {
    return this._getStateData('randomHitChance');
  }
  get strictUndo() {
    return this._getStateData('strictUndo');
  }
  get strictFork() {
    return this._getStateData('strictFork');
  }
  get autoSurrender() {
    return this._getStateData('autoSurrender');
  }
  get rated() {
    return this._getStateData('rated');
  }
  get turnTimeLimit() {
    return this._getStateData('turnTimeLimit');
  }
  get turnTimeBuffer() {
    return this._getStateData('turnTimeBuffer');
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
  get turnStartedAt() {
    return this._getStateData('turnStartedAt');
  }
  get currentTurnTimeLimit() {
    return this._getStateData('currentTurnTimeLimit');
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
  get currentTeam() {
    return this.teams[this.currentTeamId];
  }
  get winningTeams() {
    return this.board.teams.filter(team =>
      !!team.units.find(unit => {
        // Wards don't count.
        if (unit.type === 'BarrierWard' || unit.type === 'LightningWard')
          return false;

        // Shrubs don't count.
        if (unit.type === 'Shrub')
          return false;

        // Paralyzed units don't count.
        if (unit.paralyzed)
          return false;

        return true;
      })
    );
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
   * Other public methods that imitate GameState.
   */
  canUndo(team = this.currentTeam) {
    const teams = this.teams;
    const currentTurnId = this.currentTurnId;
    const actions = this._data.state.actions;

    // Practice games don't impose restrictions.
    const bot = teams.find(t => !!t.bot);
    const opponent = teams.find(t => t.playerId !== team.playerId);
    if (!bot && !opponent)
      return !!(currentTurnId > 1 || actions.length > 0);

    // Bots will never approve anything that requires approval.
    // Approval is also disabled for blitz games with auto surrender.
    // Once undo was rejected, approval cannot be requested.
    const approve = (
      bot ||
      this.turnTimeLimit === 30 && this.autoSurrender ||
      this.playerRequest?.rejected.has(`${team.playerId}:undo`)
    ) ? false : 'approve';

    const firstTurnId = this.getTeamFirstTurnId(team);

    // Can't undo if we haven't had a turn yet.
    if (firstTurnId > currentTurnId)
      return false;

    // Can't undo if we haven't made an action yet.
    if (firstTurnId === currentTurnId && actions.length === 0)
      return false;

    // Only unrated games can undo after the game ends.
    if (this.endedAt)
      return this.rated ? false : approve;

    // Only unrated games can undo after the turn ends.
    const prevTeamId = (this.currentTeamId + teams.length - 1) % teams.length;
    if (team.id === prevTeamId)
      return this.rated ? false : actions.length === 0 ? true : approve;
    else if (team.id !== this.currentTeamId)
      return this.rated ? false : approve;

    // Require approval if undoing a lucky or old action
    const preservedActionId = this.getPreservedActionId(actions);
    if (preservedActionId === actions.length)
      return actions.last.type === 'endTurn' ? false : approve;

    // If a rated game, indicate when we will no longer be able to freely undo
    if (this.rated && (this.strictUndo || actions.last.type === 'endTurn'))
      return Math.min(this.getTurnTimeRemaining(), Math.max(0, +actions.last.createdAt + 5000 - this.now));

    return true;
  }
  getPreservedActionId() {
    const actions = this.actions;
    if (actions.length === 0)
      return 0;
    if (this.rated && this.getTurnTimeRemaining() === 0)
      return actions.length;

    const now = Date.now();
    const selectedUnitId = actions[0].unit;
    const forcedEndTurn = actions.last.type === 'endTurn' && actions.last.forced;

    let actionId = actions.findLastIndex(action => (
      // Preserve any old action in strict mode
      this.strictUndo && (action.type === 'select' || now - action.createdAt > 5000) ||
      // Preserve an old end turn action
      this.rated && action.type === 'endTurn' && now - action.createdAt > 5000 ||
      // Preserve counter-attacks
      action.unit !== undefined && action.unit !== selectedUnitId ||
      // Preserve luck-involved attacks
      !!action.results && !!action.results.find(r => 'luck' in r)
    )) + 1;

    // If the only action that can be undone is a forced endTurn, then nothing can be undone
    if (actionId === actions.length - 1 && forcedEndTurn)
      actionId++;

    // In strict undo mode, you may only undo one action (forced endTurn doesn't count)
    if (this.strictUndo && actionId < actions.length)
      return forcedEndTurn ? actions.length - 2 : actions.length - 1;

    return actionId;
  }
  getTeamFirstTurnId(team) {
    const numTeams = this.teams.length;
    const waitTurns = Math.min(...team.set.units.map(u => u.mRecovery ?? 0));
    const skipTurns = numTeams === 2 && team.id === 0 ? 1 : 0;

    return team.id + (numTeams * Math.max(waitTurns, skipTurns));
  }
  /*
   * Like GameState->getTurnTimeRemaining()
   */
  getTurnTimeRemaining() {
    if (!this.startedAt || this.endedAt)
      return false;
    if (!this.turnTimeLimit)
      return Infinity;

    const turnTimeLimit = this.currentTurnTimeLimit;
    const turnTimeout = +this.turnStartedAt + turnTimeLimit*1000 - this.now;

    return Math.max(0, turnTimeout);
  }

  makeState(units, actions) {
    const board = new Board();
    board.setState(units, this.teams.map(t => new Team(t)));
    board.decodeAction(actions).forEach(a => board.applyAction(a));
    return board.getState();
  }

  _makeReady(data) {
    this._data = data;
    this.whenReady.resolve();
    if (data.state.startedAt) {
      this._applyState();
      this.whenStarted.resolve();
    }
    if (data.state.turnStartedAt)
      this.whenTurnStarted.resolve();

    this
      .on('startGame', this._onStartGame.bind(this))
      .on('startTurn', this._onStartTurn.bind(this))
      .on('action', this._onAction.bind(this))
      .on('revert', this._onRevert.bind(this))
      .on('sync', this._onSync.bind(this))
      .on('endGame', this._onEndGame.bind(this));
  }
  _onStartGame({ data }) {
    Object.assign(this._data.state, {
      startedAt: data.startedAt,
      teams: data.teams,
      units: data.units,
    });
    this._applyState();
    this.whenStarted.resolve();
    this._emit({ type:'change' });
  }
  _onStartTurn({ data }) {
    const board = this.board;

    Object.assign(this._data.state, {
      currentTurnId: data.turnId,
      currentTeamId: data.teamId,
      turnStartedAt: data.startedAt,
      currentTurnTimeLimit: data.timeLimit,
      units: board.getState(),
      actions: [],
    });
    this.whenTurnStarted.resolve();
    this._emit({ type:'change' });
  }
  _onAction({ data:actions }) {
    const state = this._data.state;
    const board = this.board;

    for (const action of actions) {
      state.actions.push(action);
      board.applyAction(board.decodeAction(action));
    }

    // Emit a change so that the game state cursor can pick up on the new
    // action before it is potentially cleared in the next step.
    this._emit({ type:'change' });
  }
  _onRevert({ data }) {
    Object.assign(this._data.state, {
      currentTurnId: data.turnId,
      currentTeamId: data.teamId,
      turnStartedAt: data.startedAt,
      currentTurnTimeLimit: data.timeLimit,
      units: data.units,
      actions: data.actions,
      endedAt: null,
      winnerId: null,
    });
    this._applyState();
    this._emit({ type:'change' });
  }
  /*
   * Sync Game State
   */
  _onSync({ data:{ state, actionId, events, ...sync } }) {
    const data = this._data;
    const board = this.board;

    data.merge(sync);

    /*
     * Sync game state
     */
    if (state) {
      if (state.teams) {
        for (let i = 0; i < state.teams.length; i++)
          // Use Object.merge() since a team might be null
          data.state.teams[i] = Object.merge(data.state.teams[i], state.teams[i]);
        delete state.teams;
      }
      data.state.merge(state);
    }

    if (actionId !== undefined)
      data.state.actions.length = actionId;

    /*
     * Apply and communicate state changes
     */
    if (state || actionId) {
      this._applyState();

      if (!this.whenStarted.isFinalized && state.startedAt)
        this.whenStarted.resolve();
      if (!this.whenTurnStarted.isFinalized && state.turnStartedAt)
        this.whenTurnStarted.resolve();

      this._emit({ type:'change' });
    }

    /*
     * Emit other events that modify game state
     */
    if (events)
      for (const event of events) {
        this._emit(event);
      }
  }
  _onEndGame({ data }) {
    Object.assign(this._data.state, {
      currentTurnTimeLimit: null,
      winnerId: data.winnerId,
      endedAt: new Date(),
    });
    this._emit({ type:'change' });
  }

  _applyState() {
    const board = this.board;
    board.setState(this.units, this.teams.map(t => new Team(t)));
    board.decodeAction(this.actions).forEach(a => board.applyAction(a));
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

emitter(Transport);
