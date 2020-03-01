import Unit from 'tactics/Unit.js';
import { unitTypeToIdMap } from 'tactics/unitData.js';
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
          if (shape.n === 's')
            shape.name = 'shadow';
          else if (shape.n === 'b')
            shape.name = 'base';
          else if (shape.n === 't')
            shape.name = 'trim';
          else
            shape.name = shape.n;
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
      if (actionName === 'stand')
        actionName = 'stills';
      else if (actionName === 'turn' || actionName === 'stagger')
        actionName = 'turns';
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
  move(action) {
    return this.animMove(action.assignment).play();
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
    let banned = this.banned.slice();
    if (attacker)
      banned.push(attacker.team.id);

    let board = this.board;
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
        unit: this,
        changes: { banned },
      }];

    return phaseAction;
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
        script: frame => {
          let step = frame.repeat_index + 1;
          let color = Tactics.utils.getColorStop(old_color, new_color, step / 12);
          this.change({ color:color });
          this.getContainerByName('trim').tint = this.color;
        },
        repeat: 12,
      }
    ]});
  }
  animMove(assignment) {
    let board       = this.board;
    let anim        = new Tactics.Animation({fps:10});
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
          .splice([2,7,11,16], () => this.sounds.flap.play())
      );
    anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animAttack(target) {
    let board     = this.board;
    let anim      = new Tactics.Animation();
    let tunit     = target.assigned;
    let direction = board.getDirection(this.assignment, target, 1);
    let attack    = this.animations[direction].attack, frame=0;
    let whiten    = [0.25, 0.5, 0];
    let adjust    = direction === 'N' ? {x:-5,y:0} : direction === 'W' ? {x:-5,y:3} : {x:5,y:3};
    let container = new PIXI.Container();
    let filter1   = new PIXI.filters.BlurFilter();
    let filter2   = new PIXI.filters.BlurFilter();
    let streaks1  = new PIXI.Graphics;
    let streaks2  = new PIXI.Graphics;
    let streaks3  = new PIXI.Graphics;

    adjust.x -= board.pixi.position.x;
    adjust.y -= board.pixi.position.y;

    //filter1.blur = 6;
    streaks1.filters = [filter1];
    container.addChild(streaks1);

    filter2.blur = 4;
    streaks2.filters = [filter2];
    container.addChild(streaks2);

    streaks3.filters = [filter2];
    container.addChild(streaks3);

    anim
      .addFrame({
        script: () => this.drawFrame(attack.s + frame++),
        repeat: attack.l,
      })
      .splice(0, () => this.sounds.charge.fade(0, 1, 500, this.sounds.charge.play()))
      .splice(3, tunit.animHit(this))
      .splice(5, () => {
        this.sounds.buzz.play();
        this.sounds.charge.stop();
        this.sounds.attack.play();
      })
      .splice(5, {
        script: () => tunit.whiten(whiten.shift()),
        repeat: 3,
      })
      .splice(5, () => {
        this.drawStreaks(container, target, adjust);
        board.pixi.addChild(container);
      })
      .splice(6, () => {
        this.drawStreaks(container, target, adjust);
      })
      .splice(7, () => {
        board.pixi.removeChild(container);
        this.sounds.buzz.stop();
      });

    return anim;
  }
  drawStreaks(container, target, adjust) {
    let sprite = this.getContainerByName('glow');
    let bounds = sprite.getBounds();
    let start  = new PIXI.Point(bounds.x + adjust.x, bounds.y + adjust.y);
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
      let alpha     = i % 2 === 0 ? 0.6 : 1;
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
  animTurn(direction, andStand = true) {
    let anim = new Tactics.Animation();

    // Do nothing if already facing the desired direction
    if (!direction || direction === this.direction) return anim;

    // If turning to the opposite direction, first turn right.
    if (direction === this.board.getRotation(this.direction, 180)) {
      anim.addFrame(() => {
        let playId = this.sounds.flap.play();
        this.sounds.flap.volume(0.65 * 0.5, playId);
      });
      anim.addFrame(() => this.drawTurn(90));
    }

    // Now stand facing the desired direction.
    if (andStand)
      anim.addFrame(() => this.stand(direction));

    return anim;
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

      anim.addFrame(() => this.sounds.impact.play());
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
    let anim      = new Tactics.Animation();
    let direction = this.board.getDirection(this.assignment, attacker.assignment, this.direction);
    let block     = this.animations[direction].block;

    anim
      .addFrames([
        () => this.direction = direction,
        () => this.sounds.block.play(),
      ])
      .splice(0, {
        script: frame => this.drawFrame(block.s + frame.repeat_index),
        repeat: block.l,
      });

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
      ])
      .splice(0, () => this.sounds.heal.play())
      .splice(0, this.animAttackEffect(
        { spriteId:'sprite:Sparkle', type:'heal' },
        this.assignment,
        true,
      ))
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
