export default {
  blitz: {
    type: 'buffered',
    initial: 120,
    base: 30,
    maxBuffer: 120,
  },
  standard: {
    type: 'legacy',
    initial: 300,
    base: 120,
  },
  relaxed: {
    type: 'buffered',
    initial: 300,
    base: 120,
    maxBuffer: 300,
  },
  day: {
    type: 'fixed',
    base: 86400,
  },
  week: {
    type: 'fixed',
    base: 604800,
  },
};

/*
 * Compute the turn time limit for the provided turn.
 *
 * `this` refers to a GameState object.
 * This function is called internally to set turn.timeLimit when the current turn changes.
 * This function is called externally to obtain the time limit for a previous turn.
 *
 */
export const getTurnTimeLimit = {
  fixed: function (turn = this.currentTurn) {
    if (turn.isAutoSkipped)
      return null;

    return this.timeLimit.base;
  },
  buffered: function (turn = this.currentTurn) {
    if (turn.isAutoSkipped)
      return null;
    if (this.getTeamInitialTurnId(turn.team) === turn.id)
      return this.timeLimit.initial;

    return this.timeLimit.base + turn.get('timeBuffer', 0);
  },
  legacy: function (turn = this.currentTurn) {
    if (turn.isAutoSkipped)
      return null;
    if (this.getTeamInitialTurnId(turn.team) === turn.id)
      return this.timeLimit.initial;

    const initial = this.teams.reduce((p, t) => p * t.set.units.length, 1);
    const current = turn.units.reduce((p, us) => p * Math.max(1, us.filter(u => u.type !== 'Shrub').length), 1);
    // Ranges from 1 (full time limit) to 2 (half time limit)
    const speed = (initial * 2 - 2) / (current + initial - 2);
    return this.timeLimit.base / speed;
  },
};

/*
 * This function is called when a turn is newly pushed or popped.
 * This sets the current turn time limit.
 * Note that turn.timeLimit may be externally modified, e.g. to extend the time limit.
 *
 * `this` refers to a GameState object.
 */
export const applyTurnTimeLimit = {
  fixed: function () {
    this.currentTurn.timeLimit = getTurnTimeLimit.fixed.call(this);
  },
  buffered: function (op) {
    const timeLimit = this.timeLimit;
    const currentTurn = this.currentTurn;

    /*
     * Determine the turn time buffer for the new turn based on the team's previous playable turn, if any.
     */
    // Buffer already set, as needed, for popped turns.
    // No buffer if turn isn't playable (auto passed)
    if (op === 'pushed' && currentTurn.isPlayable) {
      const initialTurnId = this.getTeamInitialTurnId(currentTurn.team);
      const previousTurnId = this.getTeamPreviousPlayableTurnId(currentTurn.team);
      const previousTurn = this.turns[previousTurnId];

      // No buffer if this or previous team's turn is the initial turn.
      // No buffer if previous team's turn lasted longer than base time limit.
      if (previousTurn && previousTurn.id !== initialTurnId && previousTurn.duration < timeLimit.base) {
        currentTurn.set('timeBuffer', Math.min(
          timeLimit.maxBuffer,
          previousTurn.get('timeBuffer', 0) + Math.max(0, (timeLimit.base / 2) - previousTurn.timeElapsed),
        ));
      }
    }

    currentTurn.timeLimit = getTurnTimeLimit.buffered.call(this);
  },
  legacy: function () {
    this.currentTurn.timeLimit = getTurnTimeLimit.legacy.call(this);
  },
};
