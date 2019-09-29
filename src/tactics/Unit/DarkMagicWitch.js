'use strict';

import Unit from 'tactics/Unit.js';

export default class DarkMagicWitch extends Unit {
  getTargetTiles(target) {
    let direction = this.board.getDirection(this.assignment, target);
    let targets = [];

    let context = this.assignment;
    while (targets.length < 4) {
      context = context[direction];
      if (!context) break;

      targets.push(context);
    }

    return targets;
  }
  attack(action) {
    let sounds    = Object.assign({}, Tactics.sounds, this.sounds);
    let targets   = this.getTargetTiles(action.target);
    let first     = targets[0];
    let anim      = new Tactics.Animation();
    let darkness  = [-0.3, -0.4, -0.5, -0.3, -0.2, 0];

    let attackAnim = this.animAttack(action.direction);
    attackAnim.splice(0, () => sounds.attack1.play());
    attackAnim.splice(3, () => sounds.attack2.play());

    targets.forEach(target => {
      attackAnim.splice(4, this.animBlackSpike(target, first));

      let target_unit = target.assigned;
      if (target_unit) {
        attackAnim.splice(6, target_unit.animStagger(this));
        attackAnim.splice(6, {
          script: frame => target_unit.colorize(0xFFFFFF, darkness[frame.repeat_index]),
          repeat: darkness.length,
        });
      }
    });

    anim.splice(this.animTurn(action.direction));
    anim.splice(attackAnim);

    return anim.play();
  }
  animBlock(attacker) {
    let anim      = new Tactics.Animation();
    let sounds    = Object.assign({}, Tactics.sounds, this.sounds);
    let direction = this.board.getDirection(this.assignment, attacker.assignment, this.direction);

    anim.addFrame(() => {
      sounds.block2.play();
      this.direction = direction;
    });
    anim.addFrame(() => sounds.block1.play('block'));

    let indexes = [];
    for (let index = this.blocks[direction][0]; index <= this.blocks[direction][1]; index++) {
      indexes.push(index);
    }
    indexes.forEach((index, i) => anim.splice(i, () => this.drawFrame(index)));

    // Kinda hacky.  It seems that shocks should be rendered by the attacker, not defender.
    if (attacker.type === 'Scout')
      anim.splice(1, [
        () => this.shock(direction, 1, true),
        () => this.shock(direction, 2, true),
        () => this.shock(),
      ]);
    else
      anim.splice(1, [
        () => this.shock(direction, 0, true),
        () => this.shock(direction, 1, true),
        () => this.shock(direction, 2, true),
        () => this.shock(),
      ]);

    anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animBlackSpike(target, first) {
    let anim = new Tactics.Animation();
    let parent = Tactics.game.stage.children[1];

    let pos = target.getCenter();
    let container = new PIXI.Container();
    container.position = new PIXI.Point(pos.x, pos.y);

    anim.addFrame(() => parent.addChild(container));

    let frames;
    if (target === first)
      frames = this._effects.black_spike;
    else
      frames = this.effects.black_spike.frames.map(frame => this.compileFrame(frame, this.effects.black_spike));

    let index = 0;
    frames.forEach(frame => {
      anim.splice(index, [
        () => container.addChild(frame),
        () => container.removeChild(frame),
      ]);

      index++;
    });

    anim.splice(anim.frames.length-1, () => parent.removeChild(container));

    return anim;
  }
}

// Dynamically add unit data properties to the class.
DarkMagicWitch.prototype.type = 'DarkMagicWitch';
