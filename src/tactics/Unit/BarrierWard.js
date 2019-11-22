'use strict';

import Unit from 'tactics/Unit.js';

export default class BarrierWard extends Unit {
  attack(action) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let attackAnim = this.animAttack();
    attackAnim.splice(5, () => sounds.attack.play());

    anim.splice(attackAnim);

    return anim.play();
  }
  getBreakFocusResult() {
    return {
      unit: this,
      changes: {
        focusing: false,
      },
      results: [
        ...this.focusing.map(tUnit => ({
          unit: tUnit,
          changes: {
            barriered: tUnit.barriered.length === 1
              ? false
              : tUnit.barriered.filter(t => t !== this),
          },
        })),
      ],
    };
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
