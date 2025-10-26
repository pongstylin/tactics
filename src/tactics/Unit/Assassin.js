import Unit from '#tactics/Unit.js';

export default class Assassin extends Unit {
  canSpecial() {
    // Can't use bomb if there is more than one Assassin
    const unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return (this.health + this.mHealth) < 5;
  }
  setSpecialTargetNotice(targetUnit) {
    if (targetUnit === this)
      return targetUnit.change({ notice:'Explode!' });

    return this.setTargetNotice(targetUnit, this.assignment, {
      power: 99,
      aType: 'magic',
      aLOS: false,
      aPierce: true,
    });
  }
  getTargetUnits(target) {
    return super.getTargetUnits(target).filter(t => t !== this);
  }
  getSpecialTargetTiles(target, source) {
    return this.getTargetTiles(target, source);
  }
  /*
   * Customized to include the assigned tile in the list of targets.
   */
  animAttackSpecial(action) {
    const anim         = this.renderAnimation('attackSpecial', action.direction);
    const spriteAction = this._sprite.getAction('attackSpecial');
    const effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    const targets = this.getAttackTiles();
    targets.push(this.assignment);

    targets.forEach(target => {
      const result = action.results.find(r => r.unit === target.assigned);
      const isHit = result && !result.miss;

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
    const board = this.board;
    const targets = board.getTileRange(this.assignment, 0, 1, false);
    const cUnits = new Map();

    board.teamsUnits.flat().forEach(unit => cUnits.set(unit.id, unit.clone()));

    // Show assassin result before victims.
    targets.sort((a, b) =>
      board.getDistance(this.assignment, a) - board.getDistance(this.assignment, b)
    );

    return targets.map(target => {
      const targetUnit = target.assigned;
      const cUnit = cUnits.get(targetUnit.id);
      const result = { unit:targetUnit };

      if (cUnit.barriered || cUnit.disposition === 'unbreakable')
        result.miss = 'immune';
      else {
        result.damage = 99;
        result.changes = { mHealth:-cUnit.health };
      }

      board.applyActionResults([ result ]);
      this.getAttackSubResults(result);
      // Reapply the result since getDeadResult can modify it.
      board.applyActionResults([ result ]);
      return result;
    });
  }
}
