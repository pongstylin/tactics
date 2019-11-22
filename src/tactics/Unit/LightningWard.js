'use strict';

import Unit from 'tactics/Unit.js';

export default class LightningWard extends Unit {
  attack(action) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let attackAnim = this.animAttack();
    attackAnim.splice(5, () => sounds.attack.play());

    anim.splice(attackAnim);
    anim.splice(10, this.animLightning(action.target, action.results));

    return anim.play();
  }
}

// Dynamically add unit data properties to the class.
LightningWard.prototype.type = 'LightningWard';
