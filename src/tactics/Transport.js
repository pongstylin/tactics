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
      _recentTurns: [],
      _listeners: new Map([
        [ 'startGame', this._onStartGame.bind(this) ],
        [ 'startTurn', this._onStartTurn.bind(this) ],
        [ 'action', this._onAction.bind(this) ],
        [ 'revert', this._onRevert.bind(this) ],
        [ 'sync', this._onSync.bind(this) ],
        [ 'endGame', this._onEndGame.bind(this) ]
      ]),

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

  get isPracticeGame() {
    const teams = this.teams;
    const hasBot = teams.findIndex(t => !!t.bot) > -1;
    const isMultiplayer = new Set(teams.map(t => t.playerId)).size > 1;

    return !hasBot && !isMultiplayer;
  }

  /*
   * Like GameState->getUndoPointer();
   * Return a pointer to the earliest turnId and actionId to which the current
   * player may undo without approval.
   *
   * May return null if undo is impossible or not allowed
   * May return false if the player may not undo without approval.
   */
  getUndoPointer(team = this.currentTeam) {
    if (!this.startedAt)
      return null;
    if (this.endedAt)
      return this.rated ? null : false;

    const currentTurnId = this.currentTurnId;
    const actions = this._data.state.actions;

    // Practice games can always undo if there is something to undo.
    if (this.isPracticeGame) {
      const firstTurnId = this.getFirstTurnId();
      if (currentTurnId === firstTurnId && actions.length === 0)
        return null;
      return { turnId:firstTurnId, actionId:0 };
    }

    const firstTurnId = this.getTeamFirstTurnId(team);

    // Can't undo if the team hasn't had a turn yet
    if (currentTurnId < firstTurnId)
      return null;

    // Can't undo if the team hasn't made an action yet
    if (currentTurnId === firstTurnId && actions.length === 0)
      return null;

    const currentTeamId = this.currentTeamId;
    const rated = this.rated;

    // If it is not your turn, you may not undo without approval in rated games
    if (currentTeamId !== team.id && rated)
      return null;

    const strictUndo = this.strictUndo;
    const minTurnId = firstTurnId - 1;
    let pointer = false;

    for (let turnId = currentTurnId; turnId > minTurnId; turnId--) {
      /*
       * Recent turns are only provided if they tell us we can freely undo.
       * If absent in rated games, can't go back to a previous turn.
       * If absent in unrated games, need approval to go back to a previous turn.
       */
      const turnData = this.getRecentTurnData(turnId);
      if (!turnData)
        return pointer || (rated ? null : false);
      const actions = turnData.actions;

      // Skip empty turns and evaluate the previous turn.
      if (actions.length === 0)
        continue;

      // Skip turns forced to pass and evaluate the previous turn.
      if (actions.length === 1 && actions[0].type === 'endTurn' && actions[0].forced)
        continue;

      // Preserve the opponent's last turn
      if (turnData.teamId !== team.id)
        return rated ? pointer || null : pointer;

      // Preserve a turn if the time has run out.
      if (this.rated && this.getTurnTimeRemaining(turnId, Date.now()) === 0)
        return pointer;

      const selectedUnitId = actions[0].unit;

      for (let actionId = actions.length - 1; actionId > -1; actionId--) {
        const action = actions[actionId];

        // Preserve luck-involved attacks
        if (action.results && action.results.findIndex(r => 'luck' in r) > -1)
          return pointer;

        // Preserve counter-attacks
        if (action.unit !== undefined && action.unit !== selectedUnitId)
          return pointer;

        // Undoing 5 seconds after your turn ends isn't allowed
        // ... unless auto pass made it a continuation of your previous turn.
        // Since a continuation is not delayed, the current turn check ensures
        // this validates the true end of a player's turn.
        if (rated && turnId === currentTurnId && action.type === 'endTurn' && Date.now() - action.createdAt > 5000)
          return rated ? pointer || null : pointer;

        // Skip forced endTurn actions and evaluate the previous action.
        if (action.type === 'endTurn' && action.forced)
          continue;

        if (strictUndo) {
          // Preserve unit selection
          if (action.type === 'select')
            return pointer;

          // Preserve old action
          if (Date.now() - action.createdAt > 5000)
            return pointer;

          // Preserve previous action
          return { turnId, actionId };
        }

        // Now we know something can be undone
        pointer = { turnId, actionId };
      }
    }

    return pointer;
  }
  /*
   * Other public methods that imitate GameState.
   */
  canUndo(team = this.currentTeam) {
    const pointer = this.getUndoPointer(team);

    // If undo is impossible or not allowed, return false
    if (pointer === null)
      return false;

    // If undo cannot be done without approval, return 'approve'
    // Bots will never approve anything that requires approval.
    // Approval is also disabled for blitz games with auto surrender.
    if (pointer === false) {
      const hasBot = this.teams.findIndex(t => !!t.bot) > -1;
      const approve = (
        hasBot ||
        this.turnTimeLimit === 30 && this.autoSurrender ||
        this.playerRequest?.rejected.has(`${team.playerId}:undo`)
      ) ? false : 'approve';

      return approve;
    }

    // If a rated game, indicate when we will no longer be able to freely undo
    const turnStartedAt = this._data.state.turnStartedAt;
    const actions = this._data.state.actions;
    if (this.rated && (this.strictUndo || actions.last?.type === 'endTurn')) {
      const actionTimeout = Math.max(0, 5000 - (this.now - (actions.last?.createdAt ?? turnStartedAt)));
      const turnTimeout = this.getTurnTimeRemaining();

      return Math.min(actionTimeout, turnTimeout);
    }

    return true;
  }
  getFirstTurnId() {
    return Math.min(...this.teams.map(t => this.getTeamFirstTurnId(t)));
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

  getRecentTurnData(turnId) {
    const state = this._data.state;
    const recentTurns = this._recentTurns;

    if (turnId === state.currentTurnId)
      return {
        id: turnId,
        teamId: state.currentTeamId,
        startedAt: state.turnStartedAt,
        units: state.units,
        actions: state.actions,
      };
    else if (turnId > state.currentTurnId)
      return null;
    else if (turnId >= state.currentTurnId - recentTurns.length)
      return recentTurns[turnId - state.currentTurnId + recentTurns.length];
  }

  makeState(units, actions) {
    const board = new Board();
    board.setState(units, this.teams.map(t => new Team(t)));
    board.decodeAction(actions).forEach(a => board.applyAction(a));
    return board.getState();
  }

  restart() {
    for (const [ eventType, listener ] of this._listeners.entries()) {
      this.off(eventType, listener);
    }

    this.whenReady = new Promise();
    this.whenStarted = new Promise();
    this.whenTurnStarted = new Promise();
    this._data.state.endedAt = null;
    this._data.state.winnerId = null;
  }

  _makeReady(data) {
    this._data = data;
    if (data.recentTurns) {
      this._applyRecentTurns(data.recentTurns, data.state);
      delete data.recentTurns;
    }
    this.whenReady.resolve();
    if (data.state.startedAt) {
      this._applyState();
      this.whenStarted.resolve();
    }
    if (data.state.turnStartedAt)
      this.whenTurnStarted.resolve();

    for (const [ eventType, listener ] of this._listeners.entries()) {
      this.on(eventType, listener);
    }
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
    const state = this._data.state;
    const recentTurns = this._recentTurns;

    recentTurns.push({
      id: state.currentTurnId,
      teamId: state.currentTeamId,
      startedAt: state.turnStartedAt,
      units: state.units,
      actions: state.actions,
    });
    if (recentTurns.length > 10)
      recentTurns.shift();

    Object.assign(state, {
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
  _onSync({ data:{ recentTurns, state, actionId, events, ...sync } }) {
    const data = this._data;
    const board = this.board;

    if (recentTurns)
      this._applyRecentTurns(recentTurns, state);
    else if (state?.currentTurnId !== undefined)
      this._recentTurns.length = 0;

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
  _applyRecentTurns(recentTurns, state) {
    if (!recentTurns)
      return;

    const board = this.board;
    board.setState(recentTurns.units, this.teams.map(t => new Team(t)));

    this._recentTurns.length = 0;

    for (const turn of recentTurns.turns) {
      this._recentTurns.push({
        id: turn.turnId,
        teamId: turn.teamId,
        startedAt: turn.startedAt,
        units: board.getState(),
        actions: turn.actions,
      });

      board.decodeAction(turn.actions).forEach(a => board.applyAction(a));
    }

    state.units = board.getState();
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
