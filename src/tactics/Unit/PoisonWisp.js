import Unit from '#tactics/Unit.js';

export default class PoisonWisp extends Unit {
  getAttackResult(action, unit) {
    const result = {
      unit,
      damage: this.power,
      changes: {
        poisoned: [...(unit.poisoned || []), this],
      },
      results: [{
        unit: this,
        changes: {
          focusing: [...(this.focusing || []), unit],
        },
      }],
    };

    if ((unit.health + unit.mHealth) > 1)
      result.changes.mHealth = Math.max(-unit.health + 1, unit.mHealth - this.power);

    return result;
  }
  getBreakFocusResult(flatten = false) {
    let result = {
      unit: this,
      changes: { focusing:false },
    };
    let subResults = this.focusing.map(tUnit => ({
      unit: tUnit,
      changes: {
        poisoned: tUnit.poisoned.length === 1
          ? false
          : tUnit.poisoned.filter(t => t !== this),
      },
    }));

    if (flatten)
      return [result, ...subResults];
    else
      return {...result, results:subResults};
  }
}

// Dynamically add unit data properties to the class.
PoisonWisp.prototype.type = 'PoisonWisp';
