import Unit from '#tactics/Unit.js';

export default class Enchantress extends Unit {
  getAttackResult(action, unit) {
    return {
      unit,
      changes: {
        paralyzed: [...(unit.paralyzed || []), this],
      },
      results: [{
        unit: this,
        changes: {
          focusing: [...(this.focusing || []), unit],
        },
      }],
    };
  }
  getBreakFocusResult(flatten = false) {
    let result = {
      unit: this,
      changes: { focusing:false },
    };
    let subResults = this.focusing.map(tUnit => ({
      unit: tUnit,
      changes: {
        paralyzed: tUnit.paralyzed.length === 1
          ? false
          : tUnit.paralyzed.filter(t => t !== this),
      },
    }));

    if (flatten)
      return [result, ...subResults];
    else
      return {...result, results:subResults};
  }
}
