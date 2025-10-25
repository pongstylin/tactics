import Unit from '#tactics/Unit.js';
import { unitDataMap } from '#tactics/unitData.js';
import { colorFilterMap } from '#tactics/colorMap.js';

export default class ChaosSeed extends Unit {
  constructor(data, board) {
    super(data, board);

    Object.assign(this, {
      title: '...sleeps...',
    });
  }

  draw(skipPosition = false) {
    Tactics.makeCanvasSourceFromURL('https://legacy.taorankings.com/images/death.png').then(src => {
      this._deathAnimation = [
        [
          {src,pos:{x: 0  ,y:-16  },scale:{x:1.416,y:1.5  },alpha:0.5 }
        ],
        [
          {src,pos:{x: 0  ,y:-28  },scale:{x:1.167,y:2.166},alpha:0.69},
          {src,pos:{x:-1  ,y:-18  },scale:{x:1.418,y:1.583},alpha:0.5 }
        ],
        [
          {src,pos:{x:-0.5,y:-41  },scale:{x:0.956,y:2.833},alpha:0.35},
          {src,pos:{x:-2  ,y:-27.5},scale:{x:1.251,y:2.126},alpha:0.69},
          {src,pos:{x: 2  ,y:-18  },scale:{x:0.917,y:1.5  },alpha:0.5 }
        ],
        [
          {src,pos:{x: 0.5,y:-21  },scale:{x:1.123,y:1.417},alpha:0.5 },
          {src,pos:{x:-2  ,y:-38  },scale:{x:1.084,y:2.668},alpha:0.35},
          {src,pos:{x: 2  ,y:-32  },scale:{x:0.750,y:2.417},alpha:0.69}
        ],
        [
          {src,pos:{x:-0.8,y:-31.7},scale:{x:0.978,y:1.938},alpha:0.69},
          {src,pos:{x: 1  ,y:-24  },scale:{x:0.999,y:1.417},alpha:0.5 },
          {src,pos:{x: 2  ,y:-46.5},scale:{x:0.584,y:3.291},alpha:0.35}
        ],
        [
          {src,pos:{x:-2  ,y:-43.5},scale:{x:0.832,y:2.459},alpha:0.35},
          {src,pos:{x: 0  ,y:-36.5},scale:{x:1    ,y:1.958},alpha:0.69},
          {src,pos:{x: 1  ,y:-27  },scale:{x:0.998,y:1.5  },alpha:0.5 }
        ],
        [
          {src,pos:{x:-0.5,y:-48.5},scale:{x:0.958,y:2.458},alpha:0.35},
          {src,pos:{x: 0  ,y:-38.5},scale:{x:0.915,y:2.126},alpha:0.69}
        ],
        [
          {src,pos:{x:-0.5,y:-50  },scale:{x:0.791,y:2.752},alpha:0.35}
        ],
      ];
    });

    return super.draw(skipPosition);
  }

