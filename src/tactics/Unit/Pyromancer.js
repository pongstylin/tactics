'use strict';

import Unit from 'tactics/Unit.js';

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
  attack(action) {
    let board   = this.board;
    let sounds  = Object.assign({}, Tactics.sounds, this.sounds);
    let targets = this.getTargetTiles(action.target);
    let anim    = new Tactics.Animation();

    /*
     * Animate the attack.  Blast closer tiles before further tiles.
     */
    let closest = board.getDistance(this.assignment, targets[0]);
    let attackAnim = this.animAttack(action.direction);

    attackAnim.splice(0, () => sounds.attack.play());

    targets.forEach(tile => {
      let index = 3 + (board.getDistance(this.assignment, tile) - closest);

      attackAnim.splice(index, this.animFireBlast(tile, action.target));
    });

    anim.splice(this.animTurn(action.direction));
    anim.splice(attackAnim);

    return anim.play();
  }
  animFireBlast(target, center) {
    let anim = new Tactics.Animation();
    let unitsContainer = this.board.unitsContainer;
    let lightness = [0.6, 0.8, 0.8, 0.6, 0.4, 0];

    let pos = target.getCenter();
    let container = new PIXI.Container();
    container.position = new PIXI.Point(pos.x, pos.y);

    anim.addFrame(() => unitsContainer.addChild(container));

    let frames;
    if (target === center)
      frames = this._effects.fireblast;
    else
      frames = this.effects.fireblast.frames.map(frame => this.compileFrame(frame, this.effects.fireblast));

    let index = 0;
    frames.forEach(frame => {
      anim.splice(index, [
        () => container.addChild(frame),
        () => container.removeChild(frame),
      ]);

      index++;
    });

    let target_unit = target.assigned;
    if (target_unit) {
      if (target_unit !== this)
        anim.splice(5, target_unit.animStagger(this));

      anim.splice(5, {
        script: () => target_unit.colorize(0xFF8800, lightness.shift()),
        repeat: lightness.length,
      });
    }

    anim.splice(anim.frames.length-1, () => unitsContainer.removeChild(container));

    return anim;
  }
}

// Dynamically add unit data properties to the class.
Pyromancer.prototype.type = 'Pyromancer';
