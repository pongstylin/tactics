'use strict';

import Unit from 'tactics/Unit.js';
import colorMap from 'tactics/colorMap.js';

export default class ChaosDragon extends Unit {
  constructor(data, board) {
    super(data, board);

    this.frames.forEach((frame, i) => {
      if (!frame) return;
      let names = ['shadow', 'base', 'trim'];

      frame.c.forEach(shape => {
        if (names.length && shape.id !== 56)
          shape.n = names.shift();
      });
    });

    Object.assign(this, {
      title:  'Awakened!',
      banned: [],
    });
  }

  attack(action) {
    let anim = new Tactics.Animation({fps:10});

    // Make sure we strike the actual target (LOS can change it).
    let target = action.target;
    let target_unit = this.getTargetUnits(target)[0];
    if (target_unit)
      target = target_unit.assignment;

    anim
      .splice(this.animTurn(action.direction))
      .splice(this.animAttack(target));

    return anim.play();
  }
  getPhaseAction(attacker, result) {
    let board = this.board;
    let banned = this.banned.slice();
    if (attacker)
      banned.push(attacker.team.id);

    let teamsData = board.getWinningTeams().reverse();
    let colorId = 'White';

    if (teamsData.length > 1) {
      teamsData = teamsData.filter(teamData => !banned.includes(teamData.id));

      if (teamsData.length)
        colorId = board.teams[teamsData[0].id].colorId;
    }

    if (colorMap.get(colorId) === this.color)
      return;

    let phaseAction = {
      type:    'phase',
      unit:    this,
      colorId: colorId,
    };

    if (attacker)
      phaseAction.results = [{
        unit:   this,
        banned: banned,
      }];

    return phaseAction;
  }
  phase(action) {
    return this.animPhase(action.colorId).play();
  }
  animPhase(colorId) {
    let sounds    = $.extend({}, Tactics.sounds, this.sounds);
    let old_color = this.color;
    let new_color = colorMap.get(colorId);

    return new Tactics.Animation({frames: [
      () => sounds.phase.play(),
      {
        script: frame => {
          let step = frame.repeat_index + 1;
          let color = Tactics.utils.getColorStop(old_color, new_color, step / 12);
          this.change({ color:color });
          this.frame.children[2].tint = this.color;
        },
        repeat: 12,
      }
    ]});
  }
  animMove(assignment) {
    let board       = this.board;
    let anim        = new Tactics.Animation({fps:10});
    let sounds      = $.extend({}, Tactics.sounds, this.sounds);
    let frame_index = 0;

    anim.addFrame(() => this.assignment.dismiss());

    // Turn frames are not typically required while walking unless the very
    // next tile is in the opposite direction of where the unit is facing.
    let direction = board.getDirection(this.assignment, assignment, this.direction);
    if (direction === board.getRotation(this.direction, 180))
      anim.splice(frame_index++, () => this.drawTurn(90));

    let move = this.animations[direction].move;
    anim
      .splice(frame_index,
        new Tactics.Animation({frames: [{
          script: frame => this.drawFrame(move.s + frame.repeat_index),
          repeat: move.l,
        }]})
          .splice(10, () => this.assign(assignment))
          .splice([2,7,11,16], () => sounds.flap.play())
      );
    anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animAttack(target) {
    var anim      = new Tactics.Animation();
    let stage     = Tactics.game.stage;
    let sounds    = $.extend({}, Tactics.sounds, this.sounds);
    var tunit     = target.assigned;
    var direction = this.board.getDirection(this.assignment, target, 1);
    var attack    = this.animations[direction].attack, frame=0;
    var whiten    = [0.25, 0.5, 0];
    var source    = direction === 'N' || direction === 'E' ?  1 : 3;
    var adjust    = direction === 'N' ? {x:-5,y:0} : direction === 'W' ? {x:-5,y:3} : {x:5,y:3};
    var container = new PIXI.Container();
    var filter1   = new PIXI.filters.BlurFilter();
    var filter2   = new PIXI.filters.BlurFilter();
    var streaks1  = new PIXI.Graphics;
    var streaks2  = new PIXI.Graphics;
    var streaks3  = new PIXI.Graphics;

    //filter1.blur = 6;
    streaks1.filters = [filter1];
    container.addChild(streaks1);

    filter2.blur = 6;
    streaks2.filters = [filter2];
    container.addChild(streaks2);

    streaks3.filters = [filter2];
    container.addChild(streaks3);

    anim
      .addFrame({
        script: () => this.drawFrame(attack.s + frame++),
        repeat: attack.l,
      })
      .splice(0, () => sounds.charge.fade(0, 1, 500, sounds.charge.play()))
      .splice(5, tunit.animStagger(this))
      .splice(5, () => {
        sounds.buzz.play();
        sounds.charge.stop();
        sounds.impact.play();
      })
      .splice(5, {
        script: () => tunit.whiten(whiten.shift()),
        repeat:3
      })
      .splice(5, () => {
        this.drawStreaks(container, target,source,adjust);
        stage.addChild(container);
      })
      .splice(6, () => {
        this.drawStreaks(container, target,source,adjust);
      })
      .splice(7, () => {
        stage.removeChild(container);
        sounds.buzz.stop();
      });

    return anim;
  }
  drawStreaks(container,target,source,adjust) {
    let stage = Tactics.game.stage;

    // Make sure bounds are set correctly.
    stage.children[1].updateTransform();

    let sprite = this.frame.children[source];
    let bounds = sprite.getBounds();
    let start  = new PIXI.Point(bounds.x+adjust.x,bounds.y+adjust.y);
    let end    = target.getCenter().clone();

    start.x += Math.floor(sprite.width  / 2);
    start.y += Math.floor(sprite.height / 2);
    end.y   -= 14;

    // Determine the stops the lightning will make.
    let stops = [
      {
        x: start.x + Math.floor((end.x - start.x) * 1/3),
        y: start.y + Math.floor((end.y - start.y) * 1/3),
      },
      {
        x: start.x + Math.floor((end.x - start.x) * 2/3),
        y: start.y + Math.floor((end.y - start.y) * 2/3),
      },
      {x:end.x, y:end.y},
    ];

    let streaks1 = container.children[0];
    let streaks2 = container.children[1];
    let streaks3 = container.children[2];

    streaks1.clear();
    streaks2.clear();
    streaks3.clear();

    for (let i=0; i<3; i++) {
      let alpha     = i % 2 === 0 ? 0.5 : 1;
      let deviation = alpha === 1 ? 9 : 19;
      let midpoint  = (deviation + 1) / 2;

      streaks1.lineStyle(1, 0x8888FF, alpha);
      streaks2.lineStyle(2, 0xFFFFFF, alpha);
      streaks3.lineStyle(2, 0xFFFFFF, alpha);

      streaks1.moveTo(start.x, start.y);
      streaks2.moveTo(start.x, start.y);
      streaks3.moveTo(start.x, start.y);

      stops.forEach((stop, j) => {
        let offset;
        let x = stop.x;
        let y = stop.y;

        if (j < 2) {
          // Now add a random offset to the stops.
          offset = Math.floor(Math.random() * deviation) + 1;
          if (offset > midpoint) offset = (offset-midpoint) * -1;
          x += offset;

          offset = Math.floor(Math.random() * deviation) + 1;
          if (offset > midpoint) offset = (offset-midpoint) * -1;
          y += offset;
        }

        streaks1.lineTo(x, y);
        streaks2.lineTo(x, y);
        streaks3.lineTo(x, y);
      });
    }

    return this;
  }
  animBlock(attacker) {
    let anim      = new Tactics.Animation();
    let sounds    = $.extend({}, Tactics.sounds, this.sounds);
    let direction = this.board.getDirection(this.assignment, attacker.assignment, this.direction);
    let block     = this.animations[direction].block;

    anim
      .addFrames([
        () => this.direction = direction,
        () => sounds.block.play(),
      ])
      .splice(0, {
        script: frame => this.drawFrame(block.s + frame.repeat_index),
        repeat: block.l,
      })
      .splice(1, [
        {
          script: frame => this.shock(direction, frame.repeat_index, 1),
          repeat: 3,
        },
        () => this.shock(),
      ]);

    return anim;
  }

  /*
   * Implement ability to self-heal
   */
  canSpecial() {
    return this.mHealth < 0;
  }
  getAttackSpecialResults(action) {
    return [{
      unit: this,
      changes: {
        mHealth: Math.min(0, this.mHealth + this.power),
      },
    }];
  }
  attackSpecial(action) {
    let anim  = new Tactics.Animation();
    let block = this.animations[this.direction].block;

    anim
      .splice([
        () => this.drawFrame(block.s),
        () => this.drawFrame(block.s+1),
        () => {},
      ])
      .splice(this.animHeal([this]))
      .splice([
        () => this.drawFrame(block.s+4),
        () => this.drawFrame(block.s+5),
      ]);

    return anim.play();
  }

  /*
   * Implement ability to get angry with attacking allies.
   */
  canCounter() {
    return true;
  }
  getCounterAction(attacker, result) {
    if (attacker !== this && attacker.color === this.color)
      return this.getPhaseAction(attacker, result);
  }

  toJSON() {
    let data = super.toJSON();

    if (this.banned.length)
      data.banned = this.banned.slice();

    return data;
  }
}

// Dynamically add unit data properties to the class.
ChaosDragon.prototype.type = 'ChaosDragon';
