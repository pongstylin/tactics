import Unit from 'tactics/Unit.js';
import { unitDataMap, unitTypeToIdMap } from 'tactics/unitData.js';
import colorMap from 'tactics/colorMap.js';

const HALF_TILE_HEIGHT = 28;

export default class ChaosSeed extends Unit {
  constructor(data, board) {
    super(data, board);

    this.title = '...sleeps...';
  }

  draw() {
    this._frames = this.frames.map(frame => this.compileFrame(frame));

    return super.draw();
  }
  drawAvatar(direction = 'S') {
    return this.compileFrame(this.frames[this.stills[direction]]);
  }
  compileFrame(frame, data = this) {
    let container = new PIXI.Container();
    container.name = 'frame';
    container.data = frame;
    if (!frame.length && !frame.c) return container;

    let shadowContainer = new PIXI.Container();
    shadowContainer.name = 'shadow';
    container.addChild(shadowContainer);

    let unitContainer = new PIXI.Container();
    unitContainer.name = 'unit';
    container.addChild(unitContainer);

    let offset;
    if (data.width && data.height) {
      offset = new PIXI.Point(
        Math.floor(-data.width / 2),
        Math.floor(-data.height + (HALF_TILE_HEIGHT*4/3)),
      );

      // Finicky
      if (data.frames_offset) {
        offset.x += data.frames_offset.x || 0;
        offset.y += data.frames_offset.y || 0;
      }
    }
    else // Legacy
      offset = new PIXI.Point(frame.x || 0, (frame.y || 0) - 2);

    container.alpha = 'a' in frame ? frame.a : 1;

    let shapes;
    if (frame.c)
      shapes = frame.c;
    else
      shapes = frame;

    let unitTypeId = unitTypeToIdMap.get(this.type);

    shapes.forEach((shape, i) => {
      /*
       * Translate short form to long form
       */
      if (!('image' in shape)) {
        if ('i' in shape) {
          shape.image = data.images[shape.i];
          delete shape.i;
        }
        else if ('id' in shape) {
          // Legacy
          shape.image = 'https://legacy.taorankings.com/units/'+unitTypeId+'/image'+shape.id+'.png';
          delete shape.id;
        }
        else {
          throw new Error('Frames without images are not supported');
        }

        if ('n' in shape) {
          if (shape.n === 's' || shape.n === 'shadow')
            shape.name = 'shadow';
          if (shape.n === 'b' || shape.n === 'base')
            shape.name = 'base';
          if (shape.n === 't' || shape.n === 'trim')
            shape.name = 'trim';
          delete shape.n;
        }
        // Legacy
        else if ('c' in frame) {
          shape.name =
            i === 0 ? 'shadow' :
            i === 1 ? 'base'   :
            i === 2 ? 'trim'   : null;
        }

        // Legacy translation
        if ('a' in shape) {
          shape.am = shape.a;
          delete shape.a;
        }

        if (!('x' in shape))
          shape.x = 0;
        if (!('y' in shape))
          shape.y = 0;
      }

      /*
       * Configure a sprite using shape data
       */
      let sprite = PIXI.Sprite.from(shape.image);
      sprite.data = shape;
      sprite.position = new PIXI.Point(shape.x + offset.x, shape.y + offset.y);
      sprite.alpha = 'am' in shape ? shape.am : 1;

      // Legacy
      if (shape.f === 'B') {
        sprite.rotation = Math.PI;
        sprite.position.x *= -1;
        sprite.position.y *= -1;
        if (shape.w) sprite.position.x += sprite.width - shape.w;
        if (shape.h) sprite.position.y += sprite.height - shape.h;
      }
      else if (shape.f === 'H') {
        if (shape.w) sprite.position.x -= (sprite.width - shape.w);
        sprite.scale.x = -1;
      }

      if ('s' in shape) {
        // Legacy
        if (data.width === undefined) {
          sprite.position.x += sprite.width - (sprite.width * shape.s);
          sprite.position.y += sprite.height - (sprite.height * shape.s);
        }
        sprite.scale = new PIXI.Point(shape.s, shape.s);
      }
      else {
        if ('sx' in shape)
          sprite.scale.x = shape.sx;
        if ('sy' in shape)
          sprite.scale.y = shape.sy;
      }

      if (shape.name === 'trim')
        sprite.tint = this.color;

      if (shape.name === 'shadow') {
        sprite.alpha = 0.5;
        sprite.inheritTint = false;
      }

      sprite.name = shape.name;

      if (shape.name === 'shadow')
        shadowContainer.addChild(sprite);
      else
        unitContainer.addChild(sprite);
    });

    return container;
  }
  drawFrame(actionName, direction) {
    let frameId;
    let context;
    if (typeof actionName === 'number') {
      frameId = actionName;
      context = direction;
    }
    else {
      if (actionName === 'stand' || actionName === 'turn' || actionName === 'stagger')
        actionName = 'stills';
      else
        throw `Unexpected action name: ${actionName}`;

      if (direction === undefined)
        direction = this.direction;
      frameId = this[actionName][direction];
    }

    let pixi = this.pixi;
    let frame = this._frames[frameId];
    let focus;

    if (this.frame) {
      focus = this.hideFocus();
      pixi.removeChild(this.frame);
    }
    if (!frame)
      return;

    pixi.addChildAt(this.frame = frame, 0);
    if (focus)
      this.showFocus(focus.alpha);

    if (context)
      pixi.position = context.getCenter().clone();

    if (frame.data) {
      // Reset Normal Appearance
      if (this.width && this.height) {
        // Reset the position after using .offsetFrame()
        frame.position.x = 0;
        frame.position.y = 0;
      }
      else { // Legacy
        frame.position.x = frame.data.x || 0;
        frame.position.y = (frame.data.y || 0) - 2;
      }

      let unitContainer = this.getContainerByName('unit');
      unitContainer.filters = Object.keys(this.filters).map(name => this.filters[name]);

      let trim = this.getContainerByName('trim');
      trim.tint = this.color;
    }

    return this;
  }
  getPhaseAction() {
    let board = this.board;
    let teamsData = board.getWinningTeams().reverse();
    let colorId = 'White';

    if (teamsData.length > 1)
      colorId = board.teams[teamsData[0].id].colorId;

    if (colorMap.get(colorId) === this.color)
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
    let old_color = this.color;
    let new_color = colorMap.get(colorId);

    return new Tactics.Animation({frames: [
      () => this.sounds.phase.play(),
      {
        script: ({ repeat_index }) => {
          repeat_index++;
          let color = Tactics.utils.getColorStop(old_color, new_color, repeat_index / 12);
          this.change({ color });

          let trim = this.getContainerByName('trim');
          trim.tint = this.color;
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
      if (attacker.color === this.color)
        units = attacker.team.units;
      else {
        units = board.teamsUnits.find((units, teamId) =>
          teamId !== this.team.id && units.length && units[0].color === this.color
        );

        if (!units) return;
      }

      let target_units = units.filter(unit => unit.mHealth < 0);
      if (!target_units.length) return;

      let target_unit = target_units.random();

      return {
        type:   'heal',
        unit:   this,
        target: target_unit.assignment,
        results: [{
          unit:    target_unit,
          notice:  'Nice',
          changes: { mHealth:Math.min(0, target_unit.mHealth + this.power) },
        }],
      };
    }
    else if (result.changes && 'mHealth' in result.changes) {
      if (result.changes.mHealth > -this.health) {
        // Cracked
        let units;
        if (attacker.color === this.color) {
          let teamsData = board.getWinningTeams()
            // Don't count the team that just attacked.
            .filter(teamData => teamData.id !== attacker.team.id);
          let choices = teamsData
            .filter(teamData => teamData.score === teamsData[0].score);

          units = board.teams[choices.random().id].units;
        }
        else
          units = attacker.team.units;

        let target_unit = units.random();
        let power       = this.power + this.mPower;
        let armor       = target_unit.armor + target_unit.mArmor;
        let mHealth     = target_unit.mHealth - Math.round(power * (1 - armor / 100));

        return {
          type:   'attack',
          unit:   this,
          target: target_unit.assignment,
          results: [{
            unit:    target_unit,
            changes: { mHealth },
          }],
        };
      }
      else {
        let direction = board.getDirection(this.assignment, attacker.assignment);

        // Hatched
        return {
          type:   'hatch',
          unit:   this,
          target: attacker.assignment,
          results: [
            {
              unit:    this,
              changes: { type:'ChaosDragon', direction },
            },
            {
              unit:    attacker,
              changes: { mHealth: -attacker.health },
            },
          ],
        };
      }
    }
  }
  attack(action) {
    let anim   = new Tactics.Animation();
    let sounds = this.sounds;
    let winds  = ['wind1','wind2','wind3','wind4','wind5'].shuffle();
    let target_unit = action.target.assigned;

    anim
      .addFrames([
        { // 0 - 12
          script: frame => {
            let step = frame.repeat_index + 1;
            this.brightness(1 + (step * 0.2));
            this.frame.tint = Tactics.utils.getColorStop(0xFFFFFF, this.color, step / 12);

            // Shadow
            this.frame.children[0].scale.x     = 1 - (step * 0.025);
            this.frame.children[0].scale.y     = 1 - (step * 0.025);
            this.frame.children[0].position.x += 0.3;
            this.frame.children[0].position.y += 0.2;

            // Unit
            this.frame.children[1].position.y -= 3;
          },
          repeat: 12,
        },
        { // 12 - 18
          script: frame => {
            let step = 11 - frame.repeat_index;
            this.brightness(1 + (step * 0.2));
          },
          repeat: 6,
        },
        { // 18 - 24
          script: frame => {
            let step = 7 + frame.repeat_index;
            this.brightness(1 + (step * 0.2), (step - 6) * 0.6);
          },
          repeat: 6,
        }
      ])
      // Lightning strike started 2 frames earlier
      .addFrames([
        { // 24 - 30
          script: frame => {
            let step = 11 - frame.repeat_index;
            this.brightness(1 + (step * 0.2), (step - 6) * 0.6);
          },
          repeat: 6,
        },
        { // 30 - 36
          script: frame => {
            let step = 7 + frame.repeat_index;
            this.brightness(1 + (step * 0.2));
          },
          repeat: 6,
        },
        { // 36 - 48
          script: frame => {
            let step = 11 - frame.repeat_index;
            this.brightness(1 + (step * 0.2));
            this.frame.tint = Tactics.utils.getColorStop(0xFFFFFF, this.color, step / 12);

            // Shadow
            this.frame.children[0].scale.x = 1 - (step * 0.025);
            this.frame.children[0].scale.y = 1 - (step * 0.025);
            this.frame.children[0].position.x -= 0.3;
            this.frame.children[0].position.y -= 0.2;

            // Unit
            this.frame.children[1].position.y += 3;
          },
          repeat: 12,
        },
      ])
      .splice( 0, () => sounds.wind.fade(0, 0.25, 500, sounds.wind.play(winds.shift())))
      .splice( 4, () => sounds.wind.play(winds.shift()))
      .splice( 8, () => sounds.wind.play(winds.shift()))
      .splice(12, () => sounds.roar.play('roar'))
      .splice(16, () => sounds.wind.play(winds.shift()))
      .splice(20, () => sounds.wind.fade(1, 0, 1700, sounds.wind.play(winds.shift())))
      .splice(22, () => sounds.attack.play())
      .splice(23, this.animAttackEffect(
        { spriteId:'sprite:Lightning' },
        target_unit.assignment,
        true,
      ));
    
    return anim.play();
  }
  heal(action) {
    let anim        = new Tactics.Animation();
    let target_unit = action.target.assigned;
    let pixi        = this.pixi;
    let filter      = new PIXI.filters.ColorMatrixFilter();
    pixi.filters = [filter];

    anim
      .addFrame({
        script: frame => {
          let step = 1 + frame.repeat_index;

          filter.brightness(1 + (step * 0.2));
          let base = this.getContainerByName('base');
          base.tint = Tactics.utils.getColorStop(0xFFFFFF, this.color, step / 12);

          if (step === 8) this.sounds.heal.play();
        },
        repeat: 12,
      })
      .splice(9, this.animAttackEffect(
        { spriteId:'sprite:Sparkle', type:'heal' },
        target_unit.assignment,
        true,
      ))
      .addFrame({
        script: frame => {
          let step = 11 - frame.repeat_index;

          filter.brightness(1 + (step * 0.2));
          let base = this.getContainerByName('base');
          base.tint = Tactics.utils.getColorStop(0xFFFFFF, this.color, step / 12);

          if (step === 0) pixi.filters = null;
        },
        repeat: 12,
      });

    return anim.play();
  }
  animHit(attacker, attackType) {
    let anim = new Tactics.Animation();
    let doStagger;
    let direction;

    if (attackType === undefined)
      attackType = attacker.aType;

    if (attackType === 'melee') {
      doStagger = true;

      direction = this.board.getDirection(attacker.assignment, this.assignment, this.direction);

      anim.addFrame(() => this.sounds.crack.play());
    }
    else if (attackType === 'magic') {
      doStagger = true;

      anim.addFrame([]);
    }

    if (doStagger) {
      anim.addFrame([]);

      if (this.paralyzed)
        anim.addFrames([
          () => this.offsetFrame(0.12, direction),
          () => this.offsetFrame(-0.16, direction),
        ]);
      else
        anim.addFrames([
          () => this.drawStagger().offsetFrame(0.12, direction),
          () => this.offsetFrame(-0.16, direction),
          () => this.drawStand(),
        ]);
    }

    return anim;
  }
  animMiss(attacker) {
    let anim = new Tactics.Animation();

    anim.addFrame(() => this.sounds.block.play());

    return anim;
  }
  hatch(action) {
    let board       = this.board;
    let anim        = new Tactics.Animation();
    let assignment  = this.assignment;
    let direction   = board.getDirection(assignment, action.target);
    let target_unit = action.target.assigned;
    let move        = target_unit.renderAnimation('move', direction);
    let myPos       = assignment.getCenter();
    let caption;
    let dragon;
    let hatch       = unitDataMap.get('ChaosDragon').animations[direction].hatch;
    let team        = this.team;
    let tint        = this.color;
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
          if (repeat_index === 1) this.sounds.phase.play();
          this.whiten(repeat_index / 12);
          let trim = this.getContainerByName('trim');
          trim.tint = Tactics.utils.getColorStop(tint, 0xFFFFFF, repeat_index / 12);
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
          if (repeat_index === 1) this.sounds.phase.play();
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
        dragon.drawFrame(hatch.s);
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
          if (repeat_index === 1) this.sounds.phase.play();
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
          dragon.drawFrame(hatch.s + 1 + repeat_index),
        repeat: hatch.l-3
      })
      // 78
      .splice({
        script: ({ repeat_index }) => {
          repeat_index++;
          let trim = dragon.getContainerByName('trim');
          trim.tint = Tactics.utils.getColorStop(0xFFFFFF, tint, repeat_index / 12);
        },
        repeat: 12,
      })
      // 90
      .splice({
        script: ({ repeat_index }) => {
          dragon.color = tint;
          dragon.drawFrame(hatch.s + 6 + repeat_index);
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
            Tactics.animations.death,
            {x:x, y:y, s:2, a:ao},
          ));
        });
      });
    }

    for (let i = 0; i < anim.frames.length; i++) {
      if (i  %   4) continue;
      if (i === 84) break;

      if (i === 0)
        anim.splice(i, () =>
          this.sounds.wind.fade(0, 0.25, 500, this.sounds.wind.play(winds.random()))
        );
      else if (i === 76)
        anim.splice(i, () => {
          this.sounds.roar.play('roar');
          board.drawCard(dragon);
        });
      else
        anim.splice(i, () => this.sounds.wind.play(winds.random()));
    }

    return anim.play();
  }
  canCounter() {
    return true;
  }
}

// Dynamically add unit data properties to the class.
ChaosSeed.prototype.type = 'ChaosSeed';
