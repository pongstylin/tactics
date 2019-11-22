'use strict';

import Unit from 'tactics/Unit.js';
import { unitTypeToIdMap } from 'tactics/unitData.js';

export default class Knight extends Unit {
  constructor(data, board) {
    super(data, board);

    Object.assign(this, {
      _stills:  {},
      _walks:   {},
      _attacks: {},
      _blocks:  {},
      _turns:   {},
    });
  }

  /*
   * Before drawing a unit, it must first have an assignment and direction.
   */
  draw() {
    let pixi = this.pixi = new PIXI.Container();
    pixi.position = this.assignment.getCenter().clone();

    $.each(this.stills, (direction,still) => {
      this._stills[direction] = this.compileFrame(still);
    });

    if (this.walks)
      $.each(this.walks, (direction,walk) => {
        var frames = [];

        $.each(walk, (i,frame) => {
          frames.push(this.compileFrame(frame));
        });

        this._walks[direction] = frames;
      });

    if (this.attacks)
      $.each(this.attacks, (direction,attack) => {
        var frames = [];

        $.each(attack, (i,frame) => {
          frames.push(this.compileFrame(frame));
        });

        this._attacks[direction] = frames;
      });

    if (this.blocks)
      $.each(this.blocks, (direction,block) => {
        var frames = [];

        $.each(block, (i,frame) => {
          frames.push(this.compileFrame(frame));
        });

        this._blocks[direction] = frames;
      });

    $.each(this.turns, (direction,turn) => {
      this._turns[direction] = this.compileFrame(turn);
    });

    return this.drawStand();
  }
  compileFrame(data) {
    if (arguments.length > 1)
      return super.compileFrame(...arguments);

    var unitTypeId = unitTypeToIdMap.get(this.type);
    var imageBase = 'https://legacy.taorankings.com/units/'+unitTypeId+'/';
    var frame = new PIXI.Container();
    var sprite;
    var anchor = data.anchor;
    var ishadow = data.shadow;
    var ibase = data.base;
    var icolor = data.color;

    if (ishadow)
    {
      sprite = PIXI.Sprite.fromImage(imageBase+'shadow/image'+ishadow.src+'.png');
      sprite.data = {name: 'shadow'};
      sprite.position = new PIXI.Point(ishadow.x-anchor.x,ishadow.y-anchor.y);
      sprite.scale.x = sprite.scale.y = ishadow.flip ? -1 : 1;
      sprite.alpha = 0.5;
      sprite.inheritTint = false;
    }
    else
    {
      sprite = PIXI.Sprite.fromImage(imageBase+'base/image'+ibase.src+'.png');
      sprite.data = {name: 'base'};
      sprite.position = new PIXI.Point(ibase.x-anchor.x,ibase.y-anchor.y);
    }
    frame.addChild(sprite);

    sprite = PIXI.Sprite.fromImage(imageBase+'base/image'+ibase.src+'.png');
    sprite.data = {name: 'base'};
    sprite.position = new PIXI.Point(ibase.x-anchor.x,ibase.y-anchor.y);
    frame.addChild(sprite);

    sprite = PIXI.Sprite.fromImage(imageBase+'color/image'+icolor.src+'.png');
    sprite.data = {name: 'trim'};
    sprite.position = new PIXI.Point(icolor.x-anchor.x,icolor.y-anchor.y);
    frame.addChild(sprite);

    return frame;
  }
  drawFrame(frame) {
    let pixi = this.pixi;
    let focus;

    if (this.frame) {
      focus = this.hideFocus();
      pixi.removeChild(this.frame);
    }

    pixi.addChildAt(this.frame = frame,0);
    if (focus)
      this.showFocus(focus.alpha);

    // Reset Normal Appearance
    frame.filters = null;
    frame.tint = 0xFFFFFF;

    frame.children.forEach(sprite => {
      // Apply unit filters to the base and trim sprites.
      if (sprite.data.name === 'base' || sprite.data.name === 'trim')
        sprite.filters = Object.keys(this.filters).map(name => this.filters[name]);

      // Legacy
      if (sprite.data.t)
        sprite.tint = sprite.data.t;
      else if (sprite.data.name === 'trim')
        sprite.tint = this.color;
      else
        sprite.tint = 0xFFFFFF;
    });

    return this;
  }
  drawTurn(direction) {
    if (!direction) direction = this.direction;
    if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);

