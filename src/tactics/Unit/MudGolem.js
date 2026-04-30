import Unit from '#tactics/Unit.js';

export default class MudGolem extends Unit {
  canSpecial() {
    // Can't use quake if there is more than one Mud Golem
    const unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return true;
  }
  getSpecialTargetTiles(source = this.assignment) {
    const board   = this.board;
    const targets = board.getTileRange(source, 1, 3);

    // Quake closer tiles before further tiles.
    targets.sort((a, b) =>
      board.getDistance(this.assignment, a) - board.getDistance(this.assignment, b)
    );

    return targets;
  }
  getSpecialTargetNotice(targetUnit, target, source = this.assignment) {
    if (targetUnit === this)
      return 'Quake!';

    return this.getAttackTargetNotice(targetUnit, source, target, this.getAttackSpecialStats(targetUnit));
  }
  animAttackSpecial(action) {
    let anim = this.renderAnimation('attackSpecial', action.direction);
    let spriteAction = this._sprite.getAction('attackSpecial');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    for (let result of action.results) {
      let target = result.unit.assignment;

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(effectOffset,
        this.animAttackEffect({ silent:true }, target, result?.miss)
      );
    }

    return anim;
  }
  getAttackSpecialStats(targetUnit) {
    const board = this.board;
    return {
      power: this.power - board.getDistance(this.assignment, targetUnit.assignment) * 5,
      aType: 'ground',
      aLOS: this.aLOS,
      aPierce: false,
    };
  }
}

// Dynamically add unit data properties to the class.
MudGolem.prototype.type = 'MudGolem';
