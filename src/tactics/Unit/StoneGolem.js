import Unit from 'tactics/Unit.js';

export default class StoneGolem extends Unit {
  getTargetUnits(target) {
    let targetUnits = super.getTargetUnits(target);

    return targetUnits.sort((a, b) => {
      if (a === this) return -1;
      if (b === this) return 1;
      return 0;
    });
  }
  getAttackResult(action, unit) {
    return {
      unit,
      changes: {
        mArmor: unit.mArmor + 30,
        armored: [...(unit.armored || []), this],
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
        mArmor: tUnit.mArmor - 30,
        armored: tUnit.armored.length === 1
          ? false
          : tUnit.armored.filter(t => t !== this),
      },
    }));

    if (flatten)
      return [result, ...subResults];
    else
      return {...result, results:subResults};
  }
}

// Dynamically add unit data properties to the class.
StoneGolem.prototype.type = 'StoneGolem';
