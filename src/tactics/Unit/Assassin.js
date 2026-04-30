import Unit from '#tactics/Unit.js';

export default class Assassin extends Unit {
  canSpecial() {
    // Can't use bomb if there is more than one Assassin
    const unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return (this.health + this.mHealth) < 5;
  }
  getSpecialTargetTiles(source = this.assignment) {
    const board   = this.board;
    const targets = board.getTileRange(source, 0, 1, false);

    // Detonate closer tiles before further tiles.
    targets.sort((a, b) =>
      board.getDistance(this.assignment, a) - board.getDistance(this.assignment, b)
    );

    return targets;
  }
  getSpecialTargetNotice(targetUnit, target, source = this.assignment) {
    if (targetUnit === this)
      return 'Explode!';

    return this.getAttackTargetNotice(targetUnit, source, target, this.getAttackSpecialStats(targetUnit));
  }
  getAttackTargetUnits(target) {
    return super.getAttackTargetUnits(target).filter(t => t !== this);
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

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(effectOffset, this.animAttackEffect(
        Object.assign({ type:'magic' }, spriteAction.effect),
        target,
        result?.miss,
      ));
    });

    return anim;
  }
  getAttackSpecialStats(_targetUnit) {
    return {
      power: 99,
      aType: 'magic',
      aLOS: false,
      aPierce: true,
    };
  }
}
