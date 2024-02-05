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

const isInitialTurn = (game, turnData) => turnData.id === game.getTeamFirstTurnId(game.teams[turnData.teamId]);
const isAutoPassedTurn = turnData => turnData.actions.length === 1 && turnData.actions.last.forced;

/*
 * Compute the turn time limit for the provided turnId.
 *
 * `this` refers to a GameState object.
 * This function is called internally to set game.timeLimit.current when the current turn changes.
 * This function is called externally to obtain the time limit for a previous turn.
 *
 * Note that game.timeLimit.current may be externally modified, e.g. to extend the time limit.
 */
export const getTurnTimeLimit = {
  fixed: function (turnId) {
    return this.timeLimit.base;
  },
  buffered: function (turnId) {
    const turnData = this.getTurnData(turnId, false);
    if (isAutoPassedTurn(turnData))
      return null;
    if (isInitialTurn(this, turnData))
      return this.timeLimit.initial;

    const buffer = turnId === this.currentTurnId ? this.timeLimit.buffers[turnData.teamId] : this.turns[turnId].timeBuffer;
    return this.timeLimit.base + buffer;
  },
  legacy: function (turnId) {
    const turnData = this.getTurnData(turnId, false);
    if (isAutoPassedTurn(turnData))
      return null;
    if (isInitialTurn(this, turnData))
      return this.timeLimit.initial;

    const initial = this.teams.reduce((p, t) => p * t.set.units.length, 1);
    const current = turnData.units.reduce((p, us) => p * Math.max(1, us.filter(u => u.type !== 'Shrub').length), 1);
    // Ranges from 1 (full time limit) to 2 (half time limit)
    const speed = (initial * 2 - 2) / (current + initial - 2);
    return this.timeLimit.base / speed;
  },
};

/*
 * This function is called when a turn is newly pushed or popped.
 * When popped, turnData is the turn that was popped (is current turn).
 * When pushed, turnData is the turn that was pushed (was previous turn).
 * `this` refers to a GameState object.
 */
export const applyTurnTimeLimit = {
  fixed: function () {
    this.timeLimit.current = getTurnTimeLimit.fixed.call(this, this.currentTurnId);
  },
  buffered: function (op, turnData) {
    const turns = this.turns;
    const timeLimit = this.timeLimit;
    const numTeams = this.teams.length;
    const buffers = timeLimit.buffers ??= new Array(numTeams).fill(0);

    if (op === 'popped') {
      const currentTeamId = this.currentTeamId;

      buffers[currentTeamId] = this.turns[turnData.id].timeBuffer ?? 0;

      /*
       * Sync up other teams' turn time buffers just in case more than one turn
       * was popped.
       */
      const currentTurnId = this.currentTurnId;
      for (let tId = Math.max(0, currentTurnId - numTeams + 1); tId < currentTurnId; tId++)
        buffers[tId % numTeams] = turns[tId].timeBuffer ?? 0;
    } else {
      const previousTeamId = this.previousTeamId;

      // Remember the timeBuffer for the turn just in case we go back to it.
      turnData.timeBuffer = buffers[previousTeamId];

      // Adjust the buffer for the previous team for their next turn, if necessary.
      if (!isAutoPassedTurn(turnData) && !isInitialTurn(this, turnData)) {
        const turnStartedAt = turnData.startedAt;
        const turnEndedAt = turnData.actions.last.createdAt;
        const elapsed = Math.floor((turnEndedAt - turnStartedAt) / 1000);
        if (elapsed > timeLimit.base)
          buffers[previousTeamId] = 0;
        else
          buffers[previousTeamId] = Math.min(
            timeLimit.maxBuffer,
            buffers[previousTeamId] + Math.max(0, (timeLimit.base / 2) - elapsed),
          );
      }
    }

    this.timeLimit.current = getTurnTimeLimit.buffered.call(this, this.currentTurnId);
  },
  legacy: function () {
    this.timeLimit.current = getTurnTimeLimit.legacy.call(this, this.currentTurnId);
  },
};
