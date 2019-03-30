'use strict';

import Unit from 'tactics/Unit.js';

export default class Scout extends Unit {
  attack(action) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let attackAnim = this.animAttack(action.direction);
    attackAnim.splice(4, () => sounds.attack.play());

    // Zero or one result expected.
    action.results.forEach(result => {
      let unit = result.unit;

      // Simulate how long it takes for the arrow to travel.
      let index = 9 + Math.ceil(
        this.board.getDistance(this.assignment, unit.assignment) / 2,
      );

      // Animate the target unit's reaction.
      if (result.miss === 'blocked')
        attackAnim
          .splice(index, unit.animBlock(this));
      else
        attackAnim
          .splice(index, this.animStrike(unit))
          .splice(index+1, unit.animStagger(this));
    });

    anim.splice(this.animTurn(action.direction));
    anim.splice(attackAnim);

    return anim.play();
  }
}

// Dynamically add unit data properties to the class.
Scout.prototype.type = Scout.name;
