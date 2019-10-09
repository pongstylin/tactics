'use strict';

import EventEmitter from 'events';
import Polygon from 'utils/Polygon.js';
import { unitTypeToIdMap } from 'tactics/unitData.js';
import { reverseColorMap } from 'tactics/colorMap.js';

const HALF_TILE_WIDTH  = 44;
const HALF_TILE_HEIGHT = 28;

export default class {
  constructor(data, board) {
    Object.assign(this, data, {
      board: board,

      // These properties are initialized externally
      id:    null,
      title: null,
      team:  null,
      color: 0,

      assignment: null,
      notice:     null,

      activated: false,
      focused:   false,
      draggable: false,

      mHealth:   0,
      mBlocking: 0,
      mPower:    0,
      mArmor:    0,
      mRecovery: 0,

      // May be set to an array of unit objects
      focusing:  false,
      poisoned:  false,
      paralyzed: false,
      barriered: false,

      pixi:    null,
      filters: {},

      _pulse: null,
      _shock: null,
      _emitter: new EventEmitter(),
    });
  }

  getMoveTiles() {
    let board = this.board;
    if (this.mType === 'path')
      // Use an optimized path finding algorithm.
      return board.getUnitPathRange(this);
    else
      // Use an even faster algorithm.
      return board.getTileRange(this.assignment, 1, this.mRadius, true);
  }
  getAttackTiles(start = this.assignment) {
    let board  = this.board;
    let range  = this.aRange;

    if (this.aLinear)
      // Dark Magic Witch, Beast Rider, Dragon Tyrant, Chaos Dragon
      // All existing units have a minimum range of 1.
      return board.getTileLinearRange(start, range[1]);
    else if (range)
      return board.getTileRange(start, ...range);
    else
      return [];
  }
  getTargetTiles(target) {
    if (this.aLOS === true)
      return this.getLOSTargetTiles(target);
    else if (this.aAll === true)
      return this.getAttackTiles();

    return [target];
  }
  /*
   * Reviews all combinations of moving (or not) then attacking to determine all
   * tiles that can be targeted by an attack.
   *
   * Returns: Set object
   */
  getAllTargetTiles() {
    let moveTiles = this.getMoveTiles();
    let attackTiles;
    let targetTiles;
    let tiles = new Set();
    let i, j, k;

    moveTiles.unshift(this.assignment);

    for (i = 0; i < moveTiles.length; i++) {
      attackTiles = this.getAttackTiles(moveTiles[i]);

      for (j = 0; j < attackTiles.length; j++) {
        targetTiles = this.getTargetTiles(attackTiles[j]);

        for (k = 0; k < targetTiles.length; k++) {
          tiles.add(targetTiles[k]);
        }
      }
    }

    return tiles;
  }
  getTargetUnits(target) {
    let target_units = [];

    if (this.aLOS === true) {
      let unit = this.getLOSTargetUnit(target);
      if (unit)
        target_units.push(unit);
    }
    else
      target_units = this.getTargetTiles(target)
        .filter(tile => !!tile.assigned)
        .map(tile => tile.assigned);

    return target_units;
  }
  getLOSTargetTiles(target, source) {
    source = source || this.assignment;

    // Get the absolute position of the line of sight.
    // The line is drawn between the center of the source and target tiles.
    let lineOfSight = [
      source.position[0] + HALF_TILE_WIDTH,
      source.position[1] + HALF_TILE_HEIGHT,
      target.position[0] + HALF_TILE_WIDTH,
      target.position[1] + HALF_TILE_HEIGHT,
    ];

    // Define a slightly smaller tile shape for targeting.
    let hit_area = new Polygon([
      43, 12, // top-left
      46, 12, // top-right
      70, 26, // right-top
      70, 29, // right-bottom
      46, 44, // bottom-right
      43, 44, // bottom-left
      18, 29, // left-bottom
      18, 26, // left-top
      43, 12, // close
    ]);

    // Set oneX and oneY to 1 or -1 depending on attack direction.
    let oneX = target.x === source.x
      ? 1 // Could be any number
      : (target.x - source.x) / Math.abs(target.x - source.x);
    let oneY = target.y === source.y
      ? 1 // Could be any number
      : (target.y - source.y) / Math.abs(target.y - source.y);

    // Trace a path from source to target, testing tiles along the way.
    let target_tiles = [];
    for (let x = source.x; x !== target.x + oneX; x += oneX) {
      for (let y = source.y; y !== target.y + oneY; y += oneY) {
        let tile = this.board.getTile(x, y);
        if (!tile || tile === source) continue;

        // Get the relative position of the line of sight to the tile.
        let relativeLineOfSight = [
          lineOfSight[0] - tile.position[0],
          lineOfSight[1] - tile.position[1],
          lineOfSight[2] - tile.position[0],
          lineOfSight[3] - tile.position[1],
        ];

        if (hit_area.intersects(...relativeLineOfSight))
          target_tiles.push(tile);
      }
    }

    return target_tiles;
  }
  getLOSTargetUnit(target, source) {
    let target_tile = this.getLOSTargetTiles(target, source).find(t => !!t.assigned);

    return target_tile ? target_tile.assigned : null;
  }
  /*
   * This method calculates what might happen if this unit attacked a target unit.
   * This helps bots make a decision on the best choice to make.
   */
  calcAttack(target_unit, from, target) {
    if (!from)
      from = this.assignment;
    if (!target)
      target = target_unit.assignment;

    let calc     = {};
    let power    = this.power           + this.mPower;
    let armor    = target_unit.armor    + target_unit.mArmor;
    let blocking = target_unit.blocking + target_unit.mBlocking;

    if (this.aLOS && this.getLOSTargetUnit(target, from) !== target_unit) {
      // Armor reduces melee/magic damage.
      calc.damage = Math.round(power * (1 - armor/100));
      if (calc.damage === 0) calc.damage = 1;

      // Another unit is in the way.  No chance to hit target unit.
      calc.chance = 0;
    }
    else if (this.aType === 'melee') {
      // Armor reduces magic damage.
      calc.damage = Math.round(power * (1 - armor/100));
      if (calc.damage === 0) calc.damage = 1;

      if (target_unit.barriered)
        calc.chance = 0;
      else if (target_unit.paralyzed)
        calc.chance = 100;
      else if (target_unit.directional === false) {
        // Wards have 100% blocking from all directions.
        // The Chaos Seed has 50% blocking from all directions.
        calc.chance = Math.max(0, Math.min(100, 100 - blocking));

        // A successful block reduces Chaos Seed blocking temporarily.
        // But, a failed block does not boost Chaos Seed blocking.
        calc.bonus   = 0;
        calc.penalty = 100 - target_unit.blocking;
      }
      else {
        let direction = this.board.getDirection(from, target_unit.assignment, true);

        if (direction.indexOf(target_unit.direction) > -1) {
          // Hitting a unit from behind always succeeds.
          calc.chance = 100;
        }
        else if (direction.indexOf(this.board.getRotation(target_unit.direction, 180)) > -1) {
          // Hitting a unit from the front has smallest chance of success.
          calc.chance = Math.max(0, Math.min(100, 100 - blocking));

          // The target's blocking may be boosted or penalized depending on success.
          calc.bonus   = target_unit.blocking;
          calc.penalty = 100 - target_unit.blocking;
        }
        else {
          // Hitting a unit from the side has improved chance of success.
          calc.chance = Math.max(0, Math.min(100, 100 - blocking/2));

          // The target's blocking may be boosted or penalized depending on success.
          calc.bonus   = target_unit.blocking;
          calc.penalty = 200 - target_unit.blocking;
        }
      }
    }
    else if (this.aType === 'magic') {
      // Armor reduces magic damage.
      calc.damage = Math.round(power * (1 - armor/100));
      if (calc.damage === 0) calc.damage = 1;

      // Magic can only be stopped by barriers.
      if (target_unit.barriered)
        calc.chance = 0;
      else
        calc.chance = 100;
    }
    else if (this.aType === 'heal') {
      // Armor has no effect on heal power.
      calc.damage = -power;

      // Healing can be stopped by barriers.
      if (target_unit.barriered)
        calc.chance = 0;
      else
        calc.chance = 100;
    }
    else {
      // The attack type is the name of an effect.
      calc.effect = this.aType;

      // Not even barriers can stop effects.
      calc.chance = 100;
    }

    return calc;
  }
  getAttackResults(action) {
    let assignment   = this.assignment;
    let results      = [];
    let target       = action.target;
    let target_units = this.getTargetUnits(target);
    let focusing     = [];

    results.push(...target_units.map(unit => {
      let result = { unit:unit };
      let calc   = this.calcAttack(unit, assignment, target);

      if (calc.effect) {
        let property;
        if (calc.effect === 'paralyze')
          property = 'paralyzed';
        else if (calc.effect === 'poisoned')
          property = 'poisoned';

        // Get a list of units currently focused upon this one...
        //  ...excluding units that are being attacked.
        let currentValue = (unit[property] || [])
          .filter(u => !target_units.find(tu => tu === u));

        result.changes = {
          [property]: [...currentValue, this],
        };

        if (this.aFocus) {
          focusing.push(unit);

          result.results = [{
            unit: this,
            changes: { focusing:focusing.slice() },
          }];
        }

        return result;
      }
      else if (calc.chance === 0) {
        if (calc.penalty)
          Object.assign(result, {
            miss: 'blocked',
            changes: {
              direction: this.board.getDirection(unit.assignment, assignment, unit.direction),
              mBlocking: unit.mBlocking - calc.penalty,
            },
          });
        else if (unit.barriered)
          result.miss = 'deflected';

        return result;
      }

      let bad_luck = Math.random() * 100;

      // This metric is used to determine which actions required luck to determine results.
      if (calc.chance < 100)
        result.luck = Math.round(calc.chance - bad_luck);

      if (bad_luck < calc.chance) {
        result.changes = {
          mHealth: Math.max(-unit.health, Math.min(0, unit.mHealth - calc.damage)),
        };

        if (calc.bonus)
          result.changes.mBlocking = unit.mBlocking + calc.bonus;
      }
      else {
        result.miss = 'blocked';

        if (calc.penalty || unit.directional !== false) {
          result.changes = {};

          if (unit.directional !== false)
            result.changes.direction = this.board.getDirection(unit.assignment, assignment, unit.direction);

          if (calc.penalty)
            result.changes.mBlocking = unit.mBlocking - calc.penalty;
        }
      }

      return result;
    }));

    this.getAttackSubResults(results);

    return results;
  }
  /*
   * Apply sub-results that are after-effects of certain results.
   */
  getAttackSubResults(results) {
    // Keep track of changes to unit data from one result to another.
    let unitsData = [];

    results.forEach(result => {
      let unit    = result.unit;
      let changes = result.changes;

      let resultUnit = unitsData.find(ud => ud.unit === unit);
      if (!resultUnit)
        unitsData.push(resultUnit = {
          unit:      unit,
          focusing:  unit.focusing  && unit.focusing.slice(),
          paralyzed: unit.paralyzed && unit.paralyzed.slice(),
          poisoned:  unit.poisoned  && unit.poisoned.slice(),
        });

      if (changes.paralyzed)
        resultUnit.paralyzed = changes.paralyzed;
      if (changes.poisoned)
        resultUnit.poisoned = changes.poisoned;

      // Break the focus of attacked focusing units
      if (resultUnit.focusing) {
        if (
          !changes.paralyzed &&
          !changes.poisoned &&
          !('mHealth' in changes && changes.mHealth < unit.mHealth)
        ) return;

        let subResults = result.results || (result.results = []);
        subResults.push({
          unit: unit,
          changes: { focusing:false },
        });

        resultUnit.focusing.forEach(fUnit => {
          let focusedUnit = unitsData.find(ud => ud.unit === fUnit);
          if (!focusedUnit)
            unitsData.push(focusedUnit = {
              unit:      fUnit,
              focusing:  fUnit.focusing  && fUnit.focusing.slice(),
              paralyzed: fUnit.paralyzed && fUnit.paralyzed.slice(),
              poisoned:  fUnit.poisoned  && fUnit.poisoned.slice(),
            });

          let property;
          if (unit.aType === 'paralyze')
            property = 'paralyzed';
          else if (unit.aType === 'poison')
            property = 'poisoned';

          let newValue = focusedUnit[property].filter(u => u !== unit);
          focusedUnit[property] = newValue.length ? newValue : false;

          subResults.push({
            unit: fUnit,
            changes: { [property]:focusedUnit[property] },
          });
        });

        resultUnit.focusing = false;
      }
      // Remove focus from dead units
      else if (unit.paralyzed || unit.poisoned) {
        if (!('mHealth' in changes)) return;
        if (changes.mHealth > -unit.health) return;

        let subResults = [];
        let focusingUnits = [
          ...(unit.paralyzed || []),
          ...(unit.poisoned  || []),
        ];

        // All units focusing on this dead unit can stop.
        focusingUnits.forEach(fUnit => {
          let focusingUnit = unitsData.find(ud => ud.unit === fUnit);
          if (!focusingUnit)
            unitsData.push(focusingUnit = {
              unit:      fUnit,
              focusing:  fUnit.focusing  && fUnit.focusing.slice(),
              paralyzed: fUnit.paralyzed && fUnit.paralyzed.slice(),
              poisoned:  fUnit.poisoned  && fUnit.poisoned.slice(),
            });

          // Skip units that aren't focusing anymore.
          if (focusingUnit.focusing === false) return;

          let newValue = focusingUnit.focusing.filter(u => u !== unit);
          focusingUnit.focusing = newValue.length ? newValue : false;

          subResults.push({
            unit: fUnit,
            changes: { focusing:focusingUnit.focusing },
          });
        });

        let subChanges = {};
        if (unit.paralyzed)
          subChanges.paralyzed = false;
        if (unit.poisoned)
          subChanges.poisoned = false;

        subResults.push({
          unit: unit,
          changes: subChanges,
        });

        result.results = subResults;
      }
    });
  }
  /*
   * Before drawing a unit, it must first have an assignment and direction.
   */
  draw() {
    let frames = this.frames.map(frame => this.compileFrame(frame));
    let effects = {};

    this.pixi = new PIXI.Container();
    this.pixi.position = this.assignment.getCenter().clone();

    if (this.effects)
      Object.keys(this.effects).forEach(name => {
        effects[name] =
          this.effects[name].frames.map(frame => this.compileFrame(frame, this.effects[name]));
      });

    this._frames = frames;
    this._effects = effects;

    return this.drawStand();
  }
  compileFrame(frame, data = this) {
    let container = new PIXI.Container();
    container.data = frame;
    if (!frame.length && !frame.c) return container;

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
      let sprite = PIXI.Sprite.fromImage(shape.image);
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

      container.addChild(sprite);
    });

    return container;
  }
  drawAvatar(direction = 'S') {
    return this.compileFrame(this.frames[this.stills[direction]]);
  }
  drawFrame(index, context) {
    let pixi = this.pixi;
    let frame = this._frames[index];
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
        // No change required.  All frames have constant positions.
      }
      else { // Legacy
        frame.position.x = frame.data.x || 0;
        frame.position.y = (frame.data.y || 0) - 2;
      }

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
    }

    return this;
  }
  drawTurn(direction) {
    if (!direction) direction = this.direction;
    if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);

    this.drawFrame(this.turns[direction]);
  }
  drawStand(direction) {
    if (this.directional === false)
      direction = 'S';
    else {
      if (!direction) direction = this.direction;
      if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);
    }

    this.drawFrame(this.stills[direction]);
  }
  getSpritesByName(name) {
    return this.frame.children.filter(s => s.data && s.data.name === name);
  }
  offsetFrame(offset, direction) {
    let frame = this.frame;
    offset = {
      x: Math.round(88 * offset),
      y: Math.round(56 * offset)
    };

    if (direction == 'N') {
      frame.position.x -= offset.x;
      frame.position.y -= offset.y;
    }
    else if (direction == 'E') {
      frame.position.x += offset.x;
      frame.position.y -= offset.y;
    }
    else if (direction == 'W') {
      frame.position.x -= offset.x;
      frame.position.y += offset.y;
    }
    else {
      frame.position.x += offset.x;
      frame.position.y += offset.y;
    }

    return this;
  }
  /*
   * DEPRECATED: Use Board.assign() instead.
   */
  assign(assignment) {
    let pixi = this.pixi;

    if (this.assignment && this.assignment.assigned === this)
      this.assignment.dismiss();
    this.assignment = assignment;

    if (assignment) {
      assignment.assign(this);

      if (pixi)
        pixi.position = assignment.getCenter().clone();
    }

    return this;
  }
  /*
   * Specify the relative direction using "degrees" of rotation, e.g. 90.
   * - OR -
   * Specify the absolute direction, e.g. 'N'.
   */
  stand(direction) {
    if (this.directional === false)
      direction = 'S';
    else {
      if (!direction) direction = this.direction;
      if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);
    }

    this.direction = direction;
    if (this.pixi)
      this.drawStand();
  }
  /*
   * This is called before a focusing unit moves, attacks, or turns.
   */
  breakFocus(action) {
    return Promise.resolve();
  }
  // Animate from one tile to the next
  move(action) {
    return this.animMove(action.assignment).play();
  }
  attack(action) {
    throw new Error('Unit type needs to implement attack()');
  }
  attackSpecial(action) {
    throw new Error('Unit type needs to implement attackSpecial()');
  }
  turn(action) {
    if (this.directional === false) return this;

    return this.animTurn(action.direction).play();
  }
  shock(direction, frameId, block) {
    let unitsContainer = this.board.unitsContainer;
    let shocks = this.board.shocks;
    let anchor = this.assignment.getCenter();
    let frame;

    if (this._shock) {
      unitsContainer.removeChild(this._shock);
      this._shock = null;
    }

    if (direction) {
      let shock = this._shock = new PIXI.Container();
      shock.addChild(frame = shocks[frameId]);
      shock.position = anchor.clone();
      shock.position.y += 4; // ensure shock graphic overlaps unit.

      unitsContainer.addChild(shock);

      if (direction === 'N') {
        if (block) {
          frame.position = new PIXI.Point(-20,-56);
        }
        else {
          frame.position = new PIXI.Point(-9,-49);
        }
      }
      else if (direction === 'S') {
        if (block) {
          frame.position = new PIXI.Point(24,-27);
        }
        else {
          frame.position = new PIXI.Point(13,-34);
        }
      }
      else if (direction === 'W') {
        if (block) {
          frame.position = new PIXI.Point(-20,-27);
        }
        else {
          frame.position = new PIXI.Point(-9,-34);
        }
      }
      else if (direction === 'E') {
        if (block) {
          frame.position = new PIXI.Point(24,-56);
        }
        else {
          frame.position = new PIXI.Point(13,-49);
        }
      }
    }

    return this;
  }
  brightness(intensity, whiteness) {
    let name = 'brightness';
    let filter;
    let matrix;

    if (intensity === 1 && !whiteness) {
      this._setFilter(name, undefined);
    }
    else {
      filter = this._setFilter(name, 'ColorMatrixFilter')
      filter.brightness(intensity)

      if (whiteness) {
        matrix = filter.matrix;
        matrix[1 ] = matrix[2 ] =
        matrix[5 ] = matrix[7 ] =
        matrix[10] = matrix[11] = whiteness;
      }
    }

    return this;
  }
  whiten(intensity) {
    let name = 'whiten';
    let matrix;

    if (!intensity) {
      this._setFilter(name, undefined);
    }
    else {
      matrix = this._setFilter(name, 'ColorMatrixFilter').matrix;
      matrix[3] = matrix[8] = matrix[13] = intensity;
    }

    return this;
  }
  /*
   * Add color to the unit's base and trim.
   * Example, increase the redness by 128 (0x880000).
   *   this.colorize(0xFF0000, 0.5);
   */
  colorize(color, lightness) {
    let name = 'colorize';
    let matrix;

    if (typeof color === 'number')
      color = [
        ((color & 0xFF0000) / 0xFF0000),
        ((color & 0x00FF00) / 0x00FF00),
        ((color & 0x0000FF) / 0x0000FF),
      ];

    if (typeof lightness === 'number')
      color = color.map(c => Math.min(c * lightness, 1));

    if (color === null || lightness === 0) {
      this._setFilter(name, undefined);
    }
    else {
      matrix = this._setFilter(name, 'ColorMatrixFilter').matrix;
      matrix[3]  = color[0];
      matrix[8]  = color[1];
      matrix[13] = color[2];
    }

    return this;
  }
  focus(viewed) {
    if (this.focused) return;
    this.focused = true;

    let pulse = this._pulse;
    return this.assignment.painted === 'focus' && !pulse && !viewed ? this._startPulse(6) : this;
  }
  blur() {
    if (!this.focused) return this;
    this.focused = false;

    let pulse = this._pulse;
    return pulse && !this.activated ? this._stopPulse() : this;
  }
  /*
   * A unit is activated when it is selected either directly or indirectly.
   *
   * The activation may optionally activate a specific 'mode'.
   * Modes include 'move', 'attack', 'turn', and 'direction':
   * * 'move' mode shows all possible move targets as blue tiles.
   * * 'attack' mode shows all possible attack targets as orange tiles.
   * * 'turn' mode shows all 4 arrows for assigning a direction.
   * * 'direction' mode shows 1 arrow to show current unit direction.
   *
   * The bot activates units without a mode so that it pulses, but does not
   * show movement or attack tiles.
   *
   * A unit may be activated in 'view'-only mode.  This typically occurs
   * when selecting an enemy unit to view its movement or attack range.
   */
  activate(mode, view_only) {
    mode = mode || this.activated || true;
    if (this.activated === mode) return;

    this.activated = mode;

    return view_only ? this : this._startPulse(4, 2);
  }
  deactivate() {
    if (!this.activated) return this;
    this.activated = false;

    return this._stopPulse();
  }
  change(changes) {
    Object.assign(this, changes);

    this._emit({type:'change', changes:changes});

    return this;
  }
  hasFocus() {
    return !!this.getSpritesByName('focus')[0];
  }
  showFocus(alpha = 1, color = this.color) {
    let focus = this.getSpritesByName('focus')[0];

    if (!focus) {
      focus = this.compileFrame(Tactics.effects.focus.frames[0], Tactics.effects.focus);
      focus.data = {name: 'focus'};
      focus.children.forEach(sprite => sprite.tint = color);
      focus.alpha = alpha;

      this.frame.addChildAt(focus, 1);
    }
    else {
      focus.alpha = alpha;
      focus.children.forEach(sprite => sprite.tint = color);
    }

    return this;
  }
  hideFocus() {
    let focus = this.getSpritesByName('focus')[0];
    if (focus)
      this.frame.removeChild(focus);

    return focus;
  }
  animFocus() {
    let anim   = new Tactics.Animation();
    let alphas = [0.125, 0.25, 0.375, 0.5];
    let focus  = this.getSpritesByName('focus')[0];

    if (!focus) {
      focus = this.compileFrame(Tactics.effects.focus.frames[0], Tactics.effects.focus);
      focus.data = {name: 'focus'};
      focus.children.forEach(sprite => sprite.tint = this.color);

      anim.addFrame(() => this.frame.addChildAt(focus, 1));
    }

    anim.splice(0, {
      script: frame => focus.alpha = alphas[frame.repeat_index],
      repeat: alphas.length,
    });

    return anim;
  }
  animDefocus() {
    let anim = new Tactics.Animation();
    let alphas = [0.375, 0.25, 0.125];
    let focus = this.getSpritesByName('focus')[0];

    anim.addFrame({
      script: frame => focus.alpha = alphas[frame.repeat_index],
      repeat: alphas.length,
    });
    anim.addFrame(() => this.frame.removeChild(focus));

    return anim;
  }
  animPulse(steps, speed) {
    let step = steps;
    let stride = 0.1 * (speed || 1);

    return new Tactics.Animation({
      loop:   true,
      frames: [
        {
          script: () => this.brightness(1 + (step-- * stride)),
          repeat: steps,
        },
        {
          script: () => this.brightness(1 + (step++ * stride)),
          repeat: steps,
        }
      ]
    });
  }
  /*
   * Right now, the default expectation is units walk from A to B.
   */
  animMove(assignment) {
    return this.animWalk(assignment);
  }
  /*
   * Units turn in the direction they are headed before they move there.
   * This method returns an animation that does just that, if needed.
   */
  animTurn(direction) {
    let anim = new Tactics.Animation();

    // Do nothing if already facing the desired direction
    if (!direction || direction === this.direction) return anim;

    // If turning to the opposite direction, first turn right.
    if (direction === this.board.getRotation(this.direction, 180))
      anim.addFrame(() => this.drawTurn(90));

    // Now stand facing the desired direction.
    anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animWalk(assignment) {
    let anim        = new Tactics.Animation();
    let sounds      = Object.assign({}, Tactics.sounds, this.sounds);
    let path        = this.board.findPath(this, assignment);
    let frame_index = 0;

    /*
     * Need more information about an intermittent crash.
     */
    if (path.length === 0) {
      if (this.assignment && assignment)
        throw new Error(`No path: ${this.assignment.id} => ${assignment.id}`);
      else
        throw new Error(`No path: ${this.assignment} => ${assignment}`);
    }

    anim.addFrame(() => this.assignment.dismiss());

    // Turn frames are not typically required while walking unless the very
    // next tile is in the opposite direction of where the unit is facing.
    let direction = this.board.getDirection(this.assignment, path[0]);
    if (direction === this.board.getRotation(this.direction, 180))
      anim.splice(frame_index++, () => this.drawTurn(90));

    // Keep track of what direction units face as they step out of the way.
    let step_directions = [];

    path.forEach((to_tile, i) => {
      let from_tile = i === 0 ? this.assignment : path[i-1];

      // Determine the direction of the next tile and turn in that direction.
      let direction = this.board.getDirection(from_tile, to_tile);
      let walks     = this.walks[direction];

      // Walk to the next tile
      let indexes = [];
      for (let index = this.walks[direction][0]; index <= this.walks[direction][1]; index++) {
        indexes.push(index);
      }
      indexes.forEach(index =>
        anim.splice(frame_index++, () => this.drawFrame(index, from_tile))
      );

      // Do not step softly into that good night.
      anim.splice([-8, -4], () => sounds.step.play());

      // Make any units before us step out of the way.
      let to_unit;
      if (to_unit = to_tile.assigned) {
        let next_tile = path[i+1];
        // The unit needs to back up in a direction that isn't in our way.
        let bad_directions = [direction, this.board.getDirection(next_tile, to_tile)];

        // Find the first available direction in preference order.
        let to_direction = [
          to_unit.direction,
          this.board.getRotation(to_unit.direction,  90),
          this.board.getRotation(to_unit.direction, -90),
        ].find(direction => !bad_directions.includes(direction));

        step_directions.push(to_direction);
        anim.splice(-8, to_unit.animStepBack(to_direction));
      }

      // Make any units behind us step back into position.
      let from_unit;
      if ((from_unit = from_tile.assigned) && from_unit !== this)
        anim.splice(-5, from_unit.animStepForward(step_directions.pop()));

      // If this is our final destination, stand ready
      if (to_tile === assignment)
        anim.addFrame(() => this.assign(assignment).stand(direction));
    });

    return anim;
  }
  animStepBack(direction) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let indexes = [];
    for (let index = this.backSteps[direction][0]; index <= this.backSteps[direction][1]; index++) {
      indexes.push(index);
    }
    indexes.forEach(index => anim.addFrame(() => this.drawFrame(index)));

    // Don't just be grumpy.  Stomp your grumpiness.
    anim.splice([3, 5], () => sounds.step.play());

    return anim;
  }
  animStepForward(direction) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    let indexes = [];
    for (let index = this.foreSteps[direction][0]; index <= this.foreSteps[direction][1]; index++) {
      indexes.push(index);
    }
    indexes.forEach(index => anim.addFrame(() => this.drawFrame(index)));

    anim.addFrame(() => this.drawStand());

    // One final stomp for science
    anim.splice(0, () => sounds.step.play());

    return anim;
  }
  animAttack(direction) {
    let anim = new Tactics.Animation();

    if (!direction) direction = this.direction;

    let indexes = [];
    for (let index = this.attacks[direction][0]; index <= this.attacks[direction][1]; index++) {
      indexes.push(index);
    }
    indexes.forEach(index => anim.addFrame(() => this.drawFrame(index)));

    anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animBlock(attacker) {
    let anim      = new Tactics.Animation();
    let sounds    = Object.assign({}, Tactics.sounds, this.sounds);
    let direction = this.board.getDirection(this.assignment, attacker.assignment, this.direction);

    anim.addFrame(() => sounds.block.play());
    if (this.directional !== false)
      anim.splice(0, () => this.direction = direction);

    if (this.blocks) {
      let indexes = [];
      for (let index = this.blocks[direction][0]; index <= this.blocks[direction][1]; index++) {
        indexes.push(index);
      }
      indexes.forEach((index, i) => anim.splice(i, () => this.drawFrame(index)));

      // Kinda hacky.  It seems that shocks should be rendered by the attacker, not defender.
      if (attacker.name === 'Scout')
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
    }

    if (this.directional !== false)
      anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animReadySpecial() {
    let anim = new Tactics.Animation({
      state: {ready: false},
      loop:  24,
    });

    let radius = 28;
    let angle = 2 * Math.PI / 24;
    let blurFilter = new PIXI.filters.BlurFilter();
    blurFilter.blur = 0.5;

    let shape = new PIXI.Graphics();
    shape.position = new PIXI.Point(0, HALF_TILE_HEIGHT - radius);
    shape.lineStyle(2, 0xFF3300);

    let container = new PIXI.Container();
    container.scale = new PIXI.Point(1, 0.6);
    container.data = {name: 'special'};
    container.addChild(shape);

    anim.addFrame(() => {
      container.position = new PIXI.Point(
        this.frame.position.x * -1,
        this.frame.position.y * -1,
      );

      // Insert the shape right after the shadow
      this.frame.addChildAt(container, 1);
    });

    let index = 0;

    anim.splice(0, {
      script: () => {
        shape.moveTo(0, 0);
        shape.lineTo(
          Math.cos(angle * (index + 18)) * radius,
          Math.sin(angle * (index + 18)) * radius,
        );

        // Make sure the shape pulses with the unit.
        blurFilter.blur = Math.floor(index / 6);
        if (this.frame.children[2].filters)
          container.filters = [blurFilter].concat(this.frame.children[2].filters);
        else
          container.filters = [blurFilter];

        index++;
      },
      repeat: 24,
    });

    anim.addFrame((frame, state) => state.ready = true);

    let degrees = 0;

    // This frame will be looped until animation is stopped.
    anim.splice(24, () => {
      degrees = (degrees + 5) % 360;
      let radians = degrees * Math.PI / 180;

      // Degrees to radians
      shape.rotation = degrees * Math.PI / 180;

      // Make sure the shape pulses with the unit.
      blurFilter.blur = 4;
      if (this.frame.children[2].filters)
        container.filters = [blurFilter].concat(this.frame.children[2].filters);
      else
        container.filters = [blurFilter];
    });

    anim.on('stop', event => {
      this.frame.removeChild(container);
    });

    return anim;
  }
  animStrike(defender) {
    let anim      = new Tactics.Animation();
    let sounds    = Object.assign({}, Tactics.sounds, this.sounds);
    let direction = this.board.getDirection(
      defender.assignment,
      this.assignment,
      this.board.getRotation(this.direction, 180),
    );

    return anim.addFrames([
      () => sounds.strike.play(),
      () => defender.shock(direction, 0),
      () => defender.shock(direction, 1),
      () => defender.shock(direction, 2),
      () => defender.shock(),
    ]);

    return anim;
  }
  animStagger(attacker) {
    let anim      = new Tactics.Animation();
    let direction = this.board.getDirection(attacker.assignment, this.assignment, this.direction);

    anim.addFrames([
      () =>
        this
          .drawFrame(this.turns[this.direction])
          .offsetFrame(0.06, direction),
      () =>
        this
          .drawFrame(this.turns[this.direction])
          .offsetFrame(-0.02, direction),
      () =>
        this.drawStand(),
    ]);

    return anim;
  }
  animDeath() {
    let pixi = this.pixi;
    let container = new PIXI.Container();
    let anim = Tactics.Animation.fromData(container, Tactics.animations.death);

    container.position = new PIXI.Point(1,-2);

    anim
      .splice(0, [
        () => pixi.addChild(container),
        {
          script: () => {
            pixi.children[0].alpha *= 0.60;
            container.alpha *= 0.80;
          },
          repeat:7
        },
        () => this.board.dropUnit(this),
      ])
      .splice(0, {
        script: () => {
          container.children[0].children.forEach(c => c.tint = this.color);
        },
        repeat:8
      });

    return anim;
  }
  animLightning(target) {
    let anim      = new Tactics.Animation();
    let unitsContainer = this.board.unitsContainer;
    let sounds    = Object.assign({}, Tactics.sounds, this.sounds);
    let pos       = target.getCenter();
    let tunit     = target.assigned;
    let whiten    = [0.30,0.60,0.90,0.60,0.30,0];
    let container = new PIXI.Container();
    let strike;
    let strikes = [
      PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/lightning-1.png'),
      PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/lightning-2.png'),
      PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/lightning-3.png'),
      PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/lightning-1.png'),
      PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/lightning-2.png'),
      PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/lightning-3.png')
    ];

    container.position = new PIXI.Point(pos.x,pos.y+1);

    strikes[0].position = new PIXI.Point(-38,-532-1);
    strikes[1].position = new PIXI.Point(-38,-532-1);
    strikes[2].position = new PIXI.Point(-40,-532-1);
    strikes[3].position = new PIXI.Point(-35+strikes[3].width,-532-1);
    strikes[3].scale.x = -1;
    strikes[4].position = new PIXI.Point(-35+strikes[4].width,-532-1);
    strikes[4].scale.x = -1;
    strikes[5].position = new PIXI.Point(-33+strikes[5].width,-532-1);
    strikes[5].scale.x = -1;
    strikes.shuffle();

    anim.addFrames([
      () => {
        sounds.lightning.play();
        unitsContainer.addChild(container);
      },
      () => {},
      {
        script: () => {
          if (strike) container.removeChild(strike);
          if (strikes.length)
            strike = container.addChild(strikes.shift());
          else
            unitsContainer.removeChild(container);
        },
        repeat: 7,
      }
    ]);

    if (tunit)
      anim
        .splice(2, tunit.animStagger(this,tunit.direction))
        .splice(2, {
          script: () => tunit.whiten(whiten.shift()),
          repeat: 6,
        });

    return anim;
  }
  animHeal(target_units) {
    let anim   = new Tactics.Animation();
    let sounds = Object.assign({}, Tactics.sounds, this.sounds);

    if (!Array.isArray(target_units)) target_units = [target_units];

    anim.addFrame(() => sounds.heal.play());

    target_units.forEach(tunit => {
      // Apply sparkles in a few shuffled patterns
      [{x:-18,y:-52},{x:0,y:-67},{x:18,y:-52}].shuffle().forEach((pos, i) => {
        anim.splice(i*3+1, this.animSparkle(tunit.pixi, pos));
      });
    });

    let index = 0;

    anim.splice(2, [
      // Intensify yellow tint on healed units
      {
        script: () => {
          index++;
          target_units.forEach(tunit => tunit.colorize(0x404000, 0.2 * index));
        },
        repeat: 5,
      },
      // Fade yellow tint on healed units
      {
        script: () => {
          index--;
          target_units.forEach(tunit => tunit.colorize(0x404000, 0.2 * index));
        },
        repeat: 5,
      },
      () => target_units.forEach(tunit => tunit.colorize(null)),
    ]);

    return anim;
  }
  animSparkle(parent, pos) {
    let filter    = new PIXI.filters.ColorMatrixFilter();
    let matrix    = filter.matrix;
    let shock     = PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/shock.png');
    let size      = {w:shock.width,h:shock.height};
    let particle  = PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/particle.png');
    let container = new PIXI.Container();
    container.position = new PIXI.Point(pos.x,pos.y+2);

    shock.filters = [filter];
    container.addChild(shock);

    particle.position = new PIXI.Point(-6.5,-6.5);
    container.addChild(particle);

    return new Tactics.Animation({frames: [
      () => {
        matrix[12] = 0.77;
        shock.scale = new PIXI.Point(0.593,0.252);
        shock.position = new PIXI.Point(-shock.width/2,-shock.height/2);
        shock.alpha = 0.22;
        particle.alpha = 0.22;
        parent.addChild(container);
      },
      () => {
        matrix[12] = 0.44;
        shock.scale = new PIXI.Point(0.481,0.430);
        shock.position = new PIXI.Point(-shock.width/2,-shock.height/2 + 3);
        shock.alpha = 0.55;
        particle.position.y += 3;
        particle.alpha = 0.55;
      },
      () => {
        matrix[12] = 0;
        shock.scale = new PIXI.Point(0.333,0.667);
        shock.position = new PIXI.Point(-shock.width/2,-shock.height/2 + 6);
        shock.alpha = 1;
        particle.position.y += 3;
        particle.alpha = 1;
      },
      () => {
        matrix[12] = 0.62;
        shock.scale = new PIXI.Point(0.150,1);
        shock.position = new PIXI.Point(-shock.width/2,-shock.height/2 + 9);
        particle.position.y += 3;
      },
      () => {
        matrix[12] = 1;
        shock.scale = new PIXI.Point(0.133,1.2);
        shock.position = new PIXI.Point(-shock.width/2,-shock.height/2 + 12);
        particle.position.y += 3;
        particle.alpha = 0;
      },
      () => {
        parent.removeChild(container);
      }
    ]});
  }
  animCaption(caption, options) {
    if (options === undefined)
      options = {};
    if (options.color === undefined)
      options.color = 'white';

    return this._animText(
      caption,
      {
        fontFamily:      'Arial',
        fontSize:        '12px',
        fontWeight:      'bold',
        stroke:          0,
        strokeThickness: 1,
        fill:            options.color,
      },
      options,
    );
  }
  setTargetNotice(target_unit, target) {
    let calc = this.calcAttack(target_unit, null, target);
    let notice;

    if (calc.effect === 'paralyze')
      notice = 'Paralyze!';
    else if (calc.effect === 'poison')
      notice = 'Poison!';
    else if (calc.damage === 0)
      notice = calc.damage+' ('+Math.round(calc.chance)+'%)';
    else if (calc.damage < 0)
      notice = '+'+Math.abs(calc.damage)+' ('+Math.round(calc.chance)+'%)';
    else
      notice = '-'+calc.damage+' ('+Math.round(calc.chance)+'%)';

    target_unit.change({ notice:notice });
  }
  validateAction(action) {
    let actionType = action.type.charAt(0).toUpperCase() + action.type.slice(1);
    let validate = 'validate'+actionType+'Action';

    if (validate in this)
      return this[validate](action);

    return null;
  }
  validateMoveAction(validate) {
    let action = { type:'move', unit:validate.unit };

    if (validate.direction && this.directional === false)
      return null;

    if (!validate.assignment)
      return null;

    let tiles = this.getMoveTiles();
    if (!tiles.find(tile => tile === validate.assignment))
      return null;

    action.assignment = validate.assignment;

    if (this.directional !== false) {
      let board = this.board;
      let direction;
      if (this.mType === 'path') {
        let path = board.findPath(this, action.assignment);
        path.unshift(this.assignment);

        direction = board.getDirection(path[path.length-2], path[path.length-1]);
      }
      else
        direction = board.getDirection(this.assignment, action.assignment);

      if (validate.direction && validate.direction !== direction)
        return null;
      if (direction !== this.direction)
        action.direction = direction;
    }

    return action;
  }
  validateAttackAction(validate) {
    let action = { type:'attack', unit:validate.unit };

    if (validate.direction && this.directional === false)
      return null;

    if (this.aAll) {
      // Tile data is forbidden when attacking all tiles.
      if (validate.target)
        return null;

      // Not opinionated on presence or absense of 'direction'
      if (validate.direction)
        action.direction = validate.direction;
    }
    else {
      // Tile data is required when not attacking all tiles.
      if (!validate.target)
        return null;

      let tiles = this.getAttackTiles();
      if (!tiles.find(tile => tile === validate.target))
        return null;

      if (validate.direction) {
        let direction = this.board.getDirection(this.assignment, validate.target);
        if (direction.indexOf(validate.direction) === -1)
          return null;

        if (validate.direction !== this.direction)
          action.direction = direction;
      }
      else if (this.directional !== false) {
        let direction = this.board.getDirection(this.assignment, validate.target, this.direction);
        if (direction !== this.direction)
          action.direction = direction;
      }

      action.target = validate.target;
    }

    action.results = this.getAttackResults(action);

    return action;
  }
  validateAttackSpecialAction(validate) {
    let action = { type:'attackSpecial', unit:validate.unit };

    if (!this.canSpecial)
      return null;

    action.results = this.getAttackSpecialResults(action);

    return action;
  }
  validateTurnAction(validate) {
    let action = { type:'turn', unit:validate.unit };

    if (this.directional === false)
      return null;

    if (!validate.direction)
      return null;

    action.direction = validate.direction;

    return action;
  }
  canSpecial() {
    return false;
  }
  canCounter() {
    return false;
  }
  isPassable() {
    return this.focusing === false && !this.paralyzed && this.mPass !== false;
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  toJSON() {
    let state = {
      id: this.id,
      type: this.type,
      assignment: [this.assignment.x, this.assignment.y],
    };

    if (this.directional !== false)
      state.direction = this.direction;

    let colorId = reverseColorMap.get(this.color);
    if (colorId !== this.team.colorId)
      state.colorId = colorId;

    let properties = [
      'mHealth',
      'mBlocking',
      'mPower',
      'mArmor',
      'mRecovery',
      'focusing',
      'paralyzed',
      'poisoned',
      'barriered',
    ];

    properties.forEach(prop => {
      if (this[prop])
        if (prop === 'focusing' || prop === 'paralyzed' || prop === 'poisoned')
          state[prop] = this[prop].map(u => u.id);
        else
          state[prop] = this[prop];
    });

    return state;
  }

  /*
   * Applies and returns a new filter to the base and trim sprites.
   * If the filter name already exists, it just returns it.
   */
  _setFilter(name, type) {
    let filters = this.filters;

    if (type) {
      if (!(name in filters)) {
        filters[name] = new PIXI.filters[type]();

        this.frame.children.forEach(child => {
          if ('data' in child)
            if (child.data.name === 'base' || child.data.name === 'trim')
              child.filters = Object.keys(filters).map(n => filters[n]);
        });
      }
    }
    else {
      if (name in filters) {
        delete filters[name];

        this.frame.children.forEach(child => {
          if ('data' in child)
            if (child.data.name === 'base' || child.data.name === 'trim')
              if (child.filters.length > 1)
                child.filters = Object.keys(filters).map(n => filters[n]);
              else
                child.filters = null;
        });
      }
    }

    return filters[name];
  }

  _startPulse(steps, speed) {
    let pulse = this._pulse;
    if (pulse) this._stopPulse();

    this._pulse = pulse = this.animPulse(steps, speed);
    pulse.play().then(() => this.brightness(1));

    return this;
  }

  _stopPulse() {
    let pulse = this._pulse;
    if (!pulse) return this;

    pulse.stop();
    this._pulse = null;

    return this;
  }

  _animText(text, style, options) {
    let anim = new Tactics.Animation();
    let pixi = this.pixi;
    let container = new PIXI.Container();
    let w = 0;

    options = options || {};

    text.split('').forEach((v, i) => {
      let letter = new PIXI.Text(v, style);
      letter.position.x = w;
      w += letter.width;

      anim.splice(i, () => container.addChild(letter));
      anim.splice(i, this._animLetter(letter));
    });

    container.position = new PIXI.Point(-((w / 2) | 0),-71);
    container.position.x += options.x || 0;
    container.position.y += options.y || 0;

    anim
      .splice(0, () => pixi.addChild(container))
      .splice(() => pixi.removeChild(container));

    return anim;
  }

  _animLetter(letter) {
    return new Tactics.Animation({frames: [
      () => letter.position.y -= 7,
      () => letter.position.y -= 2,
      () => letter.position.y += 1,
      () => letter.position.y += 2,
    ]});
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
