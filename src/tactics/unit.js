(function () {
  'use strict';

  const HALF_TILE_HEIGHT = 28;

  var shocks;

  function prerenderShocks() {
    shocks = [
      new PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/shock.png'),
      new PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/shock.png'),
      new PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/shock.png')
    ];

    shocks[0].anchor = new PIXI.Point(0.5,0.5);
    shocks[0].scale = new PIXI.Point(4.65,0.65);
    shocks[0].rotation = 0.5;

    shocks[1].anchor = new PIXI.Point(0.5,0.5);
    shocks[1].scale = new PIXI.Point(2,0.7);
    shocks[1].rotation = 0.5;

    shocks[2].anchor = new PIXI.Point(0.5,0.5);
    shocks[2].scale = new PIXI.Point(0.4,3);
    shocks[2].rotation = 0.5;
    shocks[2].alpha = 0.5;
  }

  Tactics.Unit = function (type) {
    if (shocks === undefined)
      prerenderShocks();

    var self = this;
    var pixi = new PIXI.Container();
    var data = Tactics.units[type];
    var game  = Tactics.game;
    var stage = game.stage;
    var board = game.board;
    var pulse;
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var shock;

    utils.addEvents.call(self);

    Object.assign(self, {
      // Public properties
      pixi:    pixi,
      filters: {},

      team:       undefined,
      color:      0,
      type:       type,
      name:       data.name,
      sprite:     undefined,
      assignment: undefined,

      title:     undefined,
      notice:    null,
      activated: false,
      focused:   false,

      target:    null,

      mType:   data.mType,
      mPass:   data.mPass,
      mRadius: data.mRadius,
      aRadius: data.aRadius,
      aAll:    data.aAll,

      health:      data.health,
      blocking:    data.blocking,
      power:       data.power,
      armor:       data.armor,
      recovery:    data.recovery,
      directional: data.directional,

      mHealth:   0,
      mBlocking: 0,
      mPower:    0,
      mArmor:    0,
      mRecovery: 0,

      ability:   data.ability,
      specialty: data.specialty,

      // May be set to an array of units being focused upon
      focusing:  false,

      // The number of units applying the status effect
      poisoned:  0,
      paralyzed: 0,
      barriered: 0,

      getMoveTiles: function (start) {
        start = start || self.assignment;

        let tiles = [];
        let tile;
        let path;
        let mType  = data.mType;
        let radius = data.mRadius;
        let minX   = start.x - radius;
        let maxX   = start.x + radius;
        let minY   = start.y - radius;
        let maxY   = start.y + radius;

        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            if (!(tile = board.getTile(x, y))) continue;
            if (tile.assigned) continue;
            if (board.getDistance(start, tile) > radius) continue;

            if (mType === 'path') {
              if (!(path = board.findPath(self, tile, start))) continue;
              if (path.length > radius) continue;
            }

            tiles.push(tile);
          }
        }

        return tiles;
      },
      getAttackTiles: function (start) {
        let tiles = [];
        let radius = data.aRadius;
        let tile;

        start = start || self.assignment;
        let cx    = start.x;
        let cy    = start.y;
        let minX  = Math.max(cx - radius, 0);
        let maxX  = Math.min(cx + radius, 10);
        let minY  = Math.max(cy - radius, 0);
        let maxY  = Math.min(cy + radius, 10);

        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            if (data.aLinear && x != cx && y != cy) continue;
            if (!(tile = board.getTile(x, y))) continue;
            if (tile === start) continue;
            if (board.getDistance(start, tile) > radius) continue;

            tiles.push(tile);
          }
        }

        return tiles;
      },
      getTargetTiles: function (target) {
        if (data.aLOS === true)
          return self.getLOSTargetTiles(target);
        else if (data.aAll === true)
          return self.getAttackTiles();

        return [target];
      },
      getTargetUnits: function (target) {
        let target_units = [];

        if (data.aLOS === true) {
          let unit = self.getLOSTargetUnit(target);
          if (unit)
            target_units.push(unit);
        }
        else
          target_units = self.getTargetTiles(target)
            .filter(tile => !!tile.assigned)
            .map(tile => tile.assigned);

        return target_units;
      },
      getLOSTargetTiles: function (target, source) {
        source = source || self.assignment;

        // Get the absolute position of the line.
        let source_point = source.pixi.toGlobal(new PIXI.Point(44, 28));
        let target_point = target.pixi.toGlobal(new PIXI.Point(44, 28));

        /* For testing LOS
        let line = new PIXI.Graphics();
        line.lineStyle(1, 0x00ff00);
        line.moveTo(source_point.x, source_point.y);
        line.lineTo(target_point.x, target_point.y);
        stage.addChild(line);
        */

        let hit_area = new PIXI.Polygon([
          43, 12, // top-left
          46, 12, // top-right
          70, 26, // right-top
          70, 29, // right-bottom
          46, 44, // bottom-right
          43, 44, // bottom-left
          18, 29, // left-bottom
          18, 26, // left-top
          43, 10, // close
        ]);

        // Set oneX and oneY to 1 or -1 depending on attack direction.
        let oneX = target.x === source.x
          ? 1 // Could be any number
          : (target.x - source.x) / Math.abs(target.x - source.x)
        let oneY = target.y === source.y
          ? 1 // Could be any number
          : (target.y - source.y) / Math.abs(target.y - source.y)

        // Trace a path from source to target, testing tiles along the way.
        let target_tiles = [];
        for (let x = source.x; x !== target.x + oneX; x += oneX) {
          for (let y = source.y; y !== target.y + oneY; y += oneY) {
            let tile = board.getTile(x, y);
            if (!tile || tile === source) continue;
 
            /* For testing LOS
            let child = new PIXI.Graphics();
            child.lineStyle(1, 0xff0000);
            child.drawPolygon(hit_area.points);
            tile.pixi.addChild(child);
            */

            // Get the relative position of the line to the tile.
            let local_source_point = tile.pixi.toLocal(source_point);
            let local_target_point = tile.pixi.toLocal(target_point);

            let intersects = hit_area.intersects(
              local_source_point.x,
              local_source_point.y,
              local_target_point.x,
              local_target_point.y,
            );

            if (intersects)
              target_tiles.push(tile);
          }
        }

        return target_tiles;
      },
      getLOSTargetUnit(target, source) {
        let target_tile = self.getLOSTargetTiles(target, source).find(t => !!t.assigned);

        return target_tile ? target_tile.assigned : null;
      },
      /*
       * This method calculates what might happen if this unit attacked a target unit.
       * This helps bots make a decision on the best choice to make.
       */
      calcAttack: function (target_unit, from, target) {
        if (!from)
          from = self.assignment;
        if (!target)
          target = target_unit.assignment;

        let calc     = {};
        let power    = self.power           + self.mPower;
        let armor    = target_unit.armor    + target_unit.mArmor;
        let blocking = target_unit.blocking + target_unit.mBlocking;

        if (data.aLOS && self.getLOSTargetUnit(target, from) !== target_unit) {
          // Armor reduces melee/magic damage.
          calc.damage = Math.round(power * (1 - armor/100));
          if (calc.damage === 0) calc.damage = 1;

          // Another unit is in the way.  No chance to hit target unit.
          calc.chance = 0;
        }
        else if (data.aType === 'melee') {
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
            calc.chance = Math.clamp(100 - blocking, 0, 100);

            // A successful block reduces Chaos Seed blocking temporarily.
            // But, a failed block does not boost Chaos Seed blocking.
            calc.bonus   = 0;
            calc.penalty = 100 - target_unit.blocking;
          }
          else {
            let direction = board.getDirection(from, target_unit.assignment, true);

            if (direction.indexOf(target_unit.direction) > -1) {
              // Hitting a unit from behind always succeeds.
              calc.chance = 100;
            }
            else if (direction.indexOf(board.getRotation(target_unit.direction, 180)) > -1) {
              // Hitting a unit from the front has smallest chance of success.
              calc.chance = Math.clamp(100 - blocking, 0, 100);

              // The target's blocking may be boosted or penalized depending on success.
              calc.bonus   = target_unit.blocking;
              calc.penalty = 100 - target_unit.blocking;
            }
            else {
              // Hitting a unit from the side has improved chance of success.
              calc.chance = Math.clamp(100 - blocking/2, 0, 100);

              // The target's blocking may be boosted or penalized depending on success.
              calc.bonus   = target_unit.blocking;
              calc.penalty = 200 - target_unit.blocking;
            }
          }
        }
        else if (data.aType === 'magic') {
          // Armor reduces magic damage.
          calc.damage = Math.round(power * (1 - armor/100));
          if (calc.damage === 0) calc.damage = 1;

          // Magic can only be stopped by barriers.
          if (target_unit.barriered)
            calc.chance = 0;
          else
            calc.chance = 100;
        }
        else if (data.aType === 'heal') {
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
          calc.effect = data.aType;

          // Not even barriers can stop effects.
          calc.chance = 100;
        }

        return calc;
      },
      getAttackResults: function (action) {
        let results      = [];
        let target       = action.tile;
        let target_units = self.getTargetUnits(target);
        let focusing     = [];

        results.push(...target_units.map(unit => {
          let result = { unit:unit.assignment };
          let calc   = self.calcAttack(unit, self.assignment, target);

          if (calc.effect) {
            if (calc.effect === 'paralyze')
              result.changes = { paralyzed:true };
            else if (calc.effect === 'poisoned')
              result.changes = { poisoned:true };

            if (data.aFocus) {
              focusing.push(unit.assignment);

              result.results = [{
                unit: self.assignment,
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
                  direction: board.getDirection(unit.assignment, self.assignment, unit.direction),
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
              mHealth: Math.clamp(unit.mHealth - calc.damage, -unit.health, 0),
            };

            if (calc.bonus)
              result.changes.mBlocking = unit.mBlocking + calc.bonus;
          }
          else {
            result.miss = 'blocked';

            if (calc.penalty || unit.directional !== false) {
              result.changes = {};

              if (unit.directional !== false)
                result.changes.direction = board.getDirection(unit.assignment, self.assignment, unit.direction);

              if (calc.penalty)
                result.changes.mBlocking = unit.mBlocking - calc.penalty;
            }
          }

          return result;
        }));

        self.getAttackSubResults(results);

        return results;
      },
      /*
       * Apply sub-results that are after-effects of certain results.
       */
      getAttackSubResults: function (results) {
        // Keep track of changes to focus from one result to another.
        let focusingUnits = [];

        results.forEach(result => {
          let unit    = result.unit.assigned;
          let changes = result.changes;

          // Break the focus of attacked units
          if (unit.focusing) {
            if (
              !changes.paralyzed &&
              !changes.poisoned &&
              !('mHealth' in changes && changes.mHealth < unit.mHealth)
            ) return;

            let focusingUnit = focusingUnits.find(fu => fu.unit === unit);
            if (!focusingUnit)
              focusingUnits.push(focusingUnit = {
                unit: unit,
                focusing: unit.focusing.slice(),
              });

            // Skip units that aren't focusing anymore.
            if (focusingUnit.focusing === false) return;

            let subResults = result.results || (result.results = []);
            subResults.push({
              unit: unit.assignment,
              changes: { focusing:false },
            });

            let aType = Tactics.units[unit.type].aType;
            focusingUnit.focusing.forEach(tile => {
              let fUnit = tile.assigned;
              let changes = {};

              if (aType === 'paralyze')
                changes.paralyzed = false;
              else if (aType === 'poisoned')
                changes.poisoned = false;

              subResults.push({
                unit: tile,
                changes: changes,
              });
            });

            focusingUnit.focusing = false;
          }
          // Remove focus from dead units
          else if (unit.paralyzed || unit.poisoned) {
            if (!('mHealth' in changes)) return;
            if (changes.mHealth > -unit.health) return;

            let subResults = [];

            // Find all units that are focusing upon this dead one.
            board.teamsUnits.flat().forEach(fUnit => {
              // Skip units that weren't focusing in the first place.
              if (fUnit.focusing === false) return;

              let focusingUnit = focusingUnits.find(fu => fu.unit === fUnit);
              if (!focusingUnit)
                focusingUnits.push(focusingUnit = {
                  unit: fUnit,
                  focusing: fUnit.focusing.slice(),
                });

              // Skip units that aren't focusing anymore.
              if (focusingUnit.focusing === false) return;

              let focusing = focusingUnit.focusing.filter(tile => tile !== unit.assignment);

              // Skip units that are focusing somewhere else.
              if (focusing.length === focusingUnit.focusing.length) return;

              if (focusing.length === 0)
                focusingUnit.focusing = false;
              else
                focusingUnit.focusing = focusing;

              subResults.push({
                unit: fUnit.assignment,
                changes: { focusing:focusingUnit.focusing },
              });

              if (focusingUnit.focusing === false) {
                let aType = Tactics.units[fUnit.type].aType;
                let changes = {};

                if (aType === 'paralyze')
                  changes.paralyzed = false;
                else if (aType === 'poison')
                  changes.poisoned = false;

                subResults.push({
                  unit: unit.assignment,
                  changes: changes,
                });
              }
            });

            if (subResults.length)
              result.results = subResults;
          }
        });
      },
      // Public methods
      draw: function (direction, assignment) {
        let colorId = self.team.colorId;
        let frames = data.frames.map(frame => self.compileFrame(frame, data));
        let effects = {};

        if (data.effects)
          Object.keys(data.effects).forEach(name => {
            effects[name] =
              data.effects[name].frames.map(frame => self.compileFrame(frame, data.effects[name]));
          });

        self.frames = frames;
        self.effects = effects;
        self.color = colorId === null ? 0xFFFFFF : Tactics.colors[colorId];
        self.assign(assignment);
        self.stand(self.directional === false ? 'S' : direction);

        return self;
      },
      compileFrame: function (frame, data) {
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
              shape.image = 'https://legacy.taorankings.com/units/'+type+'/image'+shape.id+'.png';
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
            sprite.tint = self.color;

          if (shape.name === 'shadow') {
            sprite.alpha = 0.5;
            sprite.inheritTint = false;
          }

          container.addChild(sprite);
        });

        return container;
      },
      drawAvatar: function () {
        return self.compileFrame(data.frames[data.stills.S], data);
      },
      drawFrame: function (index, context) {
        let frame = self.frames[index];
        let focus;

        if (self.frame) {
          focus = self.hideFocus();
          pixi.removeChild(self.frame);
        }
        if (!frame)
          return;

        pixi.addChildAt(self.frame = frame, 0);
        if (focus)
          self.showFocus(focus.alpha);

        if (context)
          pixi.position = context.getCenter().clone();

        if (frame.data) {
          // Reset Normal Appearance
          if (data.width && data.height) {
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
              sprite.filters = Object.keys(self.filters).map(name => self.filters[name]);

            // Legacy
            if (sprite.data.t)
              sprite.tint = sprite.data.t;
            else if (sprite.data.name === 'trim')
              sprite.tint = self.color;
            else
              sprite.tint = 0xFFFFFF;
          });
        }

        return self;
      },
      drawTurn: function (direction) {
        if (!direction) direction = self.direction;
        if (!isNaN(direction)) direction = board.getRotation(self.direction, direction);

        self.drawFrame(data.turns[direction]);
      },
      drawStand: function (direction) {
        if (self.directional === false)
          direction = 'S';
        else {
          if (!direction) direction = self.direction;
          if (!isNaN(direction)) direction = board.getRotation(self.direction, direction);
        }

        self.drawFrame(data.stills[direction]);
      },
      getSpritesByName: function (name) {
        return self.frame.children.filter(s => s.data && s.data.name === name);
      },
      offsetFrame: function (offset, direction) {
        let frame = self.frame;
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

        return self;
      },
      assign: function (assignment) {
        if (self.assignment && self.assignment.assigned === self) self.assignment.dismiss();
        self.assignment = assignment;

        if (assignment) {
          assignment.assign(self);
          pixi.position = assignment.getCenter().clone();
        }

        return self;
      },
      /*
       * Specify the relative direction using "degrees" of rotation, e.g. 90.
       * - OR -
       * Specify the absolute direction, e.g. 'N'.
       */
      stand: function (direction) {
        if (self.directional === false)
          direction = 'S';
        else {
          if (!direction) direction = self.direction;
          if (!isNaN(direction)) direction = board.getRotation(self.direction, direction);
        }

        self.drawStand(direction);
        self.direction = direction;
      },
      /*
       * This is called before a focusing unit moves, attacks, or turns.
       */
      breakFocus: function (action) {
        return self;
      },
      // Animate from one tile to the next
      move: function (action) {
        return self.animMove(action.tile).play();
      },
      attack: function (action) {
        throw new Error('Unit type needs to implement attack()');
      },
      attackSpecial: function (action) {
        throw new Error('Unit type needs to implement attackSpecial()');
      },
      turn: function (action) {
        if (self.directional === false) return self;

        return self.animTurn(action.direction).play();
      },
      shock: function (direction, frameId, block) {
        let anchor = self.assignment.getCenter();
        let frame;

        if (shock) {
          stage.children[1].removeChild(shock);
          shock = undefined;
        }

        if (direction) {
          shock = new PIXI.Container();
          shock.addChild(frame = shocks[frameId]);
          shock.position = anchor.clone();
          shock.position.y += 4; // ensure shock graphic overlaps unit.

          stage.children[1].addChild(shock);

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

        return self;
      },
      brightness: function (intensity, whiteness) {
        let name = 'brightness';
        let filter;
        let matrix;

        if (intensity === 1 && !whiteness) {
          setFilter(name, undefined);
        }
        else {
          filter = setFilter(name, 'ColorMatrixFilter')
          filter.brightness(intensity)

          if (whiteness) {
            matrix = filter.matrix;
            matrix[1 ] = matrix[2 ] =
            matrix[5 ] = matrix[7 ] =
            matrix[10] = matrix[11] = whiteness;
          }
        }

        return self;
      },
      whiten: function (intensity) {
        let name = 'whiten';
        let matrix;

        if (!intensity) {
          setFilter(name, undefined);
        }
        else {
          matrix = setFilter(name, 'ColorMatrixFilter').matrix;
          matrix[3] = matrix[8] = matrix[13] = intensity;
        }

        return self;
      },
      /*
       * Add color to the unit's base and trim.
       * Example, increase the redness by 128 (0x880000).
       *   self.colorize(0xFF0000, 0.5);
       */
      colorize: function (color, lightness) {
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
          setFilter(name, undefined);
        }
        else {
          matrix = setFilter(name, 'ColorMatrixFilter').matrix;
          matrix[3]  = color[0];
          matrix[8]  = color[1];
          matrix[13] = color[2];
        }

        return self;
      },
      focus: function (viewed) {
        if (self.focused) return;
        self.focused = true;

        return self.assignment.painted === 'focus' && !pulse && !viewed ? startPulse(6) : self;
      },
      blur: function () {
        if (!self.focused) return self;
        self.focused = false;

        return pulse && !self.activated ? stopPulse() : self;
      },
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
      activate: function (mode, view_only) {
        mode = mode || self.activated || true;
        if (self.activated === mode) return;

        self.activated = mode;

        return view_only ? self : startPulse(4, 2);
      },
      deactivate: function () {
        if (!self.activated) return self;
        self.activated = false;

        return stopPulse();
      },
      change: function (changes) {
        if (typeof changes.paralyzed === 'boolean')
          changes.paralyzed = self.paralyzed + (changes.paralyzed ? 1 : -1);

        Object.assign(self, changes);

        self.emit({type:'change', changes:changes});

        return self;
      },
      hasFocus: function () {
        return !!self.getSpritesByName('focus')[0];
      },
      showFocus: function (alpha) {
        let focus = self.getSpritesByName('focus')[0];

        if (!focus) {
          focus = self.compileFrame(Tactics.effects.focus.frames[0], Tactics.effects.focus);
          focus.data = {name: 'focus'};
          focus.children.forEach(sprite => sprite.tint = self.color);
          focus.alpha = alpha || 1;

          self.frame.addChildAt(focus, 1);
        }
        else
          focus.alpha = alpha || 1;

        return self;
      },
      hideFocus: function () {
        let focus = self.getSpritesByName('focus')[0];
        if (focus)
          self.frame.removeChild(focus);

        return focus;
      },
      animFocus: function () {
        let anim   = new Tactics.Animation();
        let alphas = [0.125, 0.25, 0.375, 0.5];
        let focus  = self.getSpritesByName('focus')[0];

        if (!focus) {
          focus = self.compileFrame(Tactics.effects.focus.frames[0], Tactics.effects.focus);
          focus.data = {name: 'focus'};
          focus.children.forEach(sprite => sprite.tint = self.color);

          anim.addFrame(() => self.frame.addChildAt(focus, 1));
        }

        anim.splice(0, {
          script: frame => focus.alpha = alphas[frame.repeat_index],
          repeat: alphas.length,
        });

        return anim;
      },
      animDefocus: function () {
        let anim = new Tactics.Animation();
        let alphas = [0.375, 0.25, 0.125];
        let focus = self.getSpritesByName('focus')[0];

        anim.addFrame({
          script: frame => focus.alpha = alphas[frame.repeat_index],
          repeat: alphas.length,
        });
        anim.addFrame(() => self.frame.removeChild(focus));

        return anim;
      },
      animPulse: function (steps, speed) {
        let step = steps;
        let stride = 0.1 * (speed || 1);

        return new Tactics.Animation({
          loop:   true,
          frames: [
            {
              script: () => self.brightness(1 + (step-- * stride)),
              repeat: steps,
            },
            {
              script: () => self.brightness(1 + (step++ * stride)),
              repeat: steps,
            }
          ]
        });
      },
      /*
       * Right now, the default expectation is units walk from A to B.
       */
      animMove: function (assignment) {
        return self.animWalk(assignment);
      },
      /*
       * Units turn in the direction they are headed before they move there.
       * This method returns an animation that does just that, if needed.
       */
      animTurn: function (direction) {
        let anim = new Tactics.Animation();

        // Do nothing if already facing the desired direction
        if (!direction || direction === self.direction) return anim;

        // If turning to the opposite direction, first turn right.
        if (direction === board.getRotation(self.direction, 180))
          anim.addFrame(() => self.drawTurn(90));

        // Now stand facing the desired direction.
        anim.addFrame(() => self.stand(direction));

        return anim;
      },
      animWalk: function (assignment) {
        let anim        = new Tactics.Animation();
        let path        = board.findPath(self, assignment);
        let frame_index = 0;

        anim.addFrame(() => self.assignment.dismiss());

        // Turn frames are not typically required while walking unless the very
        // next tile is in the opposite direction of where the unit is facing.
        let direction = board.getDirection(self.assignment, path[0]);
        if (direction === board.getRotation(self.direction, 180))
          anim.splice(frame_index++, () => self.drawTurn(90));

        // Keep track of what direction units face as they step out of the way.
        let step_directions = [];

        path.forEach((to_tile, i) => {
          let from_tile = i === 0 ? self.assignment : path[i-1];

          // Determine the direction of the next tile and turn in that direction.
          let direction = board.getDirection(from_tile, to_tile);
          let walks     = data.walks[direction];

          // Walk to the next tile
          let indexes = [];
          for (let index = data.walks[direction][0]; index <= data.walks[direction][1]; index++) {
            indexes.push(index);
          }
          indexes.forEach(index =>
            anim.splice(frame_index++, () => self.drawFrame(index, from_tile))
          );

          // Do not step softly into that good night.
          anim.splice([-8, -4], () => sounds.step.play());

          // Make any units before us step out of the way.
          let to_unit;
          if (to_unit = to_tile.assigned) {
            let next_tile = path[i+1];
            // The unit needs to back up in a direction that isn't in our way.
            let bad_directions = [direction, board.getDirection(next_tile, to_tile)];

            // Find the first available direction in preference order.
            let to_direction = [
              to_unit.direction,
              board.getRotation(to_unit.direction,  90),
              board.getRotation(to_unit.direction, -90),
            ].find(direction => bad_directions.indexOf(direction) === -1);

            step_directions.push(to_direction);
            anim.splice(-8, to_unit.animStepBack(to_direction));
          }

          // Make any units behind us step back into position.
          let from_unit;
          if ((from_unit = from_tile.assigned) && from_unit !== self)
            anim.splice(-5, from_unit.animStepForward(step_directions.pop()));

          // If this is our final destination, stand ready
          if (to_tile === assignment)
            anim.addFrame(() => self.assign(assignment).stand(direction));
        });

        return anim;
      },
      animStepBack: function (direction) {
        let anim = new Tactics.Animation();

        let indexes = [];
        for (let index = data.backSteps[direction][0]; index <= data.backSteps[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach(index => anim.addFrame(() => self.drawFrame(index)));

        // Don't just be grumpy.  Stomp your grumpiness.
        anim.splice([3, 5], () => sounds.step.play());

        return anim;
      },
      animStepForward: function (direction) {
        let anim = new Tactics.Animation();

        let indexes = [];
        for (let index = data.foreSteps[direction][0]; index <= data.foreSteps[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach(index => anim.addFrame(() => self.drawFrame(index)));

        anim.addFrame(() => self.drawStand());

        // One final stomp for science
        anim.splice(0, () => sounds.step.play());

        return anim;
      },
      animAttack: function (direction) {
        let anim = new Tactics.Animation();

        if (!direction) direction = self.direction;

        let indexes = [];
        for (let index = data.attacks[direction][0]; index <= data.attacks[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach(index => anim.addFrame(() => self.drawFrame(index)));

        anim.addFrame(() => self.stand(direction));

        return anim;
      },
      animBlock: function (attacker) {
        let anim = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, attacker.assignment, self.direction);

        anim.addFrame(() => sounds.block.play());
        if (self.directional !== false)
          anim.splice(0, () => self.direction = direction);

        if (data.blocks) {
          let indexes = [];
          for (let index = data.blocks[direction][0]; index <= data.blocks[direction][1]; index++) {
            indexes.push(index);
          }
          indexes.forEach((index, i) => anim.splice(i, () => self.drawFrame(index)));

          // Kinda hacky.  It seems that shocks should be rendered by the attacker, not defender.
          if (attacker.type === 2)
            anim.splice(1, [
              () => self.shock(direction, 1, true),
              () => self.shock(direction, 2, true),
              () => self.shock(),
            ]);
          else
            anim.splice(1, [
              () => self.shock(direction, 0, true),
              () => self.shock(direction, 1, true),
              () => self.shock(direction, 2, true),
              () => self.shock(),
            ]);
        }

        if (self.directional !== false)
          anim.addFrame(() => self.stand(direction));

        return anim;
      },
      animReadySpecial: function () {
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
            self.frame.position.x * -1,
            self.frame.position.y * -1,
          );

          // Insert the shape right after the shadow
          self.frame.addChildAt(container, 1);
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
            if (self.frame.children[2].filters)
              container.filters = [blurFilter].concat(self.frame.children[2].filters);
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
          if (self.frame.children[2].filters)
            container.filters = [blurFilter].concat(self.frame.children[2].filters);
          else
            container.filters = [blurFilter];
        });

        anim.on('stop', event => {
          self.frame.removeChild(container);
        });

        return anim;
      },
      animStrike: function (defender) {
        let anim = new Tactics.Animation();
        let direction = board.getDirection(
          defender.assignment,
          self.assignment,
          board.getRotation(self.direction, 180),
        );

        return anim.addFrames([
          () => sounds.strike.play(),
          () => defender.shock(direction, 0),
          () => defender.shock(direction, 1),
          () => defender.shock(direction, 2),
          () => defender.shock(),
        ]);

        return anim;
      },
      animStagger: function (attacker) {
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(attacker.assignment, self.assignment, self.direction);

        anim.addFrames([
          () =>
            self
              .drawFrame(data.turns[self.direction])
              .offsetFrame(0.06, direction),
          () =>
            self
              .drawFrame(data.turns[self.direction])
              .offsetFrame(-0.02, direction),
          () =>
            self.drawStand(),
        ]);

        return anim;
      },
      animDeath: function () {
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
            () => {
              if (self.assignment.painted === 'focus') self.assignment.strip();
              board.dropUnit(self);
            }
          ])
          .splice(0, {
            script: () => {
              container.children[0].children.forEach(c => c.tint = self.color);
            },
            repeat:8
          });

        return anim;
      },
      animLightning: function (target) {
        let anim      = new Tactics.Animation();
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
            stage.children[1].addChild(container);
          },
          () => {},
          {
            script: () => {
              if (strike) container.removeChild(strike);
              if (strikes.length)
                strike = container.addChild(strikes.shift());
              else
                stage.children[1].removeChild(container);
            },
            repeat: 7,
          }
        ]);

        if (tunit)
          anim
            .splice(2, tunit.animStagger(self,tunit.direction))
            .splice(2, {
              script: () => tunit.whiten(whiten.shift()),
              repeat: 6,
            });

        return anim;
      },
      animHeal: function (target_units) {
        let anim = new Tactics.Animation();

        if (!Array.isArray(target_units)) target_units = [target_units];

        anim.addFrame(() => sounds.heal.play());

        target_units.forEach(tunit => {
          // Apply sparkles in a few shuffled patterns
          [{x:-18,y:-52},{x:0,y:-67},{x:18,y:-52}].shuffle().forEach((pos, i) => {
            anim.splice(i*3+1, self.animSparkle(tunit.pixi, pos));
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
      },
      animSparkle: function (parent, pos) {
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
      },
      animCaption: function (caption, options) {
        if (options === undefined)
          options = {};
        if (options.color === undefined)
          options.color = 'white';

        return animText(
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
      },
      setTargetNotice: function (target_unit, target) {
        let calc = self.calcAttack(target_unit, null, target);
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
      },
      validateAction: function (action) {
        let validate = 'validate'+action.type.capitalize()+'Action';

        if (validate in self)
          return self[validate](action);

        return null;
      },
      validateMoveAction: function (validate) {
        let action = { type:'move', unit:validate.unit };

        if (validate.direction && self.directional === false)
          return null;

        if (!validate.tile)
          return null;

        let tiles = self.getMoveTiles();
        if (!tiles.find(tile => tile === validate.tile))
          return null;

        action.tile = validate.tile;

        // TODO: Validate and generate direction after moving.

        return action;
      },
      validateAttackAction: function (validate) {
        let action = { type:'attack', unit:validate.unit };

        if (validate.direction && self.directional === false)
          return null;

        if (data.aAll) {
          // Tile data is forbidden when attacking all tiles.
          if (validate.tile)
            return null;

          // Not opinionated on presence or absense of 'direction'
        }
        else {
          // Tile data is required when not attacking all tiles.
          if (!validate.tile)
            return null;

          let tiles = self.getAttackTiles();
          if (!tiles.find(tile => tile === validate.tile))
            return null;

          if (validate.direction) {
            let direction = board.getDirection(self.assignment, validate.tile);
            if (direction.indexOf(validate.direction) === -1)
              return null;

            if (validate.direction !== self.direction)
              action.direction = direction;
          }
          else {
            let direction = board.getDirection(self.assignment, validate.tile, self.direction);
            if (direction !== self.direction)
              action.direction = direction;
          }

          action.tile = validate.tile;
        }

        action.results = self.getAttackResults(action);

        return action;
      },
      validateAttackSpecialAction: function (validate) {
        let action = { type:'attackSpecial', unit:validate.unit };

        if (!self.canSpecial)
          return null;

        action.results = self.getAttackSpecialResults(action);

        return action;
      },
      validateTurnAction: function (validate) {
        let action = { type:'turn', unit:validate.unit };

        if (self.directional === false)
          return null;

        if (!validate.direction)
          return null;

        if (validate.direction === self.direction)
          return null;

        action.direction = validate.direction;

        return action;
      },
      canSpecial: function () {
        return false;
      },
      canCounter: function () {
        return false;
      },
      isPassable: function () {
        return self.focusing === false && !self.paralyzed && self.mPass !== false;
      },
    });

    /*
     * Applies and returns a new filter to the base and trim sprites.
     * If the filter name already exists, it just returns it.
     */
    function setFilter(name, type) {
      let filters = self.filters;

      if (type) {
        if (!(name in filters)) {
          filters[name] = new PIXI.filters[type]();

          self.frame.children.forEach(child => {
            if ('data' in child)
              if (child.data.name === 'base' || child.data.name === 'trim')
                child.filters = Object.keys(filters).map(n => filters[n]);
          });
        }
      }
      else {
        if (name in filters) {
          delete filters[name];

          self.frame.children.forEach(child => {
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

    function startPulse(steps, speed) {
      if (pulse) stopPulse();

      pulse = self.animPulse(steps,speed);
      pulse.play().then(() => self.brightness(1));

      return self;
    }

    function stopPulse() {
      if (!pulse) return self;

      pulse.stop();
      pulse = null;

      return self;
    }

    function animText(text, style, options) {
      let anim = new Tactics.Animation();
      let container = new PIXI.Container();
      let w = 0;

      options = options || {};

      text.split('').forEach((v, i) => {
        let letter = new PIXI.Text(v, style);
        letter.position.x = w;
        w += letter.width;

        anim.splice(i, () => container.addChild(letter));
        anim.splice(i, animLetter(letter));
      });

      container.position = new PIXI.Point(-((w / 2) | 0),-71);
      container.position.x += options.x || 0;
      container.position.y += options.y || 0;

      anim
        .splice(0, () => pixi.addChild(container))
        .splice(() => pixi.removeChild(container));

      return anim;
    }

    function animLetter(letter) {
      return new Tactics.Animation({frames: [
        () => letter.position.y -= 7,
        () => letter.position.y -= 2,
        () => letter.position.y += 1,
        () => letter.position.y += 2,
      ]});
    }

    return data.extend ? data.extend(self) : self;
  };
})();
