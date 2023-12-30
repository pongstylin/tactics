import Unit from '#tactics/Unit.js';

export default class Scout extends Unit {
  /*
   * Vary timing of impact based on distance to target
   */
  animAttack(action) {
    let board        = this.board;
    let anim         = this.renderAnimation('attack', action.direction);
    let spriteAction = this._sprite.getAction('attack');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0] - 2;

    anim.addFrame(() => this.stand());

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let targetUnit = this.getLOSTargetUnit(action.target);
    if (targetUnit) {
      let target = targetUnit.assignment;
      let offset = effectOffset + Math.ceil(board.getDistance(this.assignment, target) / 2);
      let result = action.results.find(r => r.unit === targetUnit);
      let isHit = result && !result.miss;

      while (anim.frames.length < offset)
        anim.addFrame([]);

      anim.splice(
        offset,
        this.animAttackEffect(spriteAction.effect, target, isHit),
      );
    }

    return anim;
  }
}
