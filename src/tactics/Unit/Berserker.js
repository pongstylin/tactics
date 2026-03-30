import Unit from '#tactics/Unit.js';

export default class Berserker extends Unit {
  /*
   * Apply stun effect on a unit that is successfully hit.
   */
  getAttackResult(action, unit, cUnit) {
    const result = super.getAttackResult(action, unit, cUnit);
    if (!this.features.unblockableStun && result.miss) return result;

    if (result.changes)
      result.changes.mRecovery = result.unit.mRecovery + 1;
    return result;
  }
}
