import Unit from 'tactics/Unit.js';

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
    let result = {
      unit: this,
      changes: { focusing:false },
    };
    let subResults = this.focusing.map(tUnit => ({
      unit: tUnit,
      changes: {
        barriered: tUnit.barriered.length === 1
          ? false
          : tUnit.barriered.filter(t => t !== this),
      },
    }));

    if (flatten)
      return [result, ...subResults];
    else
      return {...result, results:subResults};
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

// Dynamically add unit data properties to the class.
BarrierWard.prototype.type = 'BarrierWard';
