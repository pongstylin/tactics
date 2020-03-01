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
  /*
   * Customized to show effect on all units, not just healed units.
   */
  animAttack(action) {
    let anim         = this.renderAnimation('attack', action.direction);
    let spriteAction = this._sprite.getAction('attack');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let targets = this.team.units.map(u => u.assignment);

    targets.forEach(target => {
      let isHit = !target.assigned.barriered;

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(
        effectOffset,
        this.animAttackEffect(spriteAction.effect, target, isHit),
      );
    });

    return anim;
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
