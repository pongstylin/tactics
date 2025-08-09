import Unit from '#tactics/Unit.js';

export default class Berserker extends Unit {
  /*
   * Apply stun effect on a unit that is successfully hit.
   */
  getAttackResult(action, unit, cUnit) {
    let result = super.getAttackResult(action, unit, cUnit);
    if (result.miss) return result;

    result.changes.mRecovery = result.unit.mRecovery + 1;
    return result;
  }
}
