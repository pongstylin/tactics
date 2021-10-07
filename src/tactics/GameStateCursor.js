import EventEmitter from 'events';

/*
 * A game state cursor points to a specific turn and action.
 * The cursor also provides turn data relevant to its position.
 */
export default class GameStateCursor {
  constructor(state) {
    Object.assign(this, {
      state,

      _emitter: new EventEmitter(),
    });

    this.setToCurrent();
  }

  get thisAction() {
    if (this.nextActionId === 0)
      return null;

    return this.actions[this.nextActionId-1];
  }
  get nextAction() {
    return this.actions[this.nextActionId];
  }

  get atStart() {
    return this.turnId === 0 && this.nextActionId === 0;
  }
  get atCurrent() {
    return this.equals(this.state.cursor);
  }

  equals(cursorData) {
    // At current turn?
    if (this.turnId !== cursorData.turnId)
      return false;

    // At current turn start time?
    if (+this.started !== +cursorData.started)
      return false;

    // At current action?
    if (this.nextActionId !== cursorData.nextActionId)
      return false;

    // At current action create time?
    const actionId = this.nextActionId;
    if (actionId && +this.actions[actionId].created !== +cursorData.actions[actionId].created)
      return false;

    // At game end?
    if (this.atEnd === cursorData.atEnd)
      return false;

    return true;
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  /*
   * Append any additional actions to the current turn
   */
  sync() {
    const current = this.state.cursor;
    if (current.turnId !== this.turnId)
      return;
    if (current.nextActionId <= this.nextActionId)
      return;
    if (+current.started !== +this.started)
      return;

    for (let i = 0; i < this.nextActionId; i++) {
      const stateAction = current.actions[i];
      const thisAction = this.actions[i];

      if (+stateAction.created !== +thisAction.created)
        return;
    }

    this.actions = current.actions;
  }
  setToCurrent() {
    if (this.atCurrent) return;

    Object.assign(this, this.state.cursor);
    this._emit({ type:'change' });
  }

  async set(turnId = this.turnId, nextActionId = 0, skipPassedTurns = false) {
    const cursorData = await this._getCursorData(turnId, nextActionId, skipPassedTurns);
    const hasChanged = !this.equals(cursorData);

    // Assign even if cursor hasn't changed since actions may have changed.
    Object.assign(this, cursorData);
    if (hasChanged)
      this._emit({ type:'change' });
  }
  setRelative(numTurns) {
    return this.set(this.turnId + numTurns);
  }
  setRelativeToCurrent(numTurns) {
    return this.set(this.state.currentTurnId + numTurns);
  }
  /*
   * Set the cursor to the next action toward the current game cursor.
   * This might be a step 'back' if a revert has taken place.
   * This might be a step 'forward' if new actions/turns are available.
   *
   * Returns null if the cursor matches the game cursor or if the only
   * change in cursor was to a new turn (and possibly game end).
   */
  async setNextAction() {
    const current = this.state.cursor;

    /*
     * Is the next step forward a step back to a previous turn?
     */
    if (this.turnId > current.turnId) {
      this.setToCurrent();
      return 'back';
    } else if (this.turnId === current.turnId && +this.started !== +current.started) {
      await this.setRelativeToCurrent(-1);
      return 'back';
    }

    // Getting cursor data also ensures we have all available actions.
    const cursorData = await this._getCursorData(this.turnId);

    /*
     * Is the next step forward a step back to a previous action?
     */
    let actionId = 0;

    for (; actionId < this.nextActionId; actionId++) {
      const thisAction = this.actions[actionId];
      const thatAction = cursorData.actions[actionId];
      if (!thatAction || +thatAction.created !== +thisAction.created)
        break;
    }

    if (actionId < this.nextActionId) {
      cursorData.nextActionId = actionId;
      Object.assign(this, cursorData);
      this._emit({ type:'change' });

      return 'back';
    }

    /*
     * Is there another action to which we can step forward?
     */
    if (cursorData.actions.length > actionId) {
      cursorData.nextActionId = actionId + 1;
      Object.assign(this, cursorData);
      this._emit({ type:'change' });

      return 'forward';
    }

    /*
     * Is there another turn to which we can step forward?
     */
    if (this.turnId < current.turnId) {
      // Pass nextActionId=1 to step to the first action in the next turn if any
      await this.set(this.turnId + 1, 1);

      // Was there a first action in the next turn?
      if (this.nextActionId)
        return 'forward';
    }

    return null;
  }

  /*
   * Pains are taken to request as little data as possible.
   */
  async _getCursorData(turnId, nextActionId, skipPassedTurns = false, skipTurnData) {
    const state = this.state;
    const stateTurnId = state.currentTurnId;
    let turnData;

    if (turnId < 0) {
      turnId = Math.max(0, this.state.currentTurnId + turnId + 1);
    } else if (turnId > this.state.currentTurnId) {
      turnId = this.state.currentTurnId;
      nextActionId = -1;
    }

    // Data for the current turn is already available.
    if (turnId === stateTurnId) {
      turnData = state.currentTurnData;
    // Data for the cursor is already available
    // ... but the actions are refreshed if incomplete.
    } else if (turnId === this.turnId) {
      turnData = {
        id: this.turnId,
        teamId: this.teamId,
        started: this.started,
        units: this.units,
        actions: this.actions,
      };

      if (turnId < stateTurnId) {
        const lastAction = turnData.actions.last;
        if (!lastAction || lastAction.type !== 'endTurn')
          // Refresh the actions because the actions aren't complete
          turnData.actions = await state.getTurnActions(turnId);
        else if (turnId === (stateTurnId - 1) && +lastAction.created !== +state.turnStarted)
          // Refresh the actions because a revert has taken place.
          turnData.actions = await state.getTurnActions(turnId);
      }
    // Only actions are needed for the next turn.
    // ... unless the current turn actions are incomplete.
    } else if (turnId === (this.turnId + 1)) {
      const lastAction = this.actions.last;
      if (lastAction && lastAction.type === 'endTurn')
        turnData = {
          id: turnId,
          teamId: (state.currentTeamId + 1) % state.teams.length,
          started: lastAction.created,
          units: state.applyActions(this.units, this.actions),
          actions: await state.getTurnActions(turnId),
        };
      else
        turnData = await state.getTurnData(turnId);
    } else if (skipTurnData) {
      turnData = {
        id: turnId,
        teamId: (skipTurnData.teamId + 1) % state.teams.length,
        started: skipTurnData.actions.last.created,
        units: state.applyActions(skipTurnData.units, skipTurnData.actions),
        actions: await state.getTurnActions(turnId),
      };
    } else
      turnData = await state.getTurnData(turnId);

    if (skipPassedTurns && turnData.actions.length === 1) {
      const action = turnData.actions[0];
      if (action.type === 'endTurn') {
        if (skipPassedTurns === 'back' && turnData.id > 0)
          return this._getCursorData(turnData.id - 1, nextActionId, skipPassedTurns);
        else if (skipPassedTurns === 'forward' && turnData.id < state.currentTurnId)
          return this._getCursorData(turnData.id + 1, nextActionId, skipPassedTurns, turnData);
      }
    }

    if (nextActionId < 0)
      nextActionId = Math.max(0, turnData.actions.length + nextActionId + 1);
    else
      nextActionId = Math.min(turnData.actions.length, nextActionId || 0);

    const atEnd = (
      turnData.id === state.currentTurnId &&
      nextActionId === state.actions.length &&
      state.ended
    );

    return {
      turnId: turnData.id,
      teamId: turnData.teamId,
      started: turnData.started,
      units: turnData.units,
      actions: turnData.actions,
      nextActionId,
      atEnd,
    };
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
