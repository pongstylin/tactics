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
  get autoSurrender() {
    return this._getStateData('autoSurrender');
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
    let actions = this._data.state.actions;

    // Practice games don't impose restrictions.
    const bot = teams.find(t => !!t.bot);
    const opponent = teams.find(t => t.playerId !== team.playerId);
    if (!bot && !opponent)
      return !!(currentTurnId > 1 || actions.length > 0);

    if (this.endedAt && (!this.forkOf || bot))
      return false;

    const firstTurnId = this.getTeamFirstTurnId(team);

    // Can't undo if we haven't had a turn yet.
    if (firstTurnId > currentTurnId)
      return false;

    // Can't undo if we haven't made an action yet.
    if (firstTurnId === currentTurnId && actions.length === 0)
      return false;

    // Bots will never approve anything that requires approval.
    // Strict undo also doesn't allow approval for undos.
    // Once undo was rejected, approval cannot be requested.
    const approve = (
      bot ||
      this.strictUndo ||
      this.playerRequest?.rejected.has(`${team.playerId}:undo`)
    ) ? false : 'approve';
    let requireApproval = false;
    let turnId;

    if (this.endedAt)
      return approve;

    // Determine the turn being undone in whole or in part
    for (turnId = currentTurnId; turnId > -1; turnId--) {
      // Bots do not allow undo after the turn has ended.  This is a technical
      // limitation since bots start executing their move immediately when their
      // turn starts.  It would be better if they started planning the move
      // immediately, but waited to execute until undo limit has passed.
      if (bot && turnId < currentTurnId)
        return false;

      const turnData = this.getRecentTurnData(turnId);
      // Stop if not a recent turn
      if (turnData === false)
        break;
      actions = turnData.actions;

      // Current turn not actionable if no actions were made.
      if (actions.length === 0)
        continue;

      // Not an actionable turn if the turn was forced to pass.
      if (
        actions.length === 1 &&
        actions[0].type === 'endTurn' &&
        actions[0].forced
      ) continue;

      // Require approval if undoing actions made by the opponent team.
      if (turnData.teamId !== team.id) {
        requireApproval = true;
        continue;
      }

      // Require approval if the turn time limit was reached.
      if (this.getTurnTimeRemaining(turnId, 5000, this.now) === 0)
        return approve;

      const preservedActionId = this.getPreservedActionId(actions);
      if (preservedActionId === actions.length)
        return approve;

      if (this.strictUndo && !actions.last.isLocal)
        return +actions.last.createdAt + 5000 - this.now;

      break;
    }

    if (requireApproval)
      return approve;

    return true;
  }
  /*
   * Notice: Recent turn data does not include 'units'.
   */
  getRecentTurnData(turnId) {
    let turnData;

    if (turnId === this.currentTurnId)
      turnData = {
        startedAt: this.turnStartedAt,
        actions: this.actions,
        timeBuffer: this.currentTeam.turnTimeBuffer,
      };
    else if (turnId > this.currentTurnId || turnId < 0)
      return null;
    else {
      const recentTurns = this._data.recentTurns;
      const turnIndex = turnId - this.currentTurnId + recentTurns.length;

      if (recentTurns[turnIndex])
        turnData = recentTurns[turnIndex];
      else
        return false;
    }

    turnData.id = turnId;
    turnData.teamId = turnId % this.teams.length;

    return turnData;
  }
  getPreservedActionId(actions) {
    const selectedUnitId = actions[0].unit;

    return actions.findLastIndex(action => (
      // Preserve unit selection in strict mode
      // Preserve old actions in strict mode
      this.strictUndo && !action.isLocal && (
        action.type === 'select' ||
        this.now - action.createdAt > 5000
      ) ||
      // Preserve counter-attacks
      action.unit !== undefined && action.unit !== selectedUnitId ||
      // Preserve luck-involved attacks
      !!action.results && !!action.results.find(r => 'luck' in r)
    )) + 1;
  }
  getTeamFirstTurnId(team) {
    const numTeams = this.teams.length;
    const waitTurns = Math.min(...team.set.units.map(u => u.mRecovery ?? 0));
    const skipTurns = numTeams === 2 && team.id === 0 ? 1 : 0;

    return team.id + (numTeams * Math.max(waitTurns, skipTurns));
  }
  /*
   * Like GameState->getTurnTimeLimit() but with limited history support.
   */
  getTurnTimeLimit(turnId = this.currentTurnId) {
    if (!this.startedAt || !this.turnTimeLimit)
      return;

    let turnTimeLimit = this.turnTimeLimit;
    if (this.turnTimeBuffer) {
      const turnData = this.getRecentTurnData(turnId);
      if (turnData === false)
        return this.turnTimeLimit;
      const team = this.teams[turnData.teamId];
      const firstTurnId = this.getTeamFirstTurnId(team);

      if (turnId === firstTurnId)
        turnTimeLimit = this.turnTimeBuffer;
      else
        turnTimeLimit += turnData.timeBuffer;
    }

    return turnTimeLimit;
  }
  /*
   * Like GameState->getTurnTimeRemaining() but with limited history support.
   */
  getTurnTimeRemaining(turnId = this.currentTurnId, actionTimeLimit = 10000) {
    if (!this.startedAt || this.endedAt)
      return false;
    if (!this.turnTimeLimit)
      return Infinity;

    const turnData = this.getRecentTurnData(turnId);
    if (turnData === null)
      return 0;
    const turnTimeLimit = this.getTurnTimeLimit(turnId);

    const now = this.now;
    const lastAction = turnData.actions.filter(a => !a.forced).last;
    const lastActionAt = lastAction ? +lastAction.createdAt : 0;
    const actionTimeout = (lastActionAt + actionTimeLimit) - now;
    const turnTimeout = (+turnData.startedAt + turnTimeLimit*1000) - now;

    return Math.max(0, actionTimeout, turnTimeout);
  }

  makeState(units, actions) {
    const board = new Board();
    board.setState(units, this.teams.map(t => new Team(t)));
    board.decodeAction(this.actions).forEach(a => board.applyAction(a));
    return board.getState();
  }

  _makeReady(data) {
    this._data = Object.assign({
      recentTurns: [],
    }, data);
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
    Object.assign(this._data.state, {
      turnStartedAt: data.startedAt,
      currentTurnId: data.turnId,
      currentTeamId: data.teamId,
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

    /*
     * If the new action is an 'endTurn' action, update the state so that it
     * recognizes the new turn.  This is mostly useful when the game ends
     * and a 'startTurn' event never follows.  We could also just push the
     * new turn during an 'endGame' event, but connection lag can delay it.
     */
    if (actions.last.type === 'endTurn') {
      const recentTurns = this._data.recentTurns;
      recentTurns.push({
        startedAt: this.turnStartedAt,
        actions: this.actions,
        timeBuffer: this.currentTeam.turnTimeBuffer,
      });
      recentTurns.shift();

      Object.assign(state, {
        turnStartedAt: actions.last.createdAt,
        currentTurnId: state.currentTurnId + 1,
        currentTeamId: (state.currentTeamId + 1) % state.teams.length,
        units: board.getState(),
        actions: [],
      });

      this._emit({ type:'change' });
    }
  }
  _onRevert({ data }) {
    const state = this._data.state;
    if (state.turnTimeBuffer) {
      const team = state.teams[data.teamId];
      team.turnTimeBuffer = data.timeBuffer;
    }

    Object.assign(state, {
      turnStartedAt: data.startedAt,
      currentTurnId: data.turnId,
      currentTeamId: data.teamId,
      units: data.units,
      actions: data.actions,
      endedAt: null,
      winnerId: null,
    });
    this._applyState();
    this._emit({ type:'change' });
  }
  _onEndGame({ data }) {
    Object.assign(this._data.state, {
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
