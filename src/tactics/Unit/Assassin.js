'use strict';

import Unit from 'tactics/Unit.js';

export default class Assassin extends Unit {
  /*
   * Special Attack Configuration
   */
  canSpecial() {
    let unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return (this.health + this.mHealth) < 5;
  }
  /*
   * Customized to include the assigned tile in the list of targets.
   */
  animAttackSpecial(action) {
    let anim         = this.renderAnimation('attackSpecial', action.direction);
    let spriteAction = this._sprite.getAction('attackSpecial');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let targets = this.getAttackTiles();
    targets.push(this.assignment);

    targets.forEach(target => {
      let result = action.results.find(r => r.unit === target.assigned);
      let isHit = result && !result.miss;

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(effectOffset, this.animAttackEffect(
        Object.assign({ type:'magic' }, spriteAction.effect),
        target,
        isHit,
      ));
    });

    return anim;
  }
  getAttackSpecialResults() {
    let results = [];
    let cries = ['My legs!', 'What?', 'Mommy!', 'No fair!'];
    let taunts = ['Worth it', 'Bye', '...'];

    this.getAttackTiles().forEach(tile => {
      let target_unit = tile.assigned;
      if (!target_unit) return;

      let result = {unit:target_unit};

      if (target_unit.barriered)
        result.miss = 'immune';
      else {
        result.notice  = cries.shuffle().shift();
        result.changes = { mHealth:-target_unit.health };
      }

      results.push(result);
    });

    results.push({
      unit:    this,
      notice:  taunts.shuffle()[0],
      changes: { mHealth:-this.health },
    });

    this.getAttackSubResults(results);

    return results;
  }
}

// Dynamically add unit data properties to the class.
Assassin.prototype.type = 'Assassin';
