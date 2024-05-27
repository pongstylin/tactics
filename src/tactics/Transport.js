import Team from 'models/Team.js';
import Turn from 'models/Turn.js';
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

      _teams: null,
      _data: null,
      _listeners: new Map([
        [ 'sync', this._onSync.bind(this) ],
        // For now, sync events can include startTurn and action events.
        // But would it be nice if we only needed sync events?
        // recentTurns is sufficient to give enough history to support undo use.
        // Even if very behind, GameStateCursor can use getTurnData then getTurnActions
        // to efficiently catch up to current state.
        [ 'startTurn', this._onStartTurn.bind(this) ],
        [ 'action', this._onAction.bind(this) ],
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
  get collection() {
    return this._getData('collection');
  }
  get forkOf() {
    return this._getData('forkOf');
  }
  get type() {
    return this._getStateData('type');
  }
  get teams() {
    // Avoid cloning teams by not using _getStateData()
    return this._data.state.teams;
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
  get timeLimitName() {
    return this._getData('timeLimitName');
  }
  get timeLimit() {
    return this._getStateData('timeLimit');
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

  get recentTurns() {
    // Avoid cloning turns by not using _getStateData()
    return this._data.state.recentTurns;
  }
  get initialTurnId() {
    return Math.min(...this.teams.map(t => this.getTeamInitialTurnId(t)));
  }
  get currentTurnId() {
    return this._getStateData('currentTurnId');
  }
  get currentTurn() {
    return this.recentTurns.last ?? null;
  }
  get currentTeamId() {
    return this.recentTurns.last.team.id;
  }
  get currentTeam() {
    return this.teams[this.currentTeamId];
  }
  get turnStartedAt() {
    return this.recentTurns.last.startedAt;
  }
  get currentTurnTimeLimit() {
    return this.getTurnTimeLimit();
  }
  get units() {
    return this.recentTurns.last.units;
  }
  get actions() {
    return this.recentTurns.last.actions;
  }

  get previousTurnId() {
    return this.currentTurnId - 1;
  }
  get previousTurn() {
    return this.recentTurns[this.recentTurns.length - 2] ?? null;
  }
  get previousTeamId() {
    return this.previousTurnId % this.teams.length;
  }
  get previousTeam() {
    return this.teams[this.previousTeamId];
  }

  get cursor() {
    if (!this._data)
      throw new Error('Not ready');

    const currentTurn = this.currentTurn;

    return {
      turnId: currentTurn.id,
      teamId: currentTurn.team.id,
      startedAt: currentTurn.startedAt,
      units: currentTurn.units, // cloned
      actions: currentTurn.actions, // cloned
      nextActionId: currentTurn.nextActionId,
      atEnd: currentTurn.isGameEnded,
    };
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

  get lockedTurnId() {
    return this._getStateData('lockedTurnId');
  }

  get endedAt() {
    return this.recentTurns.last?.gameEndedAt ?? null;
  }
  get winnerId() {
    const lastAction = this.recentTurns.last?.actions.last;
    return lastAction?.type === 'endGame' ? lastAction.winnerId : null;
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
   * Has any other team checked in since the given date?
   */
  seen(team, date) {
    return this._data.state.teams.findIndex(t => t.id !== team.id && t.seen(date)) > -1;
  }

  /*
   * Like GameState->getUndoPointer();
   * Return a pointer to the earliest turnId and actionId to which the current
   * player may undo without approval.
   *
   * May return null if undo is impossible or not allowed
   * May return false if the player may not undo without approval.
   */
  getUndoPointer(team = this.currentTeam, useEarliest = false) {
    if (!team || !this.startedAt)
      return null;

    // Practice games can always undo if there is something to undo.
    if (this.isPracticeGame) {
      const initialTurnId = this.initialTurnId;
      if (this.currentTurnId === initialTurnId && this.currentTurn.isEmpty)
        return null;
      if (useEarliest)
        return { turnId:initialTurnId, actionId:0 };
      if (this.currentTurn.isEmpty || this.currentTurn.isAutoSkipped)
        return { turnId:this.getPreviousPlayableTurnId(), actionId:0 };
      return { turnId:this.currentTurnId, actionId:0 };
    }

    const numTeams = this.teams.length;
    const teamInitialTurnId = this.getTeamInitialTurnId(team);
    const teamContextTurnId = this.currentTurnId - ((numTeams + this.currentTeamId - team.id) % numTeams);
    const teamPreviousTurnId = teamContextTurnId - numTeams;
    const lockedTurnId = this.lockedTurnId;
    const rated = this.rated;
    const strictUndo = this.strictUndo;
    let pointer = false;

    if (this.endedAt)
      return rated ? null : false;

    /*
     * Walk backward through turns and actions until we reach the undo limit.
     */
    for (let turnId = this.currentTurnId; turnId > -1; turnId--) {
      const turn = this.getRecentTurn(turnId);
      if (!turn)
        return pointer;

      if (turn.isCurrent) {
        if (turn.team === team) {
          // Can't undo when previous turn is locked (and there are no actions to undo).
          if (teamPreviousTurnId < lockedTurnId && turn.isEmpty)
            return null;

          // Can't undo if this is the team's first turn (and there are no actions to undo).
          if (teamInitialTurnId === turn.id && turn.isEmpty)
            return null;

          // Can't undo when less than 10 seconds remain in the current turn.
          // This protects against auto or forced surrender.
          if (this.getTurnTimeRemaining(turnId) < 10000)
            return null;

          // Pass control to the next team 5 seconds after the current turn ends in rated games.
          if (rated && turn.isEnded && this.seen(team, turn.endedAt.getTime() + 5000) && Date.now() - turn.endedAt >= 5000)
            return pointer;
        } else {
          // Can't undo when team's last turn is locked.
          if (teamContextTurnId < lockedTurnId)
            return null;

          // Can't undo if the team hasn't had a turn yet.
          if (teamInitialTurnId > turn.id)
            return null;

          // Opponents may not undo current turn without permission.
          // ... except the previous team can undo if:
          //   1) the game is unrated and the current turn is empty, or
          //   2) the game is rated and nobody has seen them move.
          if (rated && this.seen(team, turn.startedAt) || team !== this.previousTeam || !turn.isEmpty)
            return pointer;
        }
      } else {
        // May not undo previous turns in strict undo without permission.
        if (strictUndo)
          return pointer;

        // May undo forcibly skipped turns if something can be undone earlier.
        if (turn.isAutoSkipped)
          continue;

        // May not undo opponent turns without permission.
        if (turn.team !== team)
          return pointer;

        // May not undo when less than 10 seconds remain in the previous turn without permission.
        if (this.getTurnTimeRemaining(turnId) < 10000)
          return pointer;
      }

      for (let actionId = turn.lastActionId; actionId > -1; actionId--) {
        const action = turn.actions[actionId];

        if (strictUndo) {
          // May not undo more than the last action in strict mode without permission.
          if (actionId < turn.lastActionId)
            return pointer;

          // May not undo unit selection in strict mode without permission.
          if (action.type === 'select')
            return pointer;

          // May not undo an action after 5 seconds without permission.
          if (Date.now() - action.createdAt >= 5000)
            return pointer;
        }

        // May not undo luck-involved attacks without permission.
        if (action.results && action.results.findIndex(r => 'luck' in r) > -1)
          return pointer;

        // May not undo counter-attacks without permission.
        if (action.unit !== undefined && action.unit !== turn.unit)
          return pointer;

        // May undo forced end turns if something can be undone earlier.
        if (action.type === 'endTurn' && action.forced)
          continue;

        // Now we know something can be undone
        pointer = { turnId, actionId };
      }

      // Can't undo locked turns.
      if (turn.id === lockedTurnId)
        return pointer;

      // Stop at the next turn id we can undo before the current one.
      if (pointer && !useEarliest)
        return pointer;
    }

    return pointer;
  }
  /*
   * Other public methods that imitate GameState.
   *
   * Note: The external team comes from the Game object and would not match internal teams.
   */
  canUndo(externalTeam = this.currentTeam) {
    const team = this.teams[externalTeam.id];
    const currentTurn = this.currentTurn;
    const pointer = this.getUndoPointer(team);

    // If undo is impossible or not allowed, return false
    if (pointer === null)
      return false;

    // If undo cannot be done without approval, return 'approve'
    // Bots will never approve anything that requires approval.
    // Approval is also disabled for blitz games with auto surrender.
    if (pointer === false) {
      if (
        this.teams.some(t => !!t.bot) ||
        this.timeLimit.base === 30 && this.autoSurrender ||
        this.playerRequest?.rejected.has(`${team.playerId}:undo`)
      ) return false;

      const refreshTimeout = team === currentTurn.team ? Math.max(0, this.getTurnTimeRemaining() - 10000) : 0;

      return { approve:true, refreshTimeout };
    }

    /*
     * Indicate when we will no longer be able to freely undo.
     *   If current team in a strict undo game:
     *     Can't undo 5 seconds after last action is made.
     *   If current team after turn end in a rated game
     *     Can't undo 5 seconds after turn ends (next turn is starting)
     *   If previous team in an unrated game:
     *     Can't undo 10 seconds before previous turn time limit is reached.
     *   If current team before turn ends:
     *     Can't undo 10 seconds before current turn time limit is reached.
     */
    if (team === currentTurn.team && (this.strictUndo || this.rated && currentTurn.isEnded)) {
      const actionTimeout = Math.max(0, 5000 - (this.now - currentTurn.updatedAt));
      const turnTimeout = this.getTurnTimeRemaining();
      const refreshTimeout = Math.min(actionTimeout, turnTimeout);

      return { approve:false, refreshTimeout };
    }

    /*
     * Require approval to go back to previous turn after time limit elapses.
     * Disable undo 10 seconds before current turn time limit elapses.
     * Refresh the more recent timeout.
     */
    const previousTurnTimeout = Math.max(0, this.getTurnTimeRemaining(pointer.turnId) - 10000);
    const currentTurnTimeout = Math.max(0, this.getTurnTimeRemaining() - 10000);
    const refreshTimeout = Math.min(previousTurnTimeout, currentTurnTimeout);

    return { approve:false, refreshTimeout };
  }
  getPreviousTeam(n = 1) {
    const teams = this.teams;
    const teamId = Math.abs(this.currentTeamId - n) % teams.length;

    return teams[teamId];
  }
  getNextTeam(n = 1) {
    const teams = this.teams;
    const teamId = (this.currentTeamId + n) % teams.length;

    return teams[teamId];
  }
  /*
   * Return the most recent team owned by the player, if any.
   */
  getTeamForPlayer(playerId) {
    const numTeams = this.teams.length;

    for (let i = 0; i < numTeams; i++) {
      const team = this.getPreviousTeam(i);
      if (team?.playerId === playerId)
        return team;
    }

    return null;
  }
  getTeamInitialTurnId(team) {
    const numTeams = this.teams.length;
    const waitTurns = Math.min(...team.set.units.map(u => u.mRecovery ?? 0));

    return team.id + numTeams * waitTurns;
  }
  getPreviousPlayableTurnId(contextTurnId = this.currentTurnId) {
    const turnId = this.playableTurnsInReverse(contextTurnId - 1).next().value?.id ?? null;
    if (turnId === null && contextTurnId > this.initialTurnId)
      return contextTurnId - 1;
    return turnId;
  }
  *playableTurnsInReverse(contextTurnId = this.currentTurnId) {
    const index = this.recentTurns.findIndex(t => t.id === contextTurnId);
    const turns = this.recentTurns.slice(0, index + 1).reverse();

    for (const turn of turns) {
      if (!turn.isPlayable)
        continue;

      yield turn;
    }
  }

  // Ported from GameState
  getTurnTimeLimit(turnId = this.currentTurnId) {
    if (!this.startedAt || this.endedAt || !this.timeLimit)
      return null;

    const turn = this.recentTurns.find(t => t.id === turnId);
    if (!turn)
      return null;

    return turn.timeLimit;
  }
  // Ported from GameState
  getTurnTimeRemaining(turnId = this.currentTurnId) {
    if (!this.startedAt || this.endedAt)
      return false;
    if (!this.timeLimit)
      return Infinity;

    const turn = this.recentTurns.find(t => t.id === turnId);
    if (!turn)
      return null;

    const turnTimeLimit = this.getTurnTimeLimit(turnId);
    const turnTimeout = turn.startedAt.getTime() + turnTimeLimit*1000 - Date.now();

    return Math.max(0, turnTimeout);
  }

  getRecentTurn(turnId) {
    const currentTurnId = this.currentTurnId;
    const recentTurns = this.recentTurns;

    if (turnId > currentTurnId)
      return null;
    else
      return recentTurns[turnId - currentTurnId + recentTurns.length - 1];
  }

  makeState(units, actions) {
    const board = new Board();
    board.setState(units, this.teams.map(t => t.clone()));
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
    if (data.state.teams)
      this._expandTeams();
    if (data.state.recentTurns)
      this._syncRecentTurns();
    this.whenReady.resolve();
    if (data.state.startedAt) {
      this._applyState();
      this.whenStarted.resolve();
      if (data.state.recentTurns)
        this.whenTurnStarted.resolve();
    }

    for (const [ eventType, listener ] of this._listeners.entries()) {
      this.on(eventType, listener);
    }
  }
  _pruneRecentTurns() {
    const recentTurns = this._data.state.recentTurns;

    while (recentTurns.length > 1)
      recentTurns.shift();
  }
  /*
   * Sync Game State
   */
  _onSync({ data:{ state, events, ...sync } }) {
    const data = this._data;

    /*
     * Sync game data
     */
    data.merge(sync);

    /*
     * Apply and communicate state changes
     */
    if (state) {
      const { teams, currentTurn, recentTurns, ...stateData } = state;

      data.state.merge(stateData);

      if (teams) {
        for (let i = 0; i < teams.length; i++)
          if (teams[i] === null)
            data.state.teams[i] = null;
          else
            data.state.teams[i] = data.state.teams[i] ? data.state.teams[i].merge(teams[i]) : new Team(teams[i]);
      }

      if (currentTurn) {
        if (currentTurn.nextActionId !== undefined) {
          data.state.recentTurns.last.nextActionId = currentTurn.nextActionId;
          this._applyState();
        }

        if (currentTurn.timeLimit !== undefined)
          data.state.recentTurns.last.timeLimit = currentTurn.timeLimit;

        this._emit({ type:'change' });
      } else if (recentTurns) {
        data.state.recentTurns = recentTurns;
        this._syncRecentTurns();

        this._emit({ type:'change' });
      }
    }

    if (!this.whenStarted.isFinalized && data.state.startedAt)
      this.whenStarted.resolve();
    if (!this.whenTurnStarted.isFinalized && data.state.recentTurns.length)
      this.whenTurnStarted.resolve();

    /*
     * Emit other events that modify game state
     */
    if (events)
      for (const event of events)
        this._emit(event);

    this._pruneRecentTurns();
  }
  _onStartTurn({ data }) {
    const board = this.board;
    const state = this._data.state;

    state.currentTurnId++;

    state.recentTurns.push(Turn.create({
      id: state.currentTurnId,
      team: this.teams[state.currentTurnId % this.teams.length],
      data: {
        startedAt: data.startedAt,
        units: board.getState(),
      },
      timeLimit: data.timeLimit,
    }));

    if (this.previousTurn)
      this.previousTurn.isCurrent = false;

    this.whenTurnStarted.resolve();
    this._emit({ type:'change' });
  }
  _onAction({ data:actions }) {
    const state = this._data.state;
    const board = this.board;

    for (const action of actions) {
      this.currentTurn.pushAction(action);
      board.applyAction(board.decodeAction(action));
    }

    // Emit a change so that the game state cursor can pick up on the new
    // action before it is potentially cleared in the next step.
    this._emit({ type:'change' });
  }

  _applyState() {
    const board = this.board;
    board.setState(this.units, this.teams);
    board.decodeAction(this.actions).forEach(a => board.applyAction(a));
  }
  _expandTeams() {
    this._data.state.teams = this._data.state.teams.map(teamData => {
      return teamData && new Team(teamData);
    });
  }
  _syncRecentTurns() {
    const state = this._data.state;
    const teams = this.teams;
    const recentTurns = state.recentTurns;
    const board = this.board;
    board.setState(recentTurns[0].units, teams);

    for (const [ i, turnData ] of recentTurns.entries()) {
      const turnId = state.currentTurnId - state.recentTurns.length + 1 + i;
      const team = teams[turnId % teams.length];
      if (!turnData.units)
        turnData.units = board.getState();

      board.decodeAction(turnData.actions).forEach(a => board.applyAction(a));

      recentTurns[i] = new Turn({
        id: turnId,
        team,
        data: {
          startedAt: turnData.startedAt,
          units: turnData.units,
          actions: turnData.actions,
        },
      });

      recentTurns[i].isCurrent = recentTurns[i].id === state.currentTurnId;
      recentTurns[i].isLocked = recentTurns[i].id === state.lockedTurnId;
      recentTurns[i].timeLimit = turnData.timeLimit;
    }
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
