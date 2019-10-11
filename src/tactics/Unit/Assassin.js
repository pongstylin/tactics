'use strict';

import Unit from 'tactics/Unit.js';

export default class Assassin extends Unit {
  attack(action) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let attackAnim = this.animAttack(action.direction);
    attackAnim.splice(1, () => sounds.attack1.play());
    attackAnim.splice(3, () => sounds.attack2.play());

    action.results.forEach(result => {
      let unit = result.unit;

      // Animate the target unit's reaction starting with the 4th attack frame.
      if (result.miss === 'blocked')
        attackAnim
          .splice(3, unit.animBlock(this));
      else
        attackAnim
          .splice(3, this.animStrike(unit))
          .splice(4, unit.animStagger(this));
    });

    anim.splice(this.animTurn(action.direction));
    anim.splice(attackAnim)

    return anim.play();
  }

  /*
   * Special Attack Configuration
   */
  canSpecial() {
    let unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return (this.health + this.mHealth) < 5;
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
        result.miss = 'deflected';
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
  attackSpecial(action) {
    let anim   = this.animSpecial();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let targets = this.getAttackTiles();
    targets.push(this.assignment);

    anim.splice(1, () => sounds.bomb1.play());
    targets.forEach(tile => anim.splice(6, this.animExplode(tile)));
    anim.splice(9, () => sounds.bomb2.play());

    return anim.play();
  }

  /*
   * Customized so that the sound is played on the first visual frame (not 2nd).
   * Also plays a sound sprite instead of the full sound.
   */
  animBlock(attacker) {
    let anim      = new Tactics.Animation();
    let sounds    = Object.assign({}, Tactics.sounds, this.sounds);
    let direction = this.board.getDirection(this.assignment, attacker.assignment, this.direction);

    anim.addFrame(() => {
      this.direction = direction;
      sounds.block.play('block');
    });

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
  animSpecial() {
    let anim = new Tactics.Animation();
    let direction = this.direction;

    let indexes = [];
    for (let index = this.special[direction][0]; index <= this.special[direction][1]; index++) {
      indexes.push(index);
    }
    indexes.forEach(index => anim.addFrame(() => this.drawFrame(index)));

    anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animExplode(tile) {
    let anim = new Tactics.Animation();
    let parent = this.board.unitsContainer;
    let whiten = [0.60, 1, 0.80, 0.60, 0];

    let pos = tile.getCenter();
    let container = new PIXI.Container();
    container.position = new PIXI.Point(pos.x, pos.y);

    anim.addFrame(() => parent.addChild(container));

    let frames;
    if (tile === this.assignment)
      frames = this._effects.explode;
    else
      frames = this.effects.explode.frames.map(frame => this.compileFrame(frame, this.effects.explode));

    let index = 0;
    frames.forEach(frame => {
      anim.splice(index, [
        () => container.addChild(frame),
        () => container.removeChild(frame),
      ]);

      index++;
    });

    let target_unit = tile.assigned;
    if (target_unit) {
      if (target_unit !== this) {
        anim.splice(4, () => target_unit.drawTurn());
        anim.splice(5, () => target_unit.drawStand());
      }

      anim.splice(3, {
        script: () => target_unit.whiten(whiten.shift()),
        repeat: whiten.length,
      });
    }

    anim.splice(anim.frames.length-1, () => parent.removeChild(container));

    return anim;
  }
}

// Dynamically add unit data properties to the class.
Assassin.prototype.type = 'Assassin';