    this.drawFrame(this._turns[direction]);
  }
  drawStand(direction) {
    if (!direction) direction = this.direction;
    if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);

    this.drawFrame(this._stills[direction]);
  }
  drawAvatar(direction = 'S') {
    let frame = this.compileFrame(this.stills[direction]);

    frame.children.forEach(sprite => {
      if (sprite.data.name === 'trim')
        sprite.tint = this.color;
    });

    return frame;
  }
  attack(action) {
    let anim       = new Tactics.Animation();
    let attackAnim = this.animAttack(action.direction);

    // Animate a target unit's reaction starting with the 4th attack frame.
    action.results.forEach(result => {
      let unit = result.unit;

      if (result.miss)
        attackAnim
          .splice(3, unit.animBlock(this));
      else
        attackAnim
          .splice(3, this.animStrike(unit))
          .splice(4, unit.animStagger(this));
    });

    anim.splice(this.animTurn(action.direction));
    anim.splice(attackAnim);

    return anim.play();
  }
  animMove(assignment) {
    var board = this.board;
    var anim = new Tactics.Animation();
    var tiles = board.findPath(this, assignment);
    var origin = this.assignment;

    // Turn 90deg to the right before we start walking in the opposite direction.
    if (board.getRotation(this.direction,180) == board.getDirection(origin,tiles[0]))
      anim.addFrame(() => {
        this.walk(origin, board.getRotation(this.direction, 90), -1);
      });

    // Hack until Knight is upgraded to use SWF-exported JSON data.
    this._step_directions = [];

    $.each(tiles, i => {
      var ftile = tiles[i-1] || origin;

      anim.splice(this._animTravel(ftile, tiles[i], tiles[i+1]));
    });

    return anim;
  }
  animStepBack(direction) {
    let sounds = $.extend({}, Tactics.sounds, this.sounds);
    let step   = 7;

    return new Tactics.Animation({frames: [
      {
        script: frame => {
          if (step === 4) sounds.step.play();
          this.walk(this.assignment, direction, step--);
        },
        repeat: 5,
      },
      () => {
        sounds.step.play();
        this.stand(direction, 0.25);
      }
    ]});
  }
  animStepForward(direction) {
    let sounds = $.extend({}, Tactics.sounds, this.sounds);
    let step   = 4;

    return new Tactics.Animation({frames: [
      {
        script: frame => {
          if (step === 4) sounds.step.play();
          this.walk(this.assignment, direction, step++);
        },
        repeat: 4,
      },
      () => this.drawStand(),
    ]});
  }
  animAttack(direction) {
    let anim   = new Tactics.Animation();
    let sounds = $.extend({}, Tactics.sounds, this.sounds);
    let swing  = 0;

    if (!direction) direction = this.direction;

    anim.addFrames([
      {
        script: (frame) => {
          this.drawFrame(this._attacks[direction][swing++]);
        },
        repeat: this._attacks[direction].length
      },
      () => this.stand(direction),
    ]);

    anim.splice(0, () => sounds.attack1.play());
    anim.splice(2, () => sounds.attack2.play());

    return anim;
  }
  animBlock(attacker) {
    if (this.barriered)
      return super.animBlock(attacker);

    let sounds    = $.extend({}, Tactics.sounds, this.sounds);
    let direction = this.board.getDirection(this.assignment, attacker.assignment, this.direction);

    return new Tactics.Animation({frames: [
      () => {
        this.direction = direction;
        this.block(0);
        sounds.block.play();
      },
      () => {
        this.block(1).shock(direction,0,1);
      },
      () => {
        this.shock(direction,1,1);
      },
      () => {
        this.shock(direction,2,1);
      },
      () => {
        this.shock();
      },
      () => {
        this.block(0);
      },
      () => {
        this.stand();
      }
    ]});
  }
  animStagger(attacker, direction) {
    let anim = new Tactics.Animation({fps:12});

    if (direction === undefined)
      direction = this.board.getDirection(attacker.assignment, this.assignment, this.direction);

    anim.addFrames([
      () =>
        this.walk(this.assignment,this.direction,-1,0.06,direction),
      () =>
        this.walk(this.assignment,this.direction,-1,-0.02,direction),
      () =>
        this.stand(),
    ]);

    return anim;
  }
  stand(direction, offset) {
    let pixi = this.pixi;
    if (!direction) direction = this.direction;
    if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);

    if (this.pixi) {
      let center = this.assignment.getCenter();
      let offsetX;
      let offsetY;

      if (offset) {
        // This will actually offset the unit in the opposite direction.
        if (direction === 'S') {
          offsetX = -88 * offset;
          offsetY = -56 * offset;
        }
        else if (direction === 'N') {
          offsetX =  88 * offset;
          offsetY =  56 * offset;
        }
        else if (direction === 'E') {
          offsetX = -88 * offset;
          offsetY =  56 * offset;
        }
        else {
          offsetX =  88 * offset;
          offsetY = -56 * offset;
        }

        pixi.position.x = center.x + offsetX;
        pixi.position.y = center.y + offsetY;
      }
      else {
        pixi.position = center.clone();
      }

      this.drawStand(direction);
    }

    if (!offset)
      this.direction = direction;

    return this;
  }
  walk(target, direction, step, offset, odirection) {
    var pixi = this.pixi;
    var walk = this._walks[direction];
    var tpoint = target.getCenter();
    var distX,distY;

    while (step < 0) step = walk.length + step;

    // The tile we're coming from may not exist, so calc its center manually.
    if (direction === 'N') {
      distX = 44;
      distY = 28;
    }
    else if (direction === 'E') {
      distX = -44;
      distY = 28;
    }
    else if (direction == 'W') {
      distX = 44;
      distY = -28;
    }
    else {
      distX = -44;
      distY = -28;
    }

    this.drawFrame(this._walks[direction][step]);
    pixi.position.x = tpoint.x + Math.floor(distX * ((walk.length-step-1) / walk.length));
    pixi.position.y = tpoint.y + Math.floor(distY * ((walk.length-step-1) / walk.length));

    if (offset) {
      offset = {x:Math.round(88 * offset),y:Math.round(56 * offset)};

      // This is the opposite of what you would normally expect.
      if (odirection === 'N') {
        pixi.position.x -= offset.x;
        pixi.position.y -= offset.y;
      }
      else if (odirection === 'S') {
        pixi.position.x += offset.x;
        pixi.position.y += offset.y;
      }
      else if (odirection === 'E') {
        pixi.position.x += offset.x;
        pixi.position.y -= offset.y;
      }
      else if (odirection === 'W') {
        pixi.position.x -= offset.x;
        pixi.position.y += offset.y;
      }
    }

    return this;
  }
  block(frame) {
    return this.drawFrame(this._blocks[this.direction][frame]);
  }

  _animTravel(ftile,dtile,ntile) {
    let board     = this.board;
    let anim      = new Tactics.Animation();
    let sounds    = $.extend({}, Tactics.sounds, this.sounds);
    let direction = board.getDirection(ftile,dtile);
    let edirection,ddirection;
    let funit,dunit;

    // Add the frames for walking from one tile to the next.
    anim.addFrame({
      script: frame => this.walk(dtile,direction, frame.repeat_index),
      repeat: this._walks[direction].length,
    });

    anim.splice([0, 4], () => {
      sounds.step.play();
    });

    if (!ntile)
      anim.addFrame(() => this.assign(dtile).stand(direction));

    // Move the unit behind us back into position.
    if ((funit = ftile.assigned) && funit !== this)
      anim.splice(3, funit.animStepForward(this._step_directions.pop()));

    if (dunit = dtile.assigned) {
      // These directions are not available.
      edirection = [direction, board.getDirection(ntile,dtile)];

      // One of these directions are available.  Sorted by preference.
      $.each([
        dunit.direction,
        board.getRotation(dunit.direction,  90),
        board.getRotation(dunit.direction, -90),
      ], (i, direction) => {
        if (edirection.indexOf(direction) === -1) {
          ddirection = direction;
          return false;
        }
      });

      this._step_directions.push(ddirection);
      anim.splice(0, dunit.animStepBack(ddirection));
    }

    return anim;
  }
}

// Dynamically add unit data properties to the class.
Knight.prototype.type = 'Knight';
