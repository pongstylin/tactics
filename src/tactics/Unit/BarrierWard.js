import Unit from '#tactics/Unit.js';

export default class BarrierWard extends Unit {
  getAttackResult(action, unit) {
    return {
      unit,
      changes: {
        barriered: [...(unit.barriered || []), this],
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
          barriered: tUnit.barriered.length === 1
            ? false
            : tUnit.barriered.filter(t => t !== this),
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
  focus(view_only) {
    super.focus(view_only);

    let focusing = this.focusing && this.focusing[0];
    if (focusing)
      focusing.activateBarrier();

    return this;
  }
  blur() {
    super.blur();

    let focusing = this.focusing && this.focusing[0];
    if (focusing && !this.activated)
      focusing.deactivateBarrier();

    return this;
  }
  activate(mode, view_only) {
    super.activate(mode, view_only);

    let focusing = this.focusing && this.focusing[0];
    if (focusing)
      focusing.activateBarrier();

    return this;
  }
  deactivate() {
    super.deactivate();

    let focusing = this.focusing && this.focusing[0];
    if (focusing)
      focusing.deactivateBarrier();

    return this;
  }
}
