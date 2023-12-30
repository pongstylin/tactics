import Unit from '#tactics/Unit.js';

export default class Pyromancer extends Unit {
  getTargetTiles(target) {
    let board   = this.board;
    let targets = board.getTileRange(target, 0, 1);

    // Blast closer tiles before further tiles.
    targets.sort((a, b) =>
      board.getDistance(this.assignment, a) - board.getDistance(this.assignment, b)
    );

    return targets;
  }
  /*
   * Cast Fire on closer tiles before further tiles.
   */
  animAttack(action) {
    let board        = this.board;
    let anim         = this.renderAnimation('attack', action.direction);
    let spriteAction = this._sprite.getAction('attack');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    anim.addFrame(() => this.stand());

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let targets = this.getTargetTiles(action.target);
    let closest = board.getDistance(this.assignment, targets[0]);

    targets.forEach(target => {
      let offset = effectOffset + (board.getDistance(this.assignment, target) - closest);
      let result = action.results.find(r => r.unit === target.assigned);
      let isHit = result && !result.miss;

      if (anim.frames.length < offset)
        anim.addFrame({
          scripts: [],
          repeat: offset - anim.frames.length,
        });

      anim.splice(
        offset,
        this.animAttackEffect(spriteAction.effect, target, isHit),
      );
    });

    return anim;
  }
}

// Dynamically add unit data properties to the class.
Pyromancer.prototype.type = 'Pyromancer';
