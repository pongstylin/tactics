import Unit from '#tactics/Unit.js';

export default class Berserker extends Unit {
  /*
   * Apply stun effect on a unit that is successfully hit.
   */
  getAttackResult(action, unit, cUnit) {
    let result = super.getAttackResult(action, unit, cUnit);

    if (!result.miss) {
      if (this.team !== result.unit.team) {
        result.changes.mRecovery = result.unit.mRecovery + 1;
      } else {
        // If the berserker attacks an ally, increase wait by 2 to account for wait decrement at end of turn.
        result.changes.mRecovery = result.unit.mRecovery + 2;
      }
    }
    return result;
  }
}
