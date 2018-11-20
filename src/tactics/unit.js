(function () {
  'use strict';

  const HALF_TILE_HEIGHT = 28;

  var turns;
  var turnsUnit;
  var hideTurnOptions;

  function prerender_turns() {
    turns = new PIXI.Container();

    hideTurnOptions = function () {
      if (Tactics.stage.children.indexOf(turns) > -1) Tactics.stage.removeChild(turns);

      return self;
    };

    let selectTurnEvent = event => {
      Tactics.sounds.select.play();

      hideTurnOptions();
      event.currentTarget.filters = null;

      turnsUnit.turn(event.target.data.direction);
      turnsUnit.turned = true;

      Tactics.board.setSelectMode('ready');
      Tactics.render();
    };
    let focusTurnEvent = event => {
      Tactics.sounds.focus.play();

      let filter = new PIXI.filters.ColorMatrixFilter();
      filter.brightness(1.75);
      event.currentTarget.filters = [filter];

      Tactics.render();
    };
    let blurTurnEvent = event => {
      event.currentTarget.filters = null;

      Tactics.render();
    };

    ['turn_tl.png','turn_tr.png','turn_bl.png','turn_br.png'].forEach((image, i) => {
      let sprite = new PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/'+image);
      sprite.interactive = true;
      sprite.buttonMode  = true;
      sprite.click       = selectTurnEvent;
      sprite.tap         = selectTurnEvent;
      sprite.mouseover   = focusTurnEvent;
      sprite.mouseout    = blurTurnEvent;

      if (i == 0) {
        sprite.position = new PIXI.Point(1,0);
        sprite.data = {direction:'N'};
      }
      else if (i == 1) {
        sprite.position = new PIXI.Point(55,0);
        sprite.data = {direction:'E'};
      }
      else if (i == 2) {
        sprite.position = new PIXI.Point(0,30);
        sprite.data = {direction:'W'};
      }
      else if (i == 3) {
        sprite.position = new PIXI.Point(55,30);
        sprite.data = {direction:'S'};
      }

      turns.addChild(sprite);
    });
  }

  var shocks;

  function prerender_shocks() {
    shocks = [
      new PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/shock.png'),
      new PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/shock.png'),
      new PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/shock.png')
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
    if (turns === undefined) {
      prerender_turns();
      prerender_shocks();
    }

    var self = this;
    var pixi = new PIXI.Container();
    var data = Tactics.units[type];
    var board = Tactics.board;
    var pulse;
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var stills = data.stills;
    var shock;
    var deployEvent = event => {
      board.lock();
      self.deploy(event.target).then(() => {
        board
          .setSelectMode(self.attacked ? 'turn' : 'attack')
          .unlock();
      });
    };
    var deployFocusEvent  = event => event.target.pixi.alpha = 0.6;
    var deployBlurEvent   = event => event.target.pixi.alpha = 0.3;
    var attackSelectEvent = event => {
      let tile = event.target;

      board.clearHighlight();

      self.activated = 'target';
      self.highlightTarget(tile);
    };

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
      notice:    undefined,
      activated: false,
      focused:   false,
      origin:    {},
      deployed:  false,
      attacked:  false,
      turned:    false,

      mPass:   data.mPass,
      mRadius: data.mRadius,
      aRadius: data.aRadius,

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

      poisoned:  false,
      paralyzed: false,
      barriered: false,

      getMoveTiles: function (start) {
        var tiles = [];
        var x,y;
        var r = data.mRadius;
        var cx, cy;
        var tile;
        var path;

        start = start || self.assignment;
        cx    = start.x;
        cy    = start.y;

        for (x = cx-r; x <= cx+r; x++) {
          for (y = cy-r; y <= cy+r; y++) {
            if (!(tile = board.getTile(x, y))) continue;
            if (tile.assigned) continue;
            if (board.getDistance(start, tile) > r) continue;

            if (!(path = self.findPath(tile))) continue;
            if (path.length > r) continue;

            tiles.push(tile);
          }
        }

        return tiles;
      },
      getAttackTiles: function (start) {
        var tiles = [];
        var x,y;
        var r = data.aRadius;
        var cx,cy;
        var tile;

        start = start || self.assignment;
        cx    = start.x;
        cy    = start.y;

        for (x=cx-r; x<=cx+r; x++) {
          for (y=cy-r; y<=cy+r; y++) {
            if (data.aLinear && x != cx && y != cy) continue;
            if (!(tile = board.getTile(x,y))) continue;
            if (tile === start) continue;
            if (board.getDistance(start,tile) > r) continue;

            tiles.push(tile);
          }
        }

        return tiles;
      },
      targetLOS: function (target,from) {
        var x,y;
        from = from || self.assignment;

        // Any way to make this more efficient?

        // Horizontal
        if (target.x === from.x) {
          if (target.y > from.y) {
            for (y=from.y+1; y<target.y; y++) {
              tile = board.getTile(target.x,y);
              if (tile.assigned) return tile;
            }
          }
          else {
            for (y=from.y-1; y>target.y; y--) {
              tile = board.getTile(target.x,y);
              if (tile.assigned) return tile;
            }
          }
        }
        // Vertical
        else if (target.y === from.y) {
          if (target.x > from.x) {
            for (x=from.x+1; x<target.x; x++) {
              tile = board.getTile(x,target.y);
              if (tile.assigned) return tile;
            }
          }
          else {
            for (x=from.x-1; x>target.x; x--) {
              tile = board.getTile(x,target.y);
              if (tile.assigned) return tile;
            }
          }
        }

        return target;
      },
      calcAttack: function (target_unit, from) {
        if (from === undefined)
          from = self.assignment;

        let direction;
        let calc = {
          damage:      Math.round((self.power+self.mPower) * (1 - (target_unit.armor+target_unit.mArmor)/100)),
          block:       target_unit.blocking + target_unit.mBlocking,
          chance:      100,
          penalty:     0,
          bonus:       0,
          unblockable: true,
        };

        if (calc.damage === 0) calc.damage = 1;

        if (data.aLOS && self.targetLOS(target_unit.assignment,from) !== target_unit.assignment) {
          calc.chance = 0;
          calc.unblockable = false;
          return calc;
        }

        if (data.aType === 'melee') {
          if (target_unit.directional !== false) {
            direction = board.getDirection(from || self.assignment,target_unit.assignment);

            if (direction.indexOf(target_unit.direction) > -1) {
              calc.block = 0;
              return calc;
            }
            else if (direction.indexOf(board.getRotation(target_unit.direction,180)) > -1) {
              calc.penalty = 100-target_unit.blocking;
            }
            else {
              calc.block /= 2;
              calc.penalty = 200-target_unit.blocking;
            }
            calc.bonus = target_unit.blocking;
          }

          if (calc.block <   0) calc.block = 0;
          if (calc.block > 100) calc.block = 100;
          calc.chance = 100 - calc.block;
          calc.unblockable = false;
        }

        return calc;
      },
      /*
       * Once player vs player is implemented, this needs to be delegated to the
       * game server to prevent cheating since luck is involved.
       */
      calcAttackResults: function (target_units) {
        if (!Array.isArray(target_units))
          target_units = [target_units];

        return target_units.map(unit => {
          let result = {unit: unit};

          if (unit.barriered)
            return Object.assign(result, {miss: true});

          let calc = self.calcAttack(unit);
          let luck = Math.random() * 100;

          if (luck < calc.block)
            return Object.assign(result, {
              miss:      true,
              blocked:   true,
              mBlocking: unit.mBlocking - calc.penalty,
            });

          return Object.assign(result, {
            mHealth:   Math.max(unit.mHealth - calc.damage, -unit.health),
            mBlocking: unit.mBlocking + calc.bonus,
          });
        });
      },
      // Obtain the maximum threat to the unit before he recovers.
      calcDefense: function (turns) {
        var damages = [],damage = 0,threat;
        var i,j,units,unit,cnt,turns;

        if (!turns) turns = board.turns;

        for (i=0; i<board.teams.length; i++) {
          damages.push([]);

          // Don't consider allies or friends or self.
          if (board.teams[i].color === board.teams[self.team].color) continue;
          units = board.teams[i].units;

          for (j=0; j<units.length; j++) {
            unit = units[j];
            cnt = unit.calcThreatTurns(self,1);

            if (cnt  >  self.mRecovery) continue;
            if (cnt === self.mRecovery && turns.indexOf(i) > turns.indexOf(self.team)) continue;
            threat = unit.calcThreat(self,null,turns);
            if (threat.damage)
              damages[i].push({
                unit:   unit,
                turns:  threat.turns+1-unit.mRecovery,
                damage: threat.damage
              });
          }

          damages[i].sort((a, b) => (b.damage - a.damage) || (a.turns - b.turns));
        }

        for (i=0; i<damages.length; i++) {
          if (!damages[i].length) continue;

          // The number of times they can attack before recovery.
          cnt = self.mRecovery;
          // We can attack one more time if enemy turn comes first.
          if (turns.indexOf(i) < turns.indexOf(self.team)) cnt++;

          for (j=0; j<damages[i].length; j++) {
            // Only attackers that can attack before he moves again count.
            if (!cnt) break;

            if (damages[i][j].turns > cnt) continue;

            damage += damages[i][j].damage;
            cnt -= damages[i][j].turns;
          }
        }

        return damage > 100 ? 0 : 100 - damage;
      },
      // How many turns until I can attack?
      // -1 may be returned if no movement required (unless simple is set)
      calcThreatTurns: function (target, simple) {
        var turns = Math.ceil((board.getDistance(self.assignment,target.assignment) - self.aRadius) / self.mRadius) - 1;

        if (turns < 0 && (self.mRecovery || simple))
          return self.mRecovery;

        return turns+self.mRecovery;
      },
      calcThreats: function (target, limit) {
        var threats = [];
        var directions = ['N','S','E','W'];
        var tile,calc,threat;

        //if (self.mRecovery > target.mRecovery) return;
        //if (self.mRecovery === target.mRecovery && board.turns.indexOf(self.team) > board.turns.indexOf(target.team)) return;

        for (i=0; i<directions.length; i++) {
          if (!(tile = target.assignment[directions[i]])) continue;

          if (tile.assigned) {
            if (tile.assigned !== self) continue;
          }
          else {
            if (board.getDistance(self.assignment,tile) > mRadius) continue;
            if (!(path = self.findPath(tile))) continue;
            if (path.length > mRadius) continue;
          }

          calc = self.calcAttack(target,tile);
          threat = Math.abs(calc.damage) / (target.health+target.mHealth) * 100;
          if (threat > 100) threat = 100;

          // Factor in the chance that the attack may not hit.
          if (calc.chance < 100) {
            threat *= calc.chance / 100;

            // Factor in the future benefit of getting additional blocking chance.
            // Actually, if we get hit, we lose blocking chance.  So now what?
            //if (threat < 100)
            //  threat *= 1 - target.blocking/400;
          }

          threats.push({tile:tile,threat:threat});
        }

        if (!threats.length) return;

        return threats.sort(function (a,b) { return b.threat-a.threat; });
      },
      calcThreat: function (target,tile,turns) {
        var calc = {};
        var tdirection = target.direction;
        var path,cnt,attack;
        var directions = [
          board.getRotation(tdirection,180),
          board.getRotation(tdirection,90),
          board.getRotation(tdirection,270),
          tdirection
        ];

        if (!tile) {
          if (!turns) turns = board.turns;

          for (i=0; i<directions.length; i++) {
            if (!(tile = target.assignment[directions[i]])) continue;

            if (tile.assigned) {
              if (tile.assigned == self) {
                cnt = 0;
                path = [];
                break;
              }
              continue;
            }

            if (!(path = self.findPath(tile))) continue;

            cnt = Math.ceil(path.length / self.mRadius)-1;

            if (target.mRecovery  >  cnt) break;
            if (target.mRecovery === cnt && turns.indexOf(target.team) > turns.indexOf(self.team)) break;

            path = null;
          }

          if (!path) return {damage:0,threat:0,from:null,turns:null,chance:0};
          tile = path.pop() || self.assignment;
        }

        attack = self.calcAttack(target,tile);

        calc.from = tile;
        calc.turns = cnt;
        calc.chance = attack.chance;
        calc.damage = (attack.damage / target.health) * 100;
        if (calc.damage > 100) calc.damage = 100;

        calc.threat = (attack.damage / (target.health+target.mHealth)) * 100;
        if (calc.threat > 100) calc.threat = 100;

        // Factor in the chance that the attack may not hit.
        if (attack.chance < 100) {
          calc.damage *= attack.chance / 100;
          calc.threat *= attack.chance / 100;

          // Factor in the future benefit of getting additional blocking chance.
          // Actually, if we get hit, we lose blocking chance.  So now what?
          //if (threat < 100)
          //  threat *= 1 - target.blocking/400;
        }

        return calc;
      },
      // Public methods
      draw: function (direction, assignment) {
        let color = board.teams[self.team].color;
        let frames = [];

        for (let i = 0; i < data.frames.length; i++) {
          frames[i] = self.compileFrame(i);
        }

        self.frames = frames;
        self.color = color === null ? 0xFFFFFF : Tactics.colors[color];
        self.assign(assignment);
        self.direction = direction;
        self.origin = {tile:assignment,direction:direction};

        return self.drawFrame(stills[self.directional === false ? 'S' : direction]);
      },
      compileFrame: function (index) {
        var container = new PIXI.Container();
        var frame = data.frames[index];

        if (!frame) return container;
        container.data = frame;

        if (data.width && data.height) {
          container.position = new PIXI.Point(
            Math.floor(-(data.width / 2)),
            Math.floor(-(data.height / 2) - HALF_TILE_HEIGHT),
          );

          // Finicky
          let offset = data.frames_offset || {};
          container.position.x += offset.x || 0;
          container.position.y += offset.y || 0;
        }
        else // Legacy
          container.position = new PIXI.Point(frame.x||0,(frame.y||0)-2);

        container.alpha = 'a' in frame ? frame.a : 1;

        let shapes;
        if (frame.c)
          shapes = frame.c;
        else
          shapes = frame;

        shapes.forEach(shape => {
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
              shape.image = 'http://www.taorankings.com/html5/units/'+type+'/image'+shape.id+'.png';
              delete shape.id;
            }
            else {
              console.error('shape', shape);
              throw new Error('Frames without images are not supported');
            }

            if (shape.n === 's' || shape.n === 'shadow')
              shape.name = 'shadow';
            if (shape.n === 'b' || shape.n === 'base')
              shape.name = 'base';
            if (shape.n === 't' || shape.n === 'trim')
              shape.name = 'trim';
            delete shape.n;

            // Legacy translation
            if ('a' in shape) {
              shape.am = shape.a;
              delete shape.a;
            }
          }

          /*
           * Configure a sprite using shape data
           */
          var sprite = PIXI.Sprite.fromImage(shape.image);
          sprite.data = shape;
          sprite.position = new PIXI.Point(shape.x, shape.y);
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
        return self.compileFrame(stills.S);
      },
      drawFrame: function (index, context) {
        var frame;

        if (self.frame) pixi.removeChild(self.frame);
        pixi.addChildAt(self.frame = frame = self.frames[index], 0);

        if (context)
          pixi.position = context.getCenter().clone();

        if (frame.data) {
          // Reset Normal Appearance
          if (data.width && data.height) {
            frame.position.x = Math.floor(-(data.width/2));
            frame.position.y = Math.floor(-(data.height/2) - HALF_TILE_HEIGHT);

            // Finicky
            let offset = data.frames_offset || {};
            frame.position.x += offset.x || 0;
            frame.position.y += offset.y || 0;
          }
          else { // Legacy
            frame.position.x = frame.data.x || 0;
            frame.position.y = (frame.data.y || 0) - 2;
          }

          frame.filters = null;
          frame.tint = 0xFFFFFF;

          frame.children.forEach(sprite => {
            sprite.filters = null;

            // Legacy
            if (sprite.data.t)
              sprite.tint = sprite.data.t;
            else if (sprite.data.name === 'trim')
              sprite.tint = self.color;
            else
              sprite.tint = 0xFFFFFF;
          });
        }

        self.filters = {};

        return self;
      },
      offsetFrame: function (offset, direction) {
        var frame = self.frame;
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
      highlightDeployOptions: function () {
        self.getMoveTiles().forEach(tile => {
          board.setHighlight({
            action: 'deploy',
            tile:   tile,
            color:  0x0088FF,
            select: deployEvent,
            focus:  deployFocusEvent,
            blur:   deployBlurEvent
          }, self.viewed);

          if (tile.focused) deployFocusEvent({target:tile});
        });

        return self;
      },
      highlightAttack: function () {
        self.getAttackTiles().forEach(tile => {
          board.setHighlight({
            action: 'attack',
            tile:   tile,
            color:  0xFF8800,
            select: attackSelectEvent,
            focus:  self.onAttackFocus,
            blur:   self.onAttackBlur,
          }, self.viewed);

          if (!self.viewed && tile.focused) self.onAttackFocus({target:tile});
        });

        return self;
      },
      highlightTarget: function (target) {
        board.setHighlight({
          action: 'target',
          tile:   target,
          color:  0xFF3300,
          select: self.onTargetSelect,
          focus:  self.onAttackFocus,
          blur:   self.onAttackBlur,
        }, self.viewed);

        if (target.focused) self.onAttackFocus({target:target});
        if (target.assigned) target.assigned.activate();

        return self;
      },
      showTurnOptions: function () {
        if (self.viewed) return self.showDirection();

        turnsUnit = self;
        turns.position = self.assignment.getCenter().clone();
        turns.position.x -= 43;
        turns.position.y -= 70;

        turns.children.forEach(arrow => {
          arrow.interactive = arrow.buttonMode = true;
          arrow.visible = true;
        });

        if (Tactics.stage.children.indexOf(turns) === -1)
          Tactics.stage.addChild(turns);

        return self;
      },
      showDirection: function () {
        turns.position = self.assignment.getCenter().clone();
        turns.position.x -= 43;
        turns.position.y -= 70;

        turns.children.forEach(arrow => {
          arrow.interactive = arrow.buttonMode = false;
          arrow.visible = self.directional === false || arrow.data.direction == self.direction;
        });

        if (Tactics.stage.children.indexOf(turns) === -1)
          Tactics.stage.addChild(turns);

        return self;
      },
      assign: function (assignment) {
        if (self.assignment) self.assignment.dismiss();
        self.assignment = assignment.assign(self);

        pixi.position = assignment.getCenter().clone();

        return self;
      },
      // Animate from one tile to the next
      deploy: function (assignment) {
        var anim = self.animDeploy(assignment);

        self.freeze();
        self.assignment.dismiss();

        return anim.play().then(() => {
          self.deployed = {first:!self.attacked};
          self.thaw();
        });
      },
      attack: function (target) {
        // stub, not sure what the default attack behavior looks like yet
      },
      shock: function (direction, frameId, block) {
        var anchor = self.assignment.getCenter();
        var frame;

        if (shock) {
          Tactics.stage.children[1].removeChild(shock);
          shock = undefined;
        }

        if (direction) {
          shock = new PIXI.Container();
          shock.addChild(frame = shocks[frameId]);
          shock.position = anchor.clone();
          shock.position.y += 4; // ensure shock graphic overlaps unit.

          Tactics.stage.children[1].addChild(shock);

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
      brightness: function (intensity,whiteness) {
        var name = 'brightness';
        var filter;
        var matrix;

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
        var name = 'whiten';
        var matrix;

        if (!intensity) {
          setFilter(name, undefined);
        }
        else {
          matrix = setFilter(name,'ColorMatrixFilter').matrix;
          matrix[3] = matrix[8] = matrix[13] = intensity;
        }

        return self;
      },
      findPath: function () {
        // http://en.wikipedia.org/wiki/A*_search_algorithm
        // Modified to avoid tiles with enemy units.
        // Modified to favor a path with no friendly units.
        // Modified to pick a preferred direction, all things being equal.
        var start;
        var goal;
        var path     = [];
        var opened   = [];
        var closed   = [];
        var cameFrom = {};
        var gScore   = {};
        var fScore   = {};
        var current;
        var directions = ['N','S','E','W'],direction;
        var i,neighbor,score;

        if (arguments.length == 1) {
          start = self.assignment;
          goal = arguments[0];
        }
        else {
          start = arguments[0];
          goal = arguments[1];
        }

        // Some units instantly move from start to goal.
        if (data.mPath === false)
          return [goal];

        opened.push(start);
        gScore[start.id] = 0;
        fScore[start.id] = board.getDistance(start,goal);

        while (opened.length) {
          current = opened.shift();

          if (current === goal) {
            while (current !== start) {
              path.unshift(current);
              current = cameFrom[current.id];
            }

            return path;
          }

          closed.push(current);

          // Apply directional preference and factor it into the score.
          direction = board.getDirection(current,goal);
          directions.sort((a,b) => direction.indexOf(b) - direction.indexOf(a));

          for (i=0; i<directions.length; i++) {
            if (!(neighbor = current[directions[i]])) continue;
            if (neighbor.assigned && (neighbor.assigned.team !== self.team || neighbor.assigned.mPass === false)) continue;
            if (closed.indexOf(neighbor) > -1) continue;

            score = gScore[current.id] + 1 + (i*.1);
            if (neighbor.assigned) score += 0.4;

            if (opened.indexOf(neighbor) === -1 || score < gScore[neighbor.id]) {
              cameFrom[neighbor.id] = current;
              gScore[neighbor.id] = score;
              fScore[neighbor.id] = score + board.getDistance(neighbor,goal);

              if (opened.indexOf(neighbor) === -1)
                opened.push(neighbor);

              opened.sort((a, b) => fScore[a.id] - fScore[b.id]);
            }
          }
        }

        return;
      },
      turn: function (direction) {
        if (self.directional === false) return self;

        if (!isNaN(direction)) direction = board.getRotation(self.direction,direction);
        self.direction = direction;

        self.drawFrame(stills[direction]);

        return self;
      },
      focus: function (viewed) {
        if (self.focused) return;
        self.focused = true;

        if (!self.assignment.painted)
          self.assignment.paint('focus', 0.3);
        else
          self.assignment.pixi.alpha *= 2;

        return !pulse && !viewed ? startPulse(6) : self;
      },
      blur: function () {
        if (!self.focused) return self;
        self.focused = false;
        self.notice = undefined;

        if (self.assignment.painted === 'focus')
          self.assignment.strip();
        else
          self.assignment.pixi.alpha /= 2;

        return pulse && !self.activated ? stopPulse() : self;
      },
      showMode: function () {
        var mode = self.activated;

        hideTurnOptions();
        board.clearHighlight();

        if (mode == 'move') {
          self.highlightDeployOptions();
        }
        else if (mode == 'attack') {
          self.highlightAttack();
        }
        else if (mode == 'turn') {
          self.showTurnOptions();
        }
        else if (mode == 'direction') {
          self.showDirection();
        }
        else {
          throw new Error('Unsupported mode for showing');
        }
      },
      hideMode: function () {
        if (self.activated && self.activated !== true) {
          hideTurnOptions();
          board.clearHighlight();
        }

        return self;
      },
      freeze: function () {
        self.hideMode();

        stopPulse();
      },
      thaw: function () {
        startPulse(4,2);
      },
      /*
       * A unit is activated when it is selected either directly or indirectly.
       *
       * The activation may optionally activate a specific 'mode'.
       * Modes include 'move', 'attack', 'turn', and 'direction':
       * * 'move' mode shows all possible move targets as blue tiles.
       * * 'attack' mode shows all possible attack targets as orange tiles.
       * * 'target' mode shows selected attack targets as red-orange tiles.
       * * 'turn' mode shows all 4 arrows for assigning a direction.
       * * 'direction' mode shows 1 arrow to show current unit direction.
       *
       * A unit may be activated in 'view'-only mode.  This typically occurs
       * when selecting an enemy unit to view its movement or attack range.
       */
      activate: function (mode,view) {
        var origin = self.origin;

        mode = mode || self.activated || true;
        self.viewed = view;
        if (self.activated == mode) return;

        if (mode == 'move') {
          if (self.deployed) {
            self.assign(origin.tile).turn(origin.adirection || origin.direction);
            self.deployed = false;
            self.turned = false;
          }
          else if (self.turned) {
            self.turn(origin.adirection || origin.direction);
            self.turned = false;
          }
        }

        self.activated = mode;

        if (mode !== true && mode !== 'ready')
          self.showMode();

        return view ? self : startPulse(4,2);
      },
      deactivate: function () {
        if (!self.activated) return self;

        self.hideMode();

        self.activated = self.deployed = self.attacked = false;
        self.origin = {tile:self.assignment,direction:self.direction};

        return stopPulse();
      },
      reset: function ()
      {
        var origin = self.origin;
        if (origin) self.assign(origin.tile).turn(origin.direction);

        return self.deactivate();
      },
      change: function (changes) {
        Object.assign(self, changes);

        self.emit({type: 'change', changes: changes});
      },
      animPulse: function (steps, speed) {
        var step = steps;
        var stride = 0.1 * (speed || 1);

        return new Tactics.Animation({
          fps:    12,
          loop:   true,
          frames: [
            {
              script: () => self.brightness(1 + (step-- * stride)),
              repeat: steps
            },
            {
              script: () => self.brightness(1 + (step++ * stride)),
              repeat:steps
            }
          ]
        });
      },
      /*
       * Units turn in the direction they are headed before they go there.
       * This method returns an animation that does just that, if needed.
       */
      animTurn: function (direction) {
        let anim = new Tactics.Animation();

        if (direction === self.direction) return;
        if (direction === board.getRotation(self.direction, 180))
          anim.addFrame(() => self.drawFrame(data.turns[board.getRotation(self.direction, 90)]));

        anim.addFrame(() => {
          self.drawFrame(stills[direction]);
          self.direction = direction;
        });

        return anim;
      },
      animWalk: function (assignment) {
        let anim = new Tactics.Animation({fps: 12});
        let path = self.findPath(assignment);

        // Turn frames are not typically required while walking unless the very
        // next tile is in the opposite direction of where the unit is facing.
        let odirection = board.getRotation(self.direction, 180)
        if (board.getDirection(self.assignment, path[0]) === odirection)
          anim.addFrame(() => self.drawFrame(data.turns[board.getRotation(self.direction, 90)]));

        // Keep track of what direction units face as they step out of the way.
        let step_directions = [];

        path.forEach((to_tile, i) => {
          let from_tile = i === 0 ? self.assignment : path[i-1];

          // Determine the direction of the next tile and turn in that direction.
          let direction = board.getDirection(from_tile, to_tile);
          let walks     = data.walks[direction];

          // Walk to the next tile
          let start_walk_index = anim.frames.length;

          let indexes = [];
          for (let index = data.walks[direction][0]; index <= data.walks[direction][1]; index++) {
            indexes.push(index);
          }
          indexes.forEach(index => anim.addFrame(() => self.drawFrame(index, from_tile)));

          // Do not step softly into that good night.
          anim.splice([start_walk_index, start_walk_index+4], () => {
            sounds.step.play();
          });

          // If this is our final destination, stand ready
          if (to_tile === assignment)
            anim.addFrame(() => {
              self.assign(assignment).turn(direction);
              if (assignment.focused) self.focus();
            });

          // Make any units behind us step back into position.
          let from_unit;
          if ((from_unit = from_tile.assigned) && from_unit !== self)
            anim.splice(start_walk_index+3, from_unit.animStepForward(step_directions.pop()));

          // Make any units before us step out of the way.
          let to_unit;
          if (to_unit = to_tile.assigned) {
            let next_tile = path[i+1];
            // The unit needs to back up in a direction that isn't in our way.
            let bad_directions = [direction, board.getDirection(next_tile, to_tile)];

            // Find the first available direction in preference order.
            let to_direction = [
              to_unit.direction,
              board.getRotation(to_unit.direction, 90),
              board.getRotation(to_unit.direction, 270),
            ].find(direction => bad_directions.indexOf(direction) === -1);

            step_directions.push(to_direction);
            anim.splice(start_walk_index, to_unit.animStepBack(to_direction));
          }
        });

        return anim;
      },
      animStepBack: function (direction) {
        let anim = new Tactics.Animation({fps: 12});

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
        let anim = new Tactics.Animation({fps: 12});

        let indexes = [];
        for (let index = data.foreSteps[direction][0]; index <= data.foreSteps[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach(index => anim.addFrame(() => self.drawFrame(index)));

        anim.addFrame(() => self.drawFrame(stills[self.direction]));

        // One final stomp for science
        anim.splice(0, () => sounds.step.play());

        return anim;
      },
      animAttack: function (target) {
        let anim = new Tactics.Animation({fps: 12});
        let direction = board.getDirection(self.assignment, target, self.direction);

        let indexes = [];
        for (let index = data.attacks[direction][0]; index <= data.attacks[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach(index => anim.addFrame(() => self.drawFrame(index)));

        return anim;
      },
      animBlock: function (attacker) {
        let anim = new Tactics.Animation({fps: 12});
        let direction = board.getDirection(self.assignment, attacker.assignment, self.direction);

        anim.addFrame(() => self.origin.direction = self.direction = direction);
        anim.addFrame(() => sounds.block.play());

        let indexes = [];
        for (let index = data.blocks[direction][0]; index <= data.blocks[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach((index, i) => anim.splice(0, () => self.drawFrame(index)));

        anim.addFrame(() => self.drawFrame(stills[direction]));

        return anim;
      },
      animStagger: function (attacker) {
        let anim = new Tactics.Animation({fps: 12});
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
            self.drawFrame(stills[self.direction]),
        ]);

        return anim;
      },
      animStrike: function (defender) {
        let anim = new Tactics.Animation({fps: 12});
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
      animDeath: function () {
        var container = new PIXI.Container();
        var anim = Tactics.Animation.fromData(container, Tactics.animations.death);

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
      animLightning:function (target, changes) {
        var anim = new Tactics.Animation();
        var pos = target.getCenter();
        var tunit = target.assigned;
        var whiten = [0.30,0.60,0.90,0.60,0.30,0];
        var container = new PIXI.Container();
        var strike;
        var strikes = [
          PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/lightning-1.png'),
          PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/lightning-2.png'),
          PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/lightning-3.png'),
          PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/lightning-1.png'),
          PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/lightning-2.png'),
          PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/lightning-3.png')
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
        strikes.randomize();

        anim.addFrames([
          () => {
            sounds.lightning.play();
            Tactics.stage.children[1].addChild(container);
          },
          () => {},
          {
            script: () => {
              if (strike) container.removeChild(strike);
              if (strikes.length)
                strike = container.addChild(strikes.shift());
              else
                Tactics.stage.children[1].removeChild(container);
            },
            repeat:7
          }
        ]);

        if (tunit) {
          anim
            .splice(2,tunit.animStagger(self,tunit.direction,changes))
            .splice(1, [
              () => tunit.change(changes),
              {
                script: () => tunit.whiten(whiten.shift()),
                repeat:6
              }
            ]);

          if (changes.mHealth === -tunit.health)
            anim.splice(tunit.animDeath(self));
        }

        return anim;
      },
      animHeal: function (targets) {
        var anim = new Tactics.Animation();
        var filter = new PIXI.filters.ColorMatrixFilter();
        var matrix = filter.matrix;

        if (!Array.isArray(targets)) targets = [targets];

        anim.addFrame(() => sounds.heal.play());

        targets.forEach(target => {
          // Apply sparkles in a few randomized patterns
          [{x:-18,y:-52},{x:0,y:-67},{x:18,y:-52}].randomize().forEach((pos, i) => {
            anim.splice(i*3+1, self.animSparkle(target.pixi, pos));
          });
        });

        // Filters are re-applied every frame because they may be reset
        anim.splice(2, [
          // Intensify yellow tint on healed units
          {
            script: () => {
              matrix[3] = matrix[8] += 0.05;
              targets.forEach(target => {
                target.pixi.children[0].children.forEach(sprite => {
                  if (sprite.data.name === 'trim' || sprite.data.name === 'base')
                    sprite.filters = [filter];
                });
              });
            },
            repeat: 5,
          },
          // Fade yellow tint on healed units
          {
            script: () => {
              matrix[3] = matrix[8] -= 0.05;
              targets.forEach(target => {
                target.pixi.children[0].children.forEach(sprite => {
                  if (sprite.data.name === 'trim' || sprite.data.name === 'base')
                    sprite.filters = [filter];
                });
              });
            },
            repeat: 5,
          },
          // Filters are not always reset, so reset explicitly
          () => targets.forEach(target => {
            target.pixi.children[0].children.forEach(sprite => {
              if (sprite.data.name === 'trim' || sprite.data.name === 'base')
                sprite.filters = null;
            });
          }),
        ]);

        return anim;
      },
      animSparkle: function (parent, pos) {
        var filter    = new PIXI.filters.ColorMatrixFilter();
        var matrix    = filter.matrix;
        var shock     = PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/shock.png');
        var size      = {w:shock.width,h:shock.height};
        var particle  = PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/particle.png');
        var container = new PIXI.Container();
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
      onTargetSelect: function (event) {
        board.lock();
        self.freeze();
        self.attack(event.target)
          .then(board.showResults)
          .then(() => {
            self.attacked = true;
            self.origin.adirection = self.direction;
            self.thaw();

            board
              .setSelectMode(self.deployed ? 'turn' : 'move')
              .unlock();
          });
      },
      onAttackFocus: function (event) {
        var tile = event.target;
        var unit;

        if (unit = tile.assigned) {
          let calc = self.calcAttack(unit);

          if (calc.damage === 0)
            unit.change({
              notice: calc.damage+' ('+Math.round(calc.chance)+'%)'
            });
          else if (calc.damage < 0)
            unit.change({
              notice: '+'+Math.abs(calc.damage)+' ('+Math.round(calc.chance)+'%)'
            });
          else
            unit.change({
              notice: '-'+calc.damage+' ('+Math.round(calc.chance)+'%)'
            });
        }
        else {
          tile.pixi.alpha = 0.6;
        }
      },
      onAttackBlur: function (event) {
        if (!event.target.assigned)
          event.target.pixi.alpha = 0.3;
      },
    });

    function setFilter(name, type) {
      var filters = self.filters;
      var base = self.frame.children[1];
      var color = self.frame.children[2];

      if (type) {
        if (!(name in filters)) {
          filters[name] = new PIXI.filters[type]();
          base.filters = color.filters = Object.keys(filters).map(n => filters[n]);
        }
      }
      else {
        if (name in filters) {
          delete filters[name];

          if (base.filters.length > 1)
            base.filters = color.filters = Object.keys(filters).map(n => filters[n]);
          else
            base.filters = color.filters = null;
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
      var anim = new Tactics.Animation({fps: 12});
      var container = new PIXI.Container();
      var w = 0;

      options = options || {};

      text.split('').forEach((v, i) => {
        var letter = new PIXI.Text(v, style);
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
