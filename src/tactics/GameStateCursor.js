import emitter from 'utils/emitter.js';

/*
 * A game state cursor points to a specific turn and action.
 * The cursor also provides turn data relevant to its position.
 */
export default class GameStateCursor {
  constructor(state) {
    Object.assign(this, {
      state,

      turnId: null,
      teamId: null,
      startedAt: null,
      units: null, // cloned
      actions: null, // cloned
      nextActionId: null,
      atEnd: null,
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
    if (+this.startedAt !== +cursorData.startedAt)
      return false;

    // At current action?
    if (this.nextActionId !== cursorData.nextActionId)
      return false;

    // At current action create time?
    if (this.nextActionId) {
      const actionId = this.nextActionId - 1;
      if (+this.actions[actionId].createdAt !== +cursorData.actions[actionId].createdAt)
        return false;
    }

    // At game end?
    if (this.atEnd !== cursorData.atEnd)
      return false;

    return true;
  }

  /*
   * Append any additional actions to the current turn
   */
  sync() {
    const current = this.state.cursor;
    // Only sync if we're on the same turn.
    if (current.turnId !== this.turnId)
      return;
    // Only sync if the turn started at the same time.
    if (+current.startedAt !== +this.startedAt)
      return;
    // Only sync if there are more actions than before
    if (current.nextActionId <= this.nextActionId)
      return;

    // Only sync if existing actions haven't changed.
    for (let i = 0; i < this.nextActionId; i++) {
      const stateAction = current.actions[i];
      const thisAction = this.actions[i];

      if (+stateAction.createdAt !== +thisAction.createdAt)
        return;
    }

    this.actions = current.actions;
  }
  setToCurrent() {
    if (this.atCurrent) return;

    Object.assign(this, this.state.cursor);
    this._emit({ type:'change' });
  }

  async set(turnId = this.turnId, nextActionId = 0, skipAutoPassedTurns = false) {
    const cursorData = await this._getCursorData(turnId, nextActionId, skipAutoPassedTurns);
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
    } else if (this.turnId === current.turnId && +this.startedAt !== +current.startedAt) {
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
      if (!thatAction || +thatAction.createdAt !== +thisAction.createdAt)
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
  async _getCursorData(turnId, nextActionId = -1, skipAutoPassedTurns = false, skipTurnData) {
    const state = this.state;
    const stateTurnId = state.currentTurnId;
    let turnData;

    if (turnId < 0)
      turnId = Math.max(0, this.state.currentTurnId + turnId + 1);
    else if (turnId > this.state.currentTurnId)
      turnId = this.state.currentTurnId;

    // Data for the current turn is already available.
    if (turnId === stateTurnId) {
      turnData = state.currentTurn.getData();
    // Data for the cursor is already available
    // ... but the actions are refreshed if incomplete.
    } else if (turnId === this.turnId) {
      turnData = {
        id: this.turnId,
        teamId: this.teamId,
        startedAt: this.startedAt,
        units: this.units,
        actions: this.actions,
      };

      if (turnId < stateTurnId) {
        const lastAction = turnData.actions.last;
        if (!lastAction || lastAction.type !== 'endTurn')
          // Refresh the actions because the actions aren't complete
          turnData.actions = await state.getTurnActions(turnId);
        else if (turnId === (stateTurnId - 1) && +lastAction.createdAt !== +state.turnStartedAt)
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
          startedAt: lastAction.createdAt,
          units: state.makeState(this.units, this.actions),
          actions: await state.getTurnActions(turnId),
        };
      else
        turnData = await state.getTurnData(turnId);
    } else if (skipTurnData) {
      turnData = {
        id: turnId,
        teamId: (skipTurnData.teamId + 1) % state.teams.length,
        startedAt: skipTurnData.actions.last.createdAt,
        units: state.makeState(skipTurnData.units, skipTurnData.actions),
        actions: await state.getTurnActions(turnId),
      };
    } else
      turnData = await state.getTurnData(turnId);

    if (
      skipAutoPassedTurns &&
      turnData.actions.length === 1 &&
      turnData.actions[0].type === 'endTurn' &&
      turnData.actions[0].forced
    ) {
      if (skipAutoPassedTurns === 'back' && turnData.id > 0)
        return this._getCursorData(turnData.id - 1, nextActionId, skipAutoPassedTurns);
      else if (skipAutoPassedTurns === 'forward' && turnData.id < state.currentTurnId)
        return this._getCursorData(turnData.id + 1, nextActionId, skipAutoPassedTurns, turnData);
    }

    if (nextActionId < 0)
      nextActionId = Math.max(0, turnData.actions.length + nextActionId + 1);
    else
      nextActionId = Math.min(turnData.actions.length, nextActionId || 0);

    const atEnd = (
      turnData.id === state.currentTurnId &&
      nextActionId === state.actions.length &&
      !!state.endedAt
    );

    return {
      turnId: turnData.id,
      teamId: turnData.teamId,
      startedAt: turnData.startedAt,
      units: turnData.units,
      actions: turnData.actions,
      nextActionId,
      atEnd,
    };
  }
};

emitter(GameStateCursor);
