import Unit from 'tactics/Unit.js';

export default class Berserker extends Unit {
  /*
   * Apply stun effect on a unit that is successfully hit.
   */
  getAttackResult(action, unit) {
    let result = super.getAttackResult(action, unit);

    if (!result.miss)
      result.changes.mRecovery = result.unit.mRecovery + 1;

    return result;
  }
}

// Dynamically add unit data properties to the class.
Berserker.prototype.type = 'Berserker';
