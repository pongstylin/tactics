import Unit from '#tactics/Unit.js';

export default class MudGolem extends Unit {
  canSpecial() {
    // Can't use quake if there is more than one Mud Golem
    let unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return true;
  }
  setSpecialTargetNotice(targetUnit) {
    if (targetUnit === this)
      return targetUnit.change({ notice:'Quake!' });
    const distance = this.board.getDistance(this.assignment, targetUnit.assignment);

    return this.setTargetNotice(targetUnit, this.assignment, {
      power: this.power - distance * 5,
      aType: 'magic',
      aLOS: false,
    });
  }
  getSpecialTargetTiles(target, source = this.assignment) {
    return this.board.getTileRange(source, 1, 3);
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
    let targets = this.getSpecialTargetTiles().filter(t => !!t.assigned);
    let cUnits = new Map();

    // Sort targets by distance
    targets.sort((a, b) => {
      let distanceA = board.getDistance(this.assignment, a);
      let distanceB = board.getDistance(this.assignment, b);

      return distanceA - distanceB;
    })

    board.teamsUnits.flat().forEach(unit => cUnits.set(unit.id, unit.clone()));

    return targets.map(target => {
      let targetUnit = target.assigned;
      let cUnit = cUnits.get(targetUnit.id);
      let result = { unit:targetUnit };

      if (cUnit.barriered || cUnit.disposition === 'unbreakable' || cUnit.type === 'PoisonWisp')
        result.miss = 'immune';
      else {
        let distance = board.getDistance(this.assignment, target);
        let power = this.power - distance * 5;
        let armor = Math.max(0, Math.min(100, cUnit.armor + cUnit.mArmor));
        let damage = Math.round(power * (100 - armor) / 100);

        result.damage = damage;
        result.changes = {
          mHealth: Math.max(-cUnit.health, cUnit.mHealth - damage),
        };
      }

      board.applyActionResults([ result ]);
      this.getAttackSubResults(result);
      // Reapply the result since getDeadResult can modify it.
      board.applyActionResults([ result ]);
      return result;
    });
  }
}

// Dynamically add unit data properties to the class.
MudGolem.prototype.type = 'MudGolem';