  drawStand(direction) {
    super.drawStand(direction);

    let shadow = this.getContainerByName('shadow');
    let unit = this.getContainerByName('unit');
    let trim = this.getContainerByName('trim');

    // Remove darkening of the trim
    trim.children[0].children[0].children[0].filters = null;

    // Lower the egg to the ground
    let factor = 11;
    unit.position.y += 1 * factor;
    shadow.scale.x += 0.01 * factor;
    shadow.scale.y += 0.01 * factor;

    return this;
  }
  getPhaseAction() {
    const board = this.board;
    const teamsData = board.getWinningTeams().reverse();
    let colorId = 'White';

    if (teamsData.length > 1)
      colorId = board.teams[teamsData[0].id].colorId;

    if (colorFilterMap.get(colorId).join() === this.color.join())
      return;

    return {
      type: 'phase',
      unit: this,
      colorId: colorId,
    };
  }
  phase(action) {
    return this.animPhase(action.colorId).play();
  }
  animPhase(colorId) {
    const old_color = this.color;
    const new_color = colorFilterMap.get(colorId);
    const trim = this.getContainerByName('trim');
    let tint;

    if (trim.filters)
      tint = trim.filters[0];
    else
      tint = (trim.filters = [new PIXI.filters.ColorMatrixFilter()])[0];

    return new Tactics.Animation({frames: [
      () => this.sounds.phase.howl.play(),
      {
        script: ({ repeat_index }) => {
          repeat_index++;

          const color = Tactics.utils.getColorFilterStop(old_color, new_color, repeat_index / 12);
          tint.matrix[0]  = color[0];
          tint.matrix[6]  = color[1];
          tint.matrix[12] = color[2];

          this.change({ color });
        },
        repeat: 12,
      }
    ]});
  }
  getCounterAction(attacker, result) {
    let board = this.board;

    if (result.miss) {
      // Blocked
      let units;
      if (attacker.color.join() === this.color.join())
        units = attacker.team.units;
      else {
        const thisColor = this.color.join();
        units = board.teamsUnits.find((units, teamId) =>
          teamId !== this.team.id && units.length && units[0].color.join() === thisColor
        );

        if (!units) return;
      }

      let targetUnits = units.filter(unit => unit.mHealth < 0);
      if (!targetUnits.length) return;

      let targetUnit = targetUnits.random();

      return {
        type: 'heal',
        unit:  this,
        target: targetUnit.assignment,
        results: [{
          unit: targetUnit,
          notice: 'Nice',
          damage: -this.power,
          changes: { mHealth:Math.min(0, targetUnit.mHealth + this.power) },
        }],
      };
    }
    else if (result.changes && 'mHealth' in result.changes) {
      if (result.changes.mHealth > -this.health) {
        // Cracked
        let units;
        if (attacker.color.join() === this.color.join()) {
          let teamsData = board.getWinningTeams()
            // Don't count the team that just attacked.
            .filter(teamData => teamData.id !== attacker.team.id);
          let choices = teamsData
            .filter(teamData => teamData.score === teamsData[0].score);

          units = board.teams[choices.random().id].units;
        }
        else
          units = attacker.team.units;

        let targetUnit = units.random();
        let power = this.power + this.mPower;
        let armor = targetUnit.armor + targetUnit.mArmor;
        let damage = Math.round(power * (1 - armor / 100));
        let mHealth = Math.max(-targetUnit.health, targetUnit.mHealth - damage);

        return {
          type: 'attack',
          unit: this,
          target: targetUnit.assignment,
          results: [{
            unit: targetUnit,
            damage,
            changes: { mHealth },
          }],
        };
      } else {
        const direction = board.getDirection(this.assignment, attacker.assignment);

        // Hatched
        return {
          type: 'transform',
          unit: this,
          target: attacker.assignment,
          results: [
            {
              unit: this,
              changes: { type:'ChaosDragon', direction },
            },
            {
              unit: attacker,
              changes: { disposition:'dead' },
            },
          ],
        };
      }
    }
  }
  attack(action) {
    let anim = new Tactics.Animation();
    let wind = this.sounds.wind.howl;
    let winds = ['wind1','wind2','wind3','wind4','wind5'].shuffle();
    let shadow = this.getContainerByName('shadow');
    let unit = this.getContainerByName('unit');

    anim
      .addFrames([
        { // 0 - 11 - Brighten and gain tint
          script: frame => {
            let step = frame.repeat_index + 1;
            this.brightness(1 + (step * 0.2));
            this.tint(Tactics.utils.getColorFilterStop([ 1, 1, 1 ], this.color, step / 12));

            let factor = 3;
            unit.position.y -= factor;
            shadow.scale.x -= 0.01 * factor;
            shadow.scale.y -= 0.01 * factor;
          },
          repeat: 12,
        },
        { // 12 - 17 - Darken and lose half the tint
          script: frame => {
            let step = 11 - frame.repeat_index;
            this.brightness(1 + (step * 0.2));
            step = 1 + frame.repeat_index;
            this.tint(Tactics.utils.getColorFilterStop(this.color, [ 1, 1, 1 ], step / 12));
          },
          repeat: 6,
        },
        { // 18 - 23 - Brighten and lose all tint
          script: frame => {
            let step = 7 + frame.repeat_index;
            this.brightness(1 + (step * 0.2), (step - 6) * 0.6);
            this.tint(Tactics.utils.getColorFilterStop(this.color, [ 1, 1, 1 ], step / 12));
          },
          repeat: 6,
        }
      ])
      // Lightning strike started 4 frames earlier (3 visible)
      .addFrames([
        { // 24 - 29 - Darken and gain half the tint
          script: frame => {
            let step = 11 - frame.repeat_index;
            this.brightness(1 + (step * 0.2), (step - 6) * 0.6);
            step = 1 + frame.repeat_index;
            this.tint(Tactics.utils.getColorFilterStop([ 1, 1, 1 ], this.color, step / 12));
          },
          repeat: 6,
        },
        { // 30 - 35 - Brighten and gain full tint
          script: frame => {
            let step = 7 + frame.repeat_index;
            this.brightness(1 + (step * 0.2));
            this.tint(Tactics.utils.getColorFilterStop([ 1, 1, 1 ], this.color, step / 12));
          },
          repeat: 6,
        },
        { // 36 - 47 - Darken and lose tint
          script: frame => {
            let step = 11 - frame.repeat_index;
            this.brightness(1 + (step * 0.2));
            step = frame.repeat_index + 1;
            this.tint(Tactics.utils.getColorFilterStop(this.color, [ 1, 1, 1 ], step / 12));

            let factor = 3;
            unit.position.y += factor;
            shadow.scale.x += 0.01 * factor;
            shadow.scale.y += 0.01 * factor;
          },
          repeat: 12,
        },
      ])
      .splice( 0, () => wind.fade(0, 0.25, 500, wind.play(winds.shift())))
      .splice( 4, () => wind.play(winds.shift()))
      .splice( 8, () => wind.play(winds.shift()))
      .splice(12, () => this.sounds.roar.howl.play('roar'))
      .splice(16, () => wind.play(winds.shift()))
      .splice(20, () => wind.fade(1, 0, 1700, wind.play(winds.shift())))
      .splice(20, this.animAttackEffect(
        { spriteId:'sprite:Lightning' },
        action.target,
        true,
      ))
      .splice(22, () => this.sounds.attack.howl.play());
    
    return anim.play();
  }
  heal(action) {
    let anim = new Tactics.Animation();

    anim
      .addFrame({
        script: frame => {
          let step = 1 + frame.repeat_index;

          this.brightness(1 + (step * 0.2));
          this.tint(Tactics.utils.getColorFilterStop([ 1, 1, 1 ], this.color, step / 12));

          if (step === 8) this.sounds.heal.howl.play();
        },
        repeat: 12,
      })
      .splice(9, this.animAttackEffect(
        { spriteId:'sprite:Sparkle', type:'heal' },
        action.target,
        true,
      ))
      .addFrame({
        script: frame => {
          let step = 11 - frame.repeat_index;

          this.brightness(1 + (step * 0.2));
          this.tint(Tactics.utils.getColorFilterStop([ 1, 1, 1 ], this.color, step / 12));
        },
        repeat: 12,
      });

    return anim.play();
  }
  /*
   * Customized to play the 'crack' sound upon getting hit.
   */
  animHit(attacker, attackType) {
    let anim = new Tactics.Animation();
    let doStagger;
    let direction;

    if (attackType === undefined)
      attackType = attacker.aType;

    if (attackType === 'melee') {
      // Melee attacks cause a stagger
      doStagger = true;

      // Melee attacks cause the victim to stagger in a particular direction
      direction = this.board.getDirection(attacker.assignment, this.assignment, this.direction);

      // Delay the crack sound
      anim.addFrame([]);
    } else if (attackType === 'magic') {
      // Magic attacks cause a stagger
      doStagger = true;

      // No impact sound for magic attacks
      anim.addFrame([]);
    }

    if (doStagger) {
      anim.addFrame(() => this.sounds.crack.howl.play());

      if (this.paralyzed)
        anim.addFrames([
          () => this.offsetFrame(0.12, direction),
          () => this.offsetFrame(-0.16, direction),
        ]);
      else
        anim.addFrames([
          () => this.drawStagger().offsetFrame(0.12, direction),
          () => this.offsetFrame(-0.16, direction),
        ]);

      anim.addFrame(() => this.drawStand());
    }

    return anim;
  }
  /*
   * Customized to play the 'block' sound.
   */
  animMiss(attacker) {
    let anim = new Tactics.Animation();

    anim.addFrame(() => this.sounds.block.howl.play());

    return anim;
  }
  animTransform(action) {
    let board       = this.board;
    let anim        = new Tactics.Animation();
    let assignment  = this.assignment;
    let direction   = board.getDirection(assignment, action.target);
    let target_unit = action.target.assigned;
    let move        = target_unit.renderAnimation('move', direction);
    let myPos       = assignment.getCenter();
    let caption;
    let dragon;
    let team        = this.team;
    let startColor  = this.color;
    let tint        = this.getContainerByName('trim').filters[0];
    let winds       = ['wind1','wind2','wind3','wind4','wind5'];

    if (direction === 'S')
      caption = {x:9};
    else if (direction === 'N')
      caption = {y:-9, x:-9};
    else if (direction === 'E')
      caption = {y:-9, x:9};
    else
      caption = {x:-9};

    anim
      .splice({ // 0
        script: ({ repeat_index }) => {
          repeat_index++;
          if (repeat_index === 1) this.sounds.phase.howl.play();
          this.whiten(repeat_index / 12);

          let color = Tactics.utils.getColorFilterStop(startColor, [ 1, 1, 1 ], repeat_index / 12);
          tint.matrix[0]  = color[0];
          tint.matrix[6]  = color[1];
          tint.matrix[12] = color[2];

          this.change({ color });
        },
        repeat: 12,
      })
      .splice({ // 12
        script: ({ repeat_index }) =>
          this.whiten((11 - repeat_index) / 12),
        repeat: 12,
      })
      .splice({ // 24
        script: ({ repeat_index }) => {
          repeat_index++;
          if (repeat_index === 1) this.sounds.phase.howl.play();
          this.alpha = 1 - repeat_index / 12;
        },
        repeat: 12,
      })
      .splice(36, () => {
        board
          .dropUnit(this)
          .addUnit({
            id:         this.id,
            type:       'ChaosDragon',
            assignment: assignment,
            direction:  direction,
          }, this.team);

        dragon = team.units[0];
        dragon.drawHatch();
      })
      .splice(36, {
        script: ({ repeat_index }) =>
          dragon.frame.alpha = 1 - (11 - repeat_index) / 12,
        repeat: 12
      })
      .splice(22, target_unit.animCaption('Ugh!',caption))
      .splice(22, target_unit.animTurn(direction, false))
      .splice(24, {
        script: ({ repeat_index }) => {
          let frameId = repeat_index % move.frames.length;
          let offset1Ratio = (frameId + 1) / move.frames.length;
          let offset2Ratio = (repeat_index + 1) / (move.frames.length * 3);

          move.frames[frameId].scripts.forEach(s => s());
          target_unit.offsetFrame(-offset2Ratio - offset1Ratio, direction, true);
        },
        repeat: move.frames.length*3,
      })
      // 48
      .splice(() => board.dropUnit(target_unit))
      // 49
      .splice({
        script: ({ repeat_index }) => {
          repeat_index++;
          if (repeat_index === 1) this.sounds.phase.howl.play();
          dragon.whiten(repeat_index / 12);
          if (repeat_index < 7) dragon.alpha = repeat_index / 6;
        },
        repeat: 12,
      })
      // 61
      .splice({
        script: ({ repeat_index }) =>
          dragon.whiten((11 - repeat_index) / 12),
        repeat: 12
      })
      // 73
      .splice({
        script: ({ repeat_index }) =>
          dragon.drawHatch(1 + repeat_index),
        repeat: 5,
      })
      // 78
      .splice({
        script: ({ repeat_index }) => {
          repeat_index++;

          let trim = dragon.getContainerByName('trim');
          let dragonTint;
          if (trim.filters)
            dragonTint = trim.filters[0];
          else
            trim.filters = [dragonTint = new PIXI.filters.ColorMatrixFilter()];

          let color = Tactics.utils.getColorFilterStop([ 1, 1, 1 ], startColor, repeat_index / 12);
          dragonTint.matrix[0]  = color[0];
          dragonTint.matrix[6]  = color[1];
          dragonTint.matrix[12] = color[2];

          dragon.change({ color });
        },
        repeat: 12,
      })
      // 90
      .splice({
        script: ({ repeat_index }) => {
          dragon.color = startColor;
          dragon.drawHatch(6 + repeat_index);
        },
        repeat: 2,
      });

    // Layer in the cloud
    for (let i = 0; i < anim.frames.length; i++) {
      if (i === 51) break;

      let po = Math.min(1, Math.max(0.05, i / anim.frames.length) + 0.05);
      let ao = 0.5;

      if (i  <  20)
        ao  = (i +  1) * 0.025;
      else if (i > 40)
        ao -= (i - 40) * 0.05;

      [1, -1].forEach(xm => {
        [1, -1].forEach(ym => {
          let x = myPos.x + Math.round(Math.random() * 44 * po) * xm;
          let y = myPos.y + Math.round(Math.random() * 28 * po) * ym + 28;

          anim.splice(i, new Tactics.Animation.fromData(
            board.unitsContainer,
            this._deathAnimation,
            {x:x, y:y, s:2, a:ao},
          ));
        });
      });
    }

    let wind = this.sounds.wind.howl;

    for (let i = 0; i < anim.frames.length; i++) {
      if (i  %   4) continue;
      if (i === 84) break;

      if (i === 0)
        anim.splice(i, () => wind.fade(0, 0.25, 500, wind.play(winds.random())));
      else if (i === 76)
        anim.splice(i, () => {
          this.sounds.roar.howl.play('roar');
          board.drawCard(dragon);
        });
      else
        anim.splice(i, () => wind.play(winds.random()));
    }

    return anim;
  }
  canCounter() {
    return true;
  }
  // Chaos Seed never dies, just hatches
  getDeadResult(attacker, result) {
    const isDead = super.getDeadResult(attacker, result);
    if (isDead)
      result.changes.disposition = 'hatch';

    return isDead;
  }
}
