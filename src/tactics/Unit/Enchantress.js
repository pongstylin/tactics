'use strict';

import Unit from 'tactics/Unit.js';

export default class Enchantress extends Unit {
  attack(action) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let attackAnim = this.animAttack(action.direction);
    attackAnim.splice(0, () => sounds.paralyze.play())

    action.results.forEach(result => {
      let unit = result.unit;

      attackAnim.splice(0, this.animStreaks(unit));
    });

    anim.splice(this.animTurn(action.direction));
    anim.splice(attackAnim);

    return anim.play();
  }
  getBreakFocusResults() {
    return [
      {
        unit: this,
        changes: {
          focusing: false,
        },
        results: [
          ...this.focusing.map(tUnit => ({
            unit: tUnit,
            changes: {
              paralyzed: tUnit.paralyzed.length === 1
                ? false
                : tUnit.paralyzed.filter(t => t !== this),
            },
          })),
        ],
      },
    ];
  }
  animStreaks(target_unit) {
    let anim = new Tactics.Animation();
    let parent = target_unit.frame.parent;
    let lightness = [0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1, 0];
    let effects = this.effects;
    let frames = effects.streaks.frames.map(frame => this.compileFrame(frame, effects.streaks));

    let index = 0;
    frames.forEach(frame => {
      anim.splice(index, [
        () => parent.addChild(frame),
        () => parent.removeChild(frame),
      ]);

      index++;
    });

    anim.splice(4, {
      script: () => target_unit.colorize(0xFFFFFF, lightness.shift()),
      repeat: lightness.length,
    });

    return anim;
  }
}

// Dynamically add unit data properties to the class.
Enchantress.prototype.type = Enchantress.name;
