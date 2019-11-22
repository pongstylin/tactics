'use strict';

import Unit from 'tactics/Unit.js';

export default class Cleric extends Unit {
  getAttackTiles() {
    return this.getTargetUnits().map(u => u.assignment);
  }
  getTargetTiles() {
    return this.getAttackTiles();
  }
  getTargetUnits() {
    return this.team.units.filter(u => u.mHealth < 0);
  }
  attack(action) {
    let anim         = new Tactics.Animation();
    let target_units = this.getTargetUnits(action.target);

    let attackAnim = this.animAttack(action.direction);
    attackAnim.splice(2, this.animHeal(target_units));

    anim.splice(this.animTurn(action.direction));
    anim.splice(attackAnim);

    return anim.play();
  }
  getAttackResults(action) {
    let results = super.getAttackResults(action);

    results.sort((a, b) =>
      a.unit.assignment.y - b.unit.assignment.y ||
      a.unit.assignment.x - b.unit.assignment.x
    );

    return results;
  }
}

// Dynamically add unit data properties to the class.
Cleric.prototype.type = 'Cleric';
