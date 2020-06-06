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
    let state = this.state;

    if (
      this.turnId === state.currentTurnId &&
      this.nextActionId === state.actions.length
    ) {
      if (this.nextActionId) {
        let actionId = this.nextActionId - 1;
        let cursorAction = this.actions[actionId];
        let stateAction = state.actions[actionId];

        if (+cursorAction.created !== +stateAction.created)
          return false;
      }

      if (state.ended && !this.atEnd)
        return false;
    }
    else
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

  async isOutOfSync() {
    let state = this.state;

    if (this.turnId > state.currentTurnId)
      return true;

    let cursorData = await this._getCursorData(this.turnId);

    if (this.nextActionId > cursorData.actions.length)
      return true;

    let actionId = this.nextActionId;
    if (actionId--) {
      let thisAction = this.actions[actionId];
      let thatAction = cursorData.actions[actionId];

      return +thisAction.created !== +thatAction.created;
    }

    return +this.started !== +cursorData.started;
  }
  async sync() {
    let state = this.state;

    if (this.turnId > state.currentTurnId)
      return this.setToCurrent();

    let cursorData = await this._getCursorData(this.turnId);
    let actionId = 0;

    for (; actionId < this.nextActionId; actionId++) {
      let thisAction = this.actions[actionId];
      let thatAction = cursorData.actions[actionId];
      if (!thatAction || +thatAction.created !== +thisAction.created)
        break;
    }

    cursorData.nextActionId = actionId;

    Object.assign(this, cursorData);
    this._emit({ type:'change' });
  }

  setToCurrent() {
    let state = this.state;
    let cursorData = state.cursor;
    let hasChanged = cursorData.turnId !== this.turnId || cursorData.nextActionId !== this.nextActionId;

    // Assign even if cursor hasn't changed since actions may have changed.
    Object.assign(this, cursorData);

    if (hasChanged)
      this._emit({ type:'change' });
  }

  async set(turnId = this.turnId, nextActionId = 0, skipPassedTurns = false) {
    let cursorData = await this._getCursorData(turnId, nextActionId, skipPassedTurns);
    let hasChanged = cursorData.turnId !== this.turnId || cursorData.nextActionId !== this.nextActionId;

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
  async setNextAction() {
    if (await this.isOutOfSync())
      return null;

    // Make sure the cursor data is fresh
    Object.assign(this,
      await this._getCursorData(this.turnId, this.nextActionId)
    );

    let nextAction = this.nextAction;
    if (nextAction) {
      await this.set(this.turnId, this.nextActionId + 1);
      return nextAction;
    }

    if (this.turnId < this.state.currentTurnId) {
      await this.set(this.turnId + 1, 1);
      return this.thisAction;
    }

    return null;
  }

  /*
   * Pains are taken to request as little data as possible.
   */
  async _getCursorData(turnId, nextActionId, skipPassedTurns = false, skipTurnData) {
    let state = this.state;
    let stateTurnId = state.currentTurnId;
    let turnData;

    if (turnId < 0) {
      turnId = Math.max(0, this.state.currentTurnId + turnId + 1);
    }
    else if (turnId > this.state.currentTurnId) {
      turnId = this.state.currentTurnId;
      nextActionId = -1;
    }

    // Data for the current turn is already available.
    if (turnId === stateTurnId)
      turnData = state.currentTurnData;
    // Data for the cursor is already available
    // ... but the actions are refreshed if incomplete.
    else if (turnId === this.turnId) {
      turnData = {
        id: this.turnId,
        teamId: this.teamId,
        started: this.started,
        units: this.units,
        actions: this.actions,
      };

      if (turnId < stateTurnId) {
        let lastAction = turnData.actions.last;
        if (!lastAction || lastAction.type !== 'endTurn')
          turnData.actions = await state.getTurnActions(turnId);
      }
    }
    // Only actions are needed for the next turn.
    // ... unless the current turn actions are incomplete.
    else if (turnId === (this.turnId + 1)) {
      let lastAction = this.actions.last;
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
    }
    else if (skipTurnData) {
      turnData = {
        id: turnId,
        teamId: (skipTurnData.teamId + 1) % state.teams.length,
        started: skipTurnData.actions.last.created,
        units: state.applyActions(skipTurnData.units, skipTurnData.actions),
        actions: await state.getTurnActions(turnId),
      };
    }
    else
      turnData = await state.getTurnData(turnId);

    if (skipPassedTurns && turnData.actions.length === 1) {
      let action = turnData.actions[0];
      if (action.type === 'endTurn') {
        if (skipPassedTurns === 'back' && turnData.id > 0)
          return this._getCursorData(turnData.id - 1, nextActionId, skipPassedTurns);
        else if (skipPassedTurns === 'forward' && turnData.id < state.currentTurnId)
          return this._getCursorData(turnData.id + 1, nextActionId, skipPassedTurns, turnData);
      }
    }

    if (nextActionId < 0)
      nextActionId = Math.max(0, turnData.actions.length + nextActionId + 1);

    let atEnd = (
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
      nextActionId: Math.min(turnData.actions.length, nextActionId || 0),
      atEnd,
    };
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
