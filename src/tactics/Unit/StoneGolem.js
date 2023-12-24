import Unit from '#tactics/Unit.js';

export default class StoneGolem extends Unit {
  getTargetTiles(target) {
    return this.board.getTileRange(target, 0, 1);
  }
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
    const result = {
      unit: this,
      changes: { focusing:false },
    };
    const subResults = [];

    for (const tUnit of this.focusing) {
      const subResult = {
        unit: tUnit,
        changes: {
          mArmor: tUnit.mArmor - 30,
          armored: tUnit.armored.length === 1
            ? false
            : tUnit.armored.filter(t => t !== this),
        },
      };

      if (tUnit === this)
        result.changes.merge(subResult.changes);
      else
        subResults.push(subResult);
    }

    if (flatten)
      return [ result, ...subResults ];
    else if (subResults.length)
      return { ...result, results:subResults };
    else
      return result;
  }
}

// Dynamically add unit data properties to the class.
StoneGolem.prototype.type = 'StoneGolem';
