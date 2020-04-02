import Unit from 'tactics/Unit.js';

export default class MudGolem extends Unit {
  canSpecial() {
    // Can't use quake if there is more than one Mud Golem
    let unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return true;
  }
  animAttackSpecial(action) {
    let anim = this.renderAnimation('attackSpecial', action.direction);
    let spriteAction = this._sprite.getAction('attackSpecial');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    for (let result of action.results) {
      let target = result.unit.assignment;
      let isHit = !result.miss;

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(effectOffset,
        this.animAttackEffect({ silent:true }, target, isHit)
      );
    }

    return anim;
  }
  getAttackSpecialResults() {
    let board = this.board;
    let targets = board.getTileRange(this.assignment, 1, 3, false);
    let results = [];

    for (let target of targets) {
      let unit = target.assigned;
      if (unit.type === 'PoisonWisp')
        continue;

      let result = { unit };

      if (unit.barriered) {
        result.miss = 'immune';
      }
      else {
        let distance = board.getDistance(this.assignment, target);
        let power = this.power - distance * 5;
        let armor = unit.armor + unit.mArmor;
        let damage = Math.max(1, Math.round(power * (1 - armor/100)));

        result.changes = {
          mHealth: Math.max(-unit.health, Math.min(0, unit.mHealth - damage)),
        };
      }

      results.push(result);
    }

    // Deaths occur last
    results.sort((a, b) => {
      let isDeadA = a.changes && a.changes.mHealth === -a.unit.health ? 1 : 0;
      let isDeadB = b.changes && b.changes.mHealth === -b.unit.health ? 1 : 0;
      let distanceA = board.getDistance(this.assignment, a.unit.assignment);
      let distanceB = board.getDistance(this.assignment, b.unit.assignment);

      return isDeadA - isDeadB || distanceA - distanceB;
    });

    this.getAttackSubResults(results);

    return results;
  }
}

// Dynamically add unit data properties to the class.
MudGolem.prototype.type = 'MudGolem';
