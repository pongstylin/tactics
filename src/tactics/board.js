Tactics.Board = function () {
  'use strict';

  const TILE_WIDTH       = 88;
  const TILE_HEIGHT      = 56;
  const HALF_TILE_WIDTH  = 44;
  const HALF_TILE_HEIGHT = 28;

  var self = this;
  var trophy;
  var units_container;
  var card = {
    renderer:  new PIXI.CanvasRenderer(176, 100, {transparent:true}),
    stage:     new PIXI.Container(),
    rendering: false,
    render:    () => {
      if (card.rendering) return;
      card.rendering = true;

      requestAnimationFrame(() => {
//console.log('card render',+new Date());
        card.renderer.render(card.stage);
        card.rendering = false;
      });
    }
  };
  var highlighted = [];

  card.canvas = card.renderer.view;
  card.canvas.id = 'card';
  Tactics.canvas.parentElement.insertBefore(card.canvas, Tactics.canvas);

  card.stage.hitArea = new PIXI.Polygon([0,0, 175,0, 175,99, 0,99]);
  card.stage.interactive = card.stage.buttonMode = true;
  card.stage.pointertap = function () {
    var els = card.elements;

    if (els.layer1.visible) {
      els.layer1.visible = !(els.layer2.visible = true);
      return card.render();
    }
    else if (els.layer2.visible) {
      els.layer2.visible = !(els.layer3.visible = true);
      return card.render();
    }

    self.eraseCard();
  };

  var style = card.renderer.context.createLinearGradient(0,0,176,0);
  style.addColorStop(0,'#000000');
  style.addColorStop('0.1','#FFFFFF');
  style.addColorStop(1,'#000000');

  card.mask = new PIXI.Graphics();
  card.mask.drawRect(0,0,88,46);

  card.elements = Tactics.draw({
    textStyle: {
      fontFamily: 'Arial',
      fontSize:   '11px',
      fill:       'white',
    },
    context:card.stage,
    children: {
      upper: {
        type    :'C',
        children: {
          avatar: {type:'C',x:22,y:75},
          name  : {
            type: 'T',
            x:    60,
            y:    10,
            style: {
              fontFamily: 'Arial',
              fontSize:   '11px',
              fontWeight: 'bold',
            },
          },
          noticeContainer: {
            type: 'C',
            x: 60,
            y: 26,
            children: {
              notice: {
                type: 'T',
                style: {
                  fontFamily: 'Arial',
                  fontSize: '11px',
                },
              },
            },
          },
          healthBar: {type: 'C', x: 60, y: 48}
        }
      },
      divider: {
        type:'G',
        draw:function (pixi) {
          pixi.lineStyle(1,0xFFFFFF,1,style);
          pixi.moveTo(0,60.5);
          pixi.lineTo(176,60.5);
        }
      },
      lower: {
        type    :'C',
        x       :8,
        y       :66,
        children: {
          layer1: {
            type:'C',
            children: {
              pLabel:{type:'T',x:  0,y:0,text:'Power' },
              power :{type:'T',x: 39,y:0              },
              mPower:{type:'T',x: 70,y:0              },


              bLabel:{type:'T',x: 80,y: 0,text:'Block' },
              block :{type:'T',x:115,y: 0              },
              mBlock:{type:'T',x:143,y: 0              },

              aLabel:{type:'T',x: 0,y:16,text:'Armor' },
              armor :{type:'T',x:39,y:16              },
              mArmor:{type:'T',x:70,y:16              }
            },
          },
          layer2: {
            type:'C',
            visible:false,
            children: {
              yLabel   :{type:'T',x: 0,y: 0,text:'Ability'},
              ability  :{type:'T',x:55,y: 0},
              sLabel   :{type:'T',x: 0,y:16,text:'Specialty'},
              specialty:{type:'T',x:55,y:16},
            },
          },
          layer3: {
            type:'C',
            visible:false,
            children: {
              recovery:{type:'T',x: 0,y: 0},
              notice1 :{type:'T',x:88,y: 0},
              notice2 :{type:'T',x: 0,y:16},
              notice3 :{type:'T',x:88,y:16},
            },
          }
        }
      }
    }
  });

  utils.addEvents.call(self);

  // Using a closure to organize variables.
  $.extend(self, {
    // Public properties
    tiles:      null,
    pixi:       undefined,
    locked:     false,
    teams:      [],

    viewed:     null,
    selected:   null,

    focused:    null,
    carded:     null,
    notice:     '',
    selectMode: 'move',
    rotation:   'N',

    history:    [],

    tranformToRestore: null,

    /*
     * Turn Data
     */
    currentTeamId: 0,

    // State of board at start of turn.
    state: {},

    // Actions taken this turn
    actions:  [],
    moved:    false,
    attacked: false,
    turned:   false,

    // This will ultimately call a server to get the results of an action.
    takeAction: function (action) {
      let team     = self.teams[self.currentTeamId];
      let selected = self.selected;

      if (!action.type.startsWith('end') && selected) {
        selected.freeze();
        action.unit = selected.assignment;
      }

      self.lock();
      return self.submitActions([action]).then(actions => {
        let promise = actions.reduce(
          (promise, action) => promise.then(() => self.performAction(action)),
          Promise.resolve(),
        );

        // If the action didn't result in ending the turn or game, then set mode.
        if (actions.length && !actions[actions.length-1].type.startsWith('end'))
          if (team.bot)
            promise = promise.then(() => selected.thaw());
          else
            promise = promise.then(() => {
              // The board must be unlocked before selecting a mode.
              // Otherwise, attempts to draw a card (e.g. to show a target) will be reset.
              self.unlock();

              if (selected.canMove())
                self.setSelectMode('move');
              else if (selected.canAttack())
                self.setSelectMode('attack');
              else
                self.setSelectMode('turn');

              selected.thaw();
            });

        return promise;
      });
    },

    // This will ultimately call a server, when appropriate.
    submitActions: function (actions) {
      return Promise.resolve(self.validateActions(actions));
    },

    validateActions: function (actions) {
      let validated = [];
      let selected  = self.selected;

      // Watch unit changes to detect endTurn and endGame events.
      let unitWatch = [];

      // Validate actions until we find an endTurn event.
      // TODO: Don't forward excess properties on action objects.
      let turnEnded = !!actions.find(action => {
        if (action.type === 'endTurn') {
          action.results = self.getEndTurnResults(unitWatch);
          validated.push(action);
          return true;
        }

        let unit = action.unit.assigned;
        let unitData = Tactics.units[unit.type];

        // Before initiating any action, a focused unit must break focus.
        if (unit.focusing)
          validated.push({
            type:    'breakFocus',
            unit:    unit.assignment,
            results: unit.getBreakFocusResults(),
          });

        if (action.type === 'move') {
          if (self.moved) return;

          let tiles = unit.getMoveTiles();
          if (tiles.indexOf(action.tile) === -1)
            return;

          action.results = unit.getMoveResults(action);
          self.moved = true;
        }
        else if (action.type === 'attack') {
          if (self.attacked) return;

          if (unitData.aAll === true) {
            if ('tile' in action)
              delete action.tile;
            if (action.direction === unit.direction)
              delete action.direction;
          }
          else {
            if (unit.getAttackTiles().indexOf(action.tile) === -1)
              return;

            // Set unit to face the direction of the target tile.
            let direction = self.getDirection(unit.assignment, action.tile, unit.direction);
            if (direction !== unit.direction)
              action.direction = direction;
          }

          action.results = unit.getAttackResults(action);
          self.attacked = true;
        }
        else if (action.type === 'attackSpecial') {
          if (self.attacked) return;

          if (!unit.canSpecial())
            return;

          action.results = unit.getAttackSpecialResults(action);
          self.attacked = true;
        }
        else if (action.type === 'turn') {
          if (self.turned) return;

          action.results = unit.getTurnResults(action);
          self.turned = true;
        }
        else
          return;

        validated.push(action);

        /*
         * Keep track of unit status changes that can trigger end turn or game.
         */
        let watchChanges = results => results.forEach(result => {
          let subResults = result.results || [];

          let changes = result.changes;
          if (!changes) return watchChanges(subResults);

          let unit  = result.unit.assigned;
          let watch = unitWatch.find(uw => uw.unit === unit);
          if (!watch)
            unitWatch.push(watch = {
              unit:      unit,
              mHealth:   unit.mHealth,
              focusing:  unit.focusing,
              paralyzed: unit.paralyzed,
            });

          // Dead units can cause the turn or game to end.
          if ('mHealth' in changes)
            watch.mHealth = changes.mHealth;

          // Focusing units can cause the turn to end.
          if ('focusing' in changes)
            watch.focusing = changes.focusing;

          // Paralyzed units can cause the game to end.
          if ('paralyzed' in changes)
            if (typeof changes.paralyzed === 'boolean')
              watch.paralyzed += changes.paralyzed ? 1 : -1;
            else
              watch.paralyzed = changes.paralyzed;

          watchChanges(subResults);
        });

        watchChanges(action.results);

        // A turn action immediately ends the turn.
        if (action.type === 'turn') {
          validated.push({
            type:    'endTurn',
            results: self.getEndTurnResults(unitWatch),
          });
          return true;
        }

        /*
         * If the selected unit is unable to continue, end the turn early.
         *   1) Pyromancer killed himself.
         *   2) Knight attacked Chaos Seed and killed by counter-attack.
         *   3) Assassin blew herself up.
         *   4) Enchantress paralyzed at least 1 unit.
         */
        if (action.type === 'attack' || action.type === 'attackSpecial') {
          let endTurn = () => {
            let watch = unitWatch.find(uw => uw.unit === selected);
            if (!watch || (watch.mHealth > -selected.health && !watch.focusing))
              return;

            validated.push({
              type:    'endTurn',
              results: self.getEndTurnResults(unitWatch),
            });

            return true;
          };

          if (endTurn())
            return true;

          // Can any victims counter-attack?
          return action.results.find(result => {
            let unit = result.unit.assigned;
            if (!unit.canCounter()) return;

            let counterAction = unit.getCounterAction(action.unit.assigned, result);
            if (!counterAction) return;

            validated.push(counterAction);

            watchChanges(counterAction.results);

            return endTurn();
          });
        }
      });

      if (turnEnded) {
        let currentTeam = self.teams[self.currentTeamId];
        if (self.attacked || self.moved || self.turned)
          currentTeam.passedTurns = 0;
        else
          currentTeam.passedTurns++;

        // Team Chaos needs a chance to phase before ending their turn.
        if (currentTeam.name === 'Chaos') {
          let action = {
            type: 'phase',
            unit: currentTeam.units[0].assignment,
          };

          validated.splice(validated.length-1, 0, action);
        }
      }

      // Determine if the game has ended.
      let teams = self.teams.filter(team => !!team.units.length);
      let totalPassedTurns = teams.reduce(
        (sum, team) => sum + Math.min(3, team.passedTurns),
        0,
      );
      let winners;

      if (totalPassedTurns === (teams.length * 3))
        // All teams passed at least 3 times, draw!
        winners = [];
      else
        // Find teams that has a unit that keeps it alive.
        winners = teams.filter(team =>
          !!team.units.find(unit => {
            // Wards don't count.
            if (unit.type === 4 || unit.type === 5)
              return false;

            let watch = unitWatch.find(uw => uw.unit === unit);
            if (!watch)
              watch = {
                mHealth:   unit.mHealth,
                focusing:  unit.focusing,
                paralyzed: unit.paralyzed,
              };

            // Dead units don't count.
            if (watch.mHealth <= -unit.health)
              return false;

            // Paralyzed units don't count.
            if (watch.paralyzed)
              return false;

            return true;
          })
        );

      let endGame;
      if (winners.length === 0)
        endGame = {
          type: 'endGame',
        };
      else if (winners.length === 1)
        endGame = {
          type: 'endGame',
          winner: winners[0],
        };

      if (endGame)
        if (turnEnded)
          // Replace the endTurn event with an endGame event.
          validated[validated.length-1] = endGame;
        else
          validated.push(endGame);

      return validated;
    },

    // Act out the action on the board.
    performAction: function (action) {
      self.actions.push(action);

      if (action.type === 'endTurn')
        return self.endTurn(action);
      else if (action.type === 'endGame')
        return self.endGame(action);

      let unit = action.unit.assigned;

      return unit[action.type](action).then(() => {
        if (action.type === 'move')
          self.moved = true;
        else if (action.type === 'attack' || action.type === 'attackSpecial')
          self.attacked = true;
        else if (action.type === 'turn')
          self.turned = true;
      });
    },

    applyChangeResults: function (results) {
      results.forEach(result => {
        let unit    = result.unit.assigned;
        let changes = result.changes;

        if (changes) {
          if (changes.direction)
            unit.stand(changes.direction);

          unit.change(result.changes);
        }

        if (result.results)
          self.applyChangeResults(result.results);
      });
    },
    animApplyFocusChanges: function (result) {
      let anim       = new Tactics.Animation();
      let unit       = result.unit.assigned;
      let hasFocus   = unit.hasFocus();
      let needsFocus = unit.focusing || unit.paralyzed || unit.poisoned;

      if (!hasFocus && needsFocus)
        anim.splice(0, unit.animFocus(0.5));
      else if (hasFocus && !needsFocus)
        anim.splice(0, unit.animDefocus());

      if (result.results)
        result.results.forEach(result => anim.splice(0, self.animApplyFocusChanges(result)));

      return anim;
    },

    // Property accessors
    getTile: function (x, y) {
      return self.tiles[x+y*11];
    },

    getUnit: function (x, y) {
      return self.getTile(x, y).assigned;
    },

    // Public functions
    getDistance: function (a, b) {
      // Return the distance between two tiles.
      return Math.abs(a.x-b.x) + Math.abs(a.y-b.y);
    },
    getBetween: function (a, b, empty) {
      var distance = self.getDistance(a,b);
      var dx = Math.abs(a.x-b.x);
      var dy = Math.abs(a.y-b.y);
      var x,y;
      var tile,tiles = [];

      for (x=a.x-dx; x<a.x+dx+1; x++)
      {
        for (y=a.y-dy; y<a.y+dy+1; y++)
        {
          if (x == a.x && y == a.y) continue;
          if (!(tile = self.getTile(x,y))) continue;

          if (!empty || !tile.assigned) tiles.push(tile);
        }
      }

      return tiles;
    },
    /*
     * From the position of tile a, return the direction of tile b.
     * Consider this matrix:
     *   NW  NNW  N  NNE  NE
     *   WNW NW   N   NE ENE
     *   W   W    A    E   E
     *   WSW SW   s   SE ESE
     *   SW  SSW  S  SSE  SE
     *
     *   When "simple" is falsey, triple directions are reduced to double
     *   directions, e.g. NNW = NW.
     *
     *   When "simple" is true, triple directions are reduced to the strongest
     *   direction, e.g. NNW = N.
     *
     *   When "simple" is a direction, triple and double directions are
     *   reduced to a single direction using this priority order:
     *   1) The strongest direction.
     *   2) The "simple" direction.
     *   3) The direction to the right of the "simple" direction.
     *   4) The direction to the left of the "simple" direction.
     */
    getDirection: function (a, b, simple) {
      let xdist = a.x - b.x;
      let ydist = a.y - b.y;

      if (Math.abs(xdist) > Math.abs(ydist)) {
        // EW is stronger than NS
        if (ydist === 0 || simple) {
          // The only or strongest direction
          return xdist > 0 ? 'W' : 'E';
        }
        else {
          // Triple direction reduced to double direction.
          return (xdist > 0 ? 'W' : 'E') + (ydist > 0 ? 'N' : 'S');
        }
      }
      else if (Math.abs(ydist) > Math.abs(xdist)) {
        // NS is stronger than EW
        if (xdist === 0 || simple) {
          // The only or strongest direction
          return ydist > 0 ? 'N' : 'S';
        }
        else {
          // Triple direction reduced to double direction.
          return (ydist > 0 ? 'N' : 'S') + (xdist > 0 ? 'W' : 'E');
        }
      }

      // a and b is the same or at a double direction.
      let direction
      if (a === b)
        direction = 'NSEW';
      else
        direction = (ydist > 0 ? 'N' : 'S') + (xdist > 0 ? 'W' : 'E');

      if (simple && typeof simple === 'string')
        // Reduce direction to a single direction.
        direction = [
          simple,
          self.getRotation(simple, 90),
          self.getRotation(simple, -90),
        ].find(d => direction.indexOf(d) > -1);

      return direction;
    },
    getRotation: function (direction, deg) {
      var directions = ['N','NE','E','SE','S','SW','W','NW'];
      // 90 = 360 / directions.length;
      var index = directions.indexOf(direction) + (deg / 45);

      // 3 = directions.length-1; 4 = directions.length;
      return directions.slice(index > 7 ? index-8 : index)[0];
    },
    getDegree: function (direction, rotation) {
      var directions = ['N','NE','E','SE','S','SW','W','NW'];

      return (directions.indexOf(rotation) - directions.indexOf(direction)) * 45;
    },
    /*
     * The 'coords' can be either an xy tuple or object (e.g. tile object)
     * Coords object must have 'x' and 'y' properties.
     */
    getTileRotation: function (coords, degree) {
      if (coords.length === undefined)
        coords = [coords.x, coords.y];

      if (degree === 0)
        return self.getTile(...coords);
      else if (degree ===  90 || degree === -270)
        return self.getTile(10 - coords[1], coords[0]);
      else if (degree === 180 || degree === -180)
        return self.getTile(10 - coords[1], 10 - coords[0]);
      else if (degree === 270 || degree ===  -90)
        return self.getTile(coords[1], 10 - coords[0]);

      return null;
    },

    // Public methods
    draw: function () {
      var pixi = self.pixi = PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/board.jpg');
      var tiles = self.tiles = new Array(11*11);
      var sx = 6 - TILE_WIDTH;        // padding-left, 1 tile  wide
      var sy = 4 + TILE_HEIGHT*4 + 1; // padding-top , 4 tiles tall, tweak

      // The board itself is interactive since we want to detect a tap on a
      // blank tile to cancel current selection, if sensible.  Ultimately, this
      // functionality needs to be provided by an 'undo' button.
      pixi.interactive = true;
      pixi.pointertap = event => {
        if (self.locked) return;

        self.deselect();
        Tactics.render();
      };
      pixi.position = new PIXI.Point(18, 44);

      /*
       * A select event occurs when a unit and/or an action tile is selected.
       */
      var selectEvent = event => {
        if (self.locked) return;

        let tile = event.target;
        if (tile.action) return;

        Tactics.sounds.select.play();
        self.select(tile.assigned);
      };

      var focused_tile = null;
      var focusEvent = event => {
        /*
         * Make sure tiles are blurred before focusing on a new one.
         */
        if (event.type === 'focus') {
          // Beware: unlock() calls tile.emit() to focus on the focused tile.
          if (focused_tile && focused_tile !== event.target)
            focused_tile.onBlur(event.pixiEvent);
          focused_tile = event.target;
        }

        if (self.locked) return;

        let assigned = event.target.assigned;
        let old_focused = self.focused;

        if (event.type === 'focus')
          self.focused = assigned;
        else // event.type === 'blur'
          if (assigned === old_focused)
            self.focused = null;

        if (old_focused !== self.focused) {
          if (old_focused)
            old_focused.blur();

          if (self.focused) {
            let selected = self.selected;
            let view_only = !self.focused.canSelect();

            Tactics.sounds.focus.play();
            self.focused.focus(view_only);
          }

          self.drawCard();
          self.emit({
            type:   'focus-change',
            ovalue: old_focused,
            nvalue: self.focused,
          });
        }
      };

      for (let x = 0; x < 11; x++) {
        let start = 0;
        let stop  = 11;
        if (x == 0)  { start = 2; stop =  9; }
        if (x == 1)  { start = 1; stop = 10; }
        if (x == 9)  { start = 1; stop = 10; }
        if (x == 10) { start = 2; stop =  9; }

        for (let y = start; y < stop; y++) {
          let index = x + y*11;
          let tile  = tiles[index] = new Tactics.Tile(x, y);

          tile.on('select',     selectEvent);
          tile.on('focus blur', focusEvent);
          tile.draw();
          tile.pixi.position = new PIXI.Point(
            sx + x*HALF_TILE_WIDTH  + y*HALF_TILE_WIDTH,
            sy - x*HALF_TILE_HEIGHT + y*HALF_TILE_HEIGHT,
          );

          pixi.addChild(tile.pixi);
        }
      }

      Tactics.stage.addChild(pixi);

      /*
       * While the board sprite and the tile children may be interactive, the units
       * aren't.  So optimize PIXI by not checking them for interactivity.
       */
      units_container = new PIXI.Container();
      units_container.interactiveChildren = false;

      Tactics.stage.addChild(units_container);

      // Required to place units in the correct places.
      pixi.updateTransform();

      tiles.forEach((tile, i) => {
        if (!tile) return;

        // Hack to avoid apparent bug where x/y offsets change
        tile.getCenter();

        tile.N = tile.y >  0 ? tiles[i-11] : null;
        tile.S = tile.y < 10 ? tiles[i+11] : null;
        tile.E = tile.x < 10 ? tiles[i+ 1] : null;
        tile.W = tile.x >  0 ? tiles[i- 1] : null;
      });

      // Make sure units always overlap naturally.
      Tactics.on('render', () => {
        units_container.children.sort((a, b) => a.y - b.y);
      });

      return self;
    },
    createGradientSpriteForHealthBar: function (options) {
      var canvas;
      // The canvas is cached so we're not creating a new canvas on every render
      var canvas_key = '_canvas' + options.id;
      if (self[canvas_key]) {
        canvas = self[canvas_key];
      } else {
        canvas = document.createElement('canvas');
      }
      self[canvas_key] = canvas;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = options.width;
      canvas.height = options.height;

      var gradient = ctx.createLinearGradient(0, 0, options.gradientEndX,0);
      gradient.addColorStop(0, options.startColor);
      gradient.addColorStop(0.6, options.shineColor);
      gradient.addColorStop(1, options.endColor);
      ctx.fillStyle = gradient;
      ctx.moveTo(10, 0);
      ctx.lineTo(canvas.width, 0);
      ctx.lineTo(canvas.width - 10, canvas.height);
      ctx.lineTo(0, canvas.height);
      ctx.closePath();
      ctx.fill();

      return new PIXI.Sprite(PIXI.Texture.fromCanvas(canvas));
    },
    drawHealth: function (unit) {
      var healthBarSize = 95;
      var currentHealth = unit.health + unit.mHealth;
      var healthRatio = currentHealth / unit.health;
      var toColorCode = num => '#' + parseInt(num).toString(16);
      var gradientStartColor = Tactics.utils.getColorStop(0xc2f442, 0xFF0000, healthRatio);
      var gradientShineColor = Tactics.utils.getColorStop(gradientStartColor, 0xFFFFFF, 0.8);
      var gradientEndColor = Tactics.utils.getColorStop(gradientShineColor, 0x000000, 0.2);
      gradientStartColor = toColorCode(gradientStartColor);
      gradientShineColor = toColorCode(gradientShineColor);
      gradientEndColor = toColorCode(gradientEndColor);
      var gradientEndX = healthBarSize;

      // Create the health bar sprites
      var healthBarSprite = self.createGradientSpriteForHealthBar({
        id: 'healthBar',
        height: 6,
        width: healthRatio * healthBarSize,
        startColor: gradientStartColor,
        shineColor: gradientShineColor,
        endColor: gradientEndColor,
        gradientEndX: gradientEndX,
      });
      var underlayBarSprite = self.createGradientSpriteForHealthBar({
        id: 'healthBarUnderlay',
        height: 6,
        width: healthBarSize,
        startColor: '#008000',
        shineColor: '#006400',
        endColor: '#006400',
        gradientEndX: gradientEndX,
      });
      underlayBarSprite.x = 2;
      underlayBarSprite.y = 2;
      underlayBarSprite.alpha = 0.5;

      // Create the health text
      var textOptions = {
        fontFamily:      'Arial',
        fontSize:        '12px',
        stroke:          0,
        strokeThickness: 2,
        fill:            'white',
      };
      var currentHealthText = new PIXI.Text(
          currentHealth,
          textOptions
      );
      currentHealthText.x = 12;
      currentHealthText.y = -14;
      var dividedByText = new PIXI.Text(
          '/',
          {...textOptions, fontSize: '19px'}
      );
      dividedByText.x = 26;
      dividedByText.y = -17;
      var totalHealthText = new PIXI.Text(
          unit.health,
          textOptions
      );
      totalHealthText.x = 32;
      totalHealthText.y = -11;

      // Add everything to a container
      var container = new PIXI.Container();
      container.addChild(underlayBarSprite);
      container.addChild(healthBarSprite);
      container.addChild(currentHealthText);
      container.addChild(dividedByText);
      container.addChild(totalHealthText);
      return container;
    },
    /*
     * Draw an information card based on these priorities:
     *   1) The provided 'unit' argument (optional)
     *   2) The unit that the user is currently focused upon
     *   3) The unit that the user has selected for viewing.
     *   4) The unit that the user has selected for control.
     *   5) The trophy avatar with the board notice.
     */
    drawCard: function (unit) {
      let els = card.elements;
      let mask;
      let notice;
      let notices = [];
      let important = 0;

      if (unit === undefined)
        unit = self.focused || self.viewed || self.selected;

      let old_carded = self.carded;
      self.carded = unit || null;

      if (old_carded !== unit) {
        if (old_carded)
          old_carded.off('change', card.listener);
        if (unit)
          unit.on('change', card.listener = () => self.drawCard(unit));
      }

      els.noticeContainer.x = 74;
      els.notice.anchor.x = 0;

      if (els.healthBar.children.length) els.healthBar.removeChildren();
      if (unit) {
        mask = new PIXI.Graphics();
        mask.drawRect(0,0,88,60);

        els.noticeContainer.x = 174;
        els.notice.anchor.x = 1;
        els.healthBar.addChild(self.drawHealth(unit));
        //
        //  Status Detection
        //
        if (unit.mHealth === -unit.health) {
          if (unit.type === 15)
            notice = 'Hatched!';
        }
        else {
          notice = unit.notice;
        }

        if (unit.paralyzed) {
          notices.push('Paralyzed!');
          important++;
        }

        if (unit.mRecovery)
          notices.push('Wait '+unit.mRecovery+' Turn'+(unit.mRecovery > 1 ? 's' : '')+'!');

        if (unit.poisoned) {
          notices.push('Poisoned!');
          important++;
        }

        if (unit.canSpecial())
          notices.push('Enraged!');

        if (unit.barriered) {
          notices.push('Barriered!');
          important++;
        }

        if (unit.focusing) {
          notices.push('Focused!');
          important++;
        }

        if (unit.mBlocking < 0)
          notices.push('Vulnerable!');

        notices.push(unit.title);

        if (!notice) {
          notice = notices.shift();
          important--;
        }

        if (important > 0)
          notice += ' +';

        //
        //  Draw the top part of the card.
        //
        if (els.avatar.children.length) els.avatar.removeChildren();
        els.avatar.addChild(unit.drawAvatar());
        els.avatar.children[0].mask = mask;

        els.name.text = unit.name;

        els.notice.text = notice;

        //
        //  Draw the first layer of the bottom part of the card.
        //
        els.layer1.visible = true;

        if (unit.blocking) {
          if (unit.mBlocking) {
            els.block.text = unit.blocking;

            if (unit.mBlocking > 0) {
              els.mBlock.text = '+'+Math.round(unit.mBlocking)+'%';
              els.mBlock.style.fill = '#00FF00';
            }
            else {
              els.mBlock.text = Math.round(unit.mBlocking)+'%';
              els.mBlock.style.fill = '#FF0000';
            }

            els.block.updateText();
            els.mBlock.position.x = els.block.position.x + els.block.width;
          }
          else {
            els.block.text = unit.blocking+'%';
            els.mBlock.text = '';
          }
        }
        else {
          els.block.text = '---';
          els.mBlock.text = '';
        }

        els.power.text = unit.power || '--';

        if (unit.mPower) {
          if (unit.mPower > 0) {
            els.mPower.text = '+'+unit.mPower;
            els.mPower.style.fill = '#00FF00';
          }
          else {
            els.mPower.text = unit.mPower;
            els.mPower.style.fill = '#FF0000';
          }

          els.power.updateText();
          els.mPower.position.x = els.power.position.x + els.power.width;
        }
        else {
          els.mPower.text = '';
        }

        els.armor.text = unit.armor;

        if (unit.mArmor) {
          if (unit.mArmor > 0) {
            els.mArmor.text = '+'+unit.mArmor;
            els.mArmor.style.fill = '#00FF00';
          }
          else {
            els.mArmor.text = unit.mArmor;
            els.mArmor.style.fill = '#FF0000';
          }

          els.armor.updateText();
          els.mArmor.position.x = els.armor.position.x + els.armor.width;
        }
        else {
          els.mArmor.text = '';
        }

        //
        //  Draw the 2nd layer of the bottom part of the card.
        //
        els.layer2.visible = false;

        els.ability.text = unit.ability;
        els.specialty.text = unit.specialty || 'None';

        //
        //  Draw the 3rd layer of the bottom part of the card.
        //
        els.layer3.visible = false;

        els.recovery.text = 'Recovery  '+unit.mRecovery+'/'+unit.recovery;
        els.notice1.text = notices.length ? notices.shift() : '---';
        els.notice2.text = notices.length ? notices.shift() : '---';
        els.notice3.text = notices.length ? notices.shift() : '---';

        card.stage.buttonMode = true;
        card.render();
      }
      else if (self.notice) {
        if (trophy === undefined)
          trophy = new Tactics.Unit(19);

        unit = trophy;
        mask = new PIXI.Graphics();
        mask.drawRect(0,0,88,60);

        //
        //  Draw the top part of the card.
        //
        if (els.avatar.children.length) els.avatar.removeChildren();
        els.avatar.addChild(unit.drawAvatar());
        els.avatar.children[0].mask = mask;

        els.name.text = 'Champion';
        els.notice.text = self.notice;

        //
        // Hide the rest.
        //
        els.layer1.visible = false;
        els.layer2.visible = false;
        els.layer3.visible = false;

        card.stage.buttonMode = true;
        card.render();
      }
      else if (!old_carded) {
        return self;
      }

      return self.emit({
        type:   'card-change',
        ovalue: old_carded,
        nvalue: unit,
      });
    },
    eraseCard: function () {
      card.stage.buttonMode = false;

      if (self.carded) self.carded.off('change',card.listener);
      self.emit({type:'card-change',ovalue:self.carded,nvalue:null});
      self.carded = null;

      return self;
    },

    addTeams: function (teams) {
      teams.forEach((team, i) => {
        self.teams.push({
          name:        team.n || null,
          color:       team.c,
          units:       [],
          bot:         team.b ? new Tactics.Bot(team.b) : null,
          passedTurns: 0,
        });

        Object.keys(team.u).forEach(coords => {
          let uData = team.u[coords];
          let x = coords.charCodeAt(0) - 97;
          let y = coords.charCodeAt(1) - 97;
          let degree = self.getDegree('N', self.rotation);

          uData.assignment = self.getTileRotation([x, y], degree);
          uData.direction  = self.getRotation(uData.d, degree);

          self.addUnit(i, uData);
        });
      });

      self.state = self.getState();

      return self;
    },
    dropTeams: function () {
      var teams = self.teams,units;
      var i,j;

      for (i=teams.length-1; i>-1; i--)
      {
        units = teams[i].units;

        for (j=units.length-1; j>-1; j--)
        {
          self.dropUnit(units[j]);
        }
      }

      teams.length = 0;

      return self;
    },

    addUnit: function (teamId, udata) {
      let team = self.teams[teamId];
      let unit = new Tactics.Unit(udata.t);
      unit.team = teamId;

      unit.draw(udata.direction, udata.assignment);
      units_container.addChild(unit.pixi);
      team.units.push(unit);

      if (udata.h)
        unit.mHealth = udata.h;

      if (udata.b)
        unit.mBlocking = udata.b;

      if (udata.r)
        unit.mRecovery = udata.r;

      return self;
    },
    dropUnit: function (unit) {
      var tUnits = self.teams[unit.team].units;

      if (unit == self.focused) {
        unit.blur();
        self.focused = null;
      }

      if (unit == self.viewed) {
        unit.deactivate();
        self.viewed = null;
      }

      if (unit == self.selected) {
        unit.deactivate();
        self.selected = null;
      }

      if (unit == self.carded)
        self.drawCard();

      tUnits.splice(tUnits.indexOf(unit), 1);
      unit.assign(null);
      units_container.removeChild(unit.pixi);

      return self;
    },

    /*
      This does not actually rotate the board - that causes all kinds of
      complexity.  Rather, it rearranges the units so that it appears the
      board has rotated.  This means unit coordinates and directions must
      be translated to an API based on our current rotation.
    */
    rotate: function (rotation) {
      var units = [];
      var degree = self.getDegree(self.rotation, rotation);

      self.teams.forEach(t => Array.prototype.push.apply(units, t.units));

      let activated = self.viewed || self.selected;
      if (activated) activated.hideMode();

      units.forEach(unit => {
        unit.assign(self.getTileRotation(unit.assignment, degree));
        unit.stand(self.getRotation(unit.direction, degree));
      });

      if (self.selected && !self.viewed) self.selected.showMode();
      if (self.viewed) self.viewed.showMode();

      self.rotation = rotation;
      Tactics.render();

      return self;
    },

    setSelectMode: function (mode) {
      var team = self.teams[self.currentTeamId];

      if (self.transformToRestore) {
        Tactics.panzoom.transitionToTransform(self.transformToRestore);
        self.transformToRestore = null;
      }

      if (self.viewed)
        if (!team.bot)
          self.viewed.activate(mode, true);
        else
          self.viewed.activate();
      else if (self.selected)
        if (!team.bot)
          self.selected.activate(mode);
        else
          self.selected.activate();

      // I got tired of seeing button borders and glow changes during bot turns.
      if (!team || !team.bot)
        self.emit({
          type:   'select-mode-change',
          ovalue: self.selectMode,
          nvalue: mode,
        });

      self.selectMode = mode;

      return self;
    },
    //
    // A unit is only selectable if...
    //   1) The unit belongs to the team that is playing its turn.
    //   2) The unit has completely recovered.
    //   3) Another unit on the same team has not already attacked this turn.
    //
    select: function (unit) {
      var selected = self.selected;
      var viewed   = self.viewed;
      var mode;

      if (unit === viewed) return self.drawCard();

      if (viewed) {
        viewed.deactivate();
        self.viewed = null;
      }

      if (unit === selected) {
        mode = selected.activated;

        if (mode === 'target')
          mode = 'attack';

        // Show a mode previously hidden.
        if (viewed) selected.showMode();
      }
      else {
        // Do what a unit can can[].
        let can = [];
        if (unit.canMove())
          can.push('move');
        if (unit.canAttack())
          can.push('attack');
        if (unit.canTurn())
          can.push('turn');

        mode = self.selectMode;
        if (mode === null || can.indexOf(mode) === -1)
          mode = can.shift();

        let view_only = !unit.canSelect();

        if (view_only) {
          if (selected && !viewed) selected.hideMode();
          self.viewed = unit;
        }
        else {
          if (selected) selected.deactivate();
          self.selected = unit;
        }
      }

      self.setSelectMode(mode);

      return self.drawCard();
    },
    deselect: function (reset) {
      var selected = self.selected;
      var viewed = self.viewed;
      var team = self.teams[self.currentTeamId];

      if (reset) {
        if (selected) selected.deactivate();
        self.selected = null;

        if (viewed) viewed.deactivate();
        self.viewed = null;
      }
      // TODO: Do we still need special treatment for bots?
      else if (team.bot) {
        if (selected) selected.deactivate();
        self.selected = null;
      }
      else if (viewed) {
        viewed.deactivate();
        self.viewed = null;

        if (selected)
          if (selected.activated === 'direction')
            selected.activate('turn');
          else if (selected.activated === 'target')
            selected.activate('attack');
          else
            selected.showMode();

        self.setSelectMode(selected ? selected.activated : self.selectMode);
        return self.drawCard();
      }
      else if (selected && !self.actions.length && self.selectMode !== 'target') {
        selected.deactivate();
        self.selected = null;
      }
      else
        return self;

      if (selected !== self.selected || viewed !== self.viewed) {
        self.setSelectMode(self.selectMode);
        self.drawCard();
      }

      return self;
    },

    startTurn: function () {
      let teamId = self.currentTeamId;
      let team   = self.teams[teamId];

      if (team.bot) {
        self.lock();

        // Give the page a chance to render the effect of locking the board.
        setTimeout(() => team.bot.startTurn(teamId), 1);
      }
      else {
        if (team.name)
          self.notice = 'Go '+team.name+" team!";
        else
          self.notice = 'Your Turn!';

        self.setSelectMode('move');
        self.unlock();
        self.drawCard();
      }
    },
    /*
     * End turn results include:
     *   The selected unit mRecovery is incremented based on their actions.
     *   Other units' mRecovery on the outgoing team is decremented.
     *   All units' mBlocking are reduced by 20% per turn cycle.
     */
    getEndTurnResults(unitWatch) {
      let selected    = self.selected;
      let moved       = self.moved;
      let attacked    = self.attacked;
      let teams       = self.teams.filter(t => !!t.units.length);
      let currentTeam = self.teams[self.currentTeamId];
      let results     = [];

      // Per turn mBlocking decay rate is based on the number of playable teams.
      // It is calculated such that a full turn cycle is still a 20% reduction.
      let decay = teams.length;

      teams.forEach(team => {
        team.units.forEach(unit => {
          // Skip units that are about to die.
          let watch = unitWatch.find(uw => uw.unit === unit);
          if (watch && watch.mHealth === -unit.health) return;

          // Adjust recovery for the outgoing team.
          if (team === currentTeam) {
            let mRecovery;
            if (unit === selected) {
              let recovery = selected.recovery;

              if (moved && attacked)
                mRecovery = recovery;
              else if (moved)
                mRecovery = Math.floor(recovery / 2);
              else if (attacked)
                mRecovery = Math.ceil(recovery / 2);

              if (mRecovery === 0)
                mRecovery = undefined;
            }
            else if (unit.mRecovery)
              mRecovery = unit.mRecovery - 1;

            if (mRecovery !== undefined)
              results.push({
                unit:    unit.assignment,
                changes: { mRecovery:mRecovery },
              });
          }

          // Decay blocking modifiers for all applicable units
          if (unit.mBlocking) {
            let mBlocking = unit.mBlocking * (1 - 0.2/decay);
            if (Math.abs(mBlocking) < 2) mBlocking = 0;

            results.push({
              unit:    unit.assignment,
              changes: { mBlocking:mBlocking },
            });
          }
        });
      });

      return results;
    },
    endTurn: function (action) {
      self.notice = null;

      self.applyChangeResults(action.results);

      // If the player team was killed, he can take over for a bot team.
      // This only applies to the Chaos app.
      if (self.teams.length === 5)
        // Find a player team with no units.
        self.teams.find(playerTeam => {
          if (playerTeam.units.length) return;
          if (playerTeam.bot) return;

          // Find a bot team that will be the new player team.
          return !!self.teams.find(botTeam => {
            if (botTeam.units.length === 0) return;
            if (botTeam.name === 'Chaos') return;

            botTeam.bot = 0;
            return true;
          });
        });

      self.pushHistory();
      self.startTurn();

      return self;
    },
    endGame: function (action) {
      // If any units are selected or viewed, deactivate them.
      self.deselect(true);

      let winner = action.winner;
      if (winner) {
        if (winner.name === null)
          self.notice = 'You win!';
        else
          self.notice = winner.name+' Wins!';
      }
      else
        self.notice = 'Draw!';

      self.pushHistory();
      self.lock('gameover');
      self.drawCard();

      return self;
    },

    /*
     * Get the turn order as an array of team IDs.
     * The first element of the array is the team ID of the current turn.
     */
    getTurnOrder: function () {
      return self.teams.getAllIndexes(self.currentTeamId);
    },

    lock: function (value) {
      if (self.locked === value) return;
      if (self.focused)
        self.focused.assignment.emit({
          type:        'blur',
          target:      self.focused.assignment,
          pointerType: self.focused.assignment.focused,
        });
      self.locked = value || true;

      self.tiles.forEach(tile => tile.set_interactive(false));

      self.emit({
        type:   'lock-change',
        ovalue: false,
        nvalue: self.locked,
      });
    },
    unlock: function () {
      let old_locked = self.locked;
      self.drawCard();
      if (!old_locked) return;
      self.locked = false;

      self.tiles.forEach(tile => {
        tile.set_interactive(!!(tile.action || tile.assigned));

        if (tile.focused)
          tile.emit({
            type:        'focus',
            target:      tile,
            pointerType: tile.focused,
          });
      });

      self.emit({
        type:   'lock-change',
        ovalue: old_locked,
        nvalue: false,
      });
    },

    calcTeams: function () {
      var choices = [];

      self.teams.forEach((team, id) => {
        var thp = 50*3,chp = 0;
        if (team.name === 'Chaos') return;
        if (team.units.length === 0) return;

        team.units.forEach(unit => chp += unit.health + unit.mHealth);

        choices.push({
          id:     id,
          score:  chp / thp,
          random: Math.random(),
        });
      });

      return choices;
    },
    getWinningTeams: function () {
      var teams = self.calcTeams();

      teams.sort((a, b) => (b.score - a.score) || (b.size - a.size) || (a.random - b.random));

      return teams;
    },
    getLosingTeam: function () {
      var teams = self.calcTeams();

      teams.sort((a, b) => (a.score - b.score) || (a.size - b.size) || (a.random - b.random));

      return self.teams[teams[0].id];
    },

    canUndo: function () {
      if (self.teams.length === 2 && !self.teams[0].bot && !self.teams[1].bot)
        return !!self.actions.length || !!self.history.length;
      else {
        if (self.actions.length) {
          let lastLuckyActionIndex = self.actions.findLastIndex(action =>
            action.type.startsWith('end') || !!action.results.find(result => 'luck' in result)
          );

          return lastLuckyActionIndex < (self.actions.length-1);
        }
      }

      return false;
    },
    undo: function () {
      if (self.teams.length === 2 && !self.teams[0].bot && !self.teams[1].bot) {
        // Be very permissive for the classic app
        if (self.actions.length)
          self.applyState();
        else
          self.popHistory();

        self.startTurn();
      }
      else {
        // Only undo actions that did not involve luck.
        if (self.actions.length) {
          let lastLuckyActionIndex = self.actions.findLastIndex(action =>
            !!action.results.find(result => 'luck' in result)
          );

          if (lastLuckyActionIndex < (self.actions.length-1)) {
            // Re-apply actions that required luck.
            let actions = self.actions.slice(0, lastLuckyActionIndex+1);

            // Reset all actions.
            self.applyState();

            actions.forEach(action => {
              let unit = action.unit.assigned;

              self.actions.push(action);

              if (action.type === 'move') {
                unit.assign(action.tile);
                self.moved = true;
              }
              else if (action.type === 'attack') {
                self.attacked = true;
              }
              else if (action.type === 'attackSpecial') {
                self.attacked = true;
              }
              // No need to worry about 'turn'

              self.applyChangeResults(action.results);
            });

            if (actions.length) {
              self.selected = actions[0].unit.assigned;

              if (self.selected.canMove())
                self.setSelectMode('move');
              else if (self.selected.canAttack())
                self.setSelectMode('attack');
              else
                self.setSelectMode('turn');
            }
            else
              self.setSelectMode('move');
          }
        }
      }
    },

    getState: function () {
      // Map unit names to IDs until we get rid of the IDs.
      let unit_id_to_type_map = {};

      Tactics.units.forEach((unit, unitId) => {
        let name = unit.name.replace(/ /g, '');

        unit_id_to_type_map[unitId] = name;
      });

      let degree     = self.getDegree(self.rotation, 'N');
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

      return self.teams.map((team, teamId) =>
        team.units.map(unit => {
          let assignment = self.getTileRotation(unit.assignment, degree);
          let unit_data  = {
            type: unit_id_to_type_map[unit.type],
            tile: [assignment.x, assignment.y],
          };

          if (unit.directional !== false)
            unit_data.direction = self.getRotation(unit.direction, degree);

          properties.forEach(prop => {
            if (unit[prop])
              if (prop === 'focusing')
                unit_data[prop] = unit[prop].map(tile => [tile.x, tile.y]);
              else
                unit_data[prop] = unit[prop];
          });

          return unit_data;
        })
      );
    },
    applyState: function () {
      // Clear the board.
      self.carded = null;
      self.teams.forEach(team =>
        team.units.slice().forEach(unit => self.dropUnit(unit))
      );
      self.actions = [];
      self.moved = self.attacked = self.turned = false;

      // Map unit names to IDs until we get rid of the IDs.
      let unit_type_to_id_map = {};

      Tactics.units.forEach((unit, unitId) => {
        let name = unit.name.replace(/ /g, '');

        unit_type_to_id_map[name] = unitId;
      });

      // Set the board
      let degree = self.getDegree('N', self.rotation);

      self.state.forEach((units_data, teamId) => {
        let team = self.teams[teamId];
        team.units = [];

        units_data.forEach(unit_data => {
          let unit = new Tactics.Unit(unit_type_to_id_map[unit_data.type]);
          unit.team = teamId;

          /*
           * Translate unit assignment and direction based on board rotation.
           */
          unit.draw(
            self.getRotation(unit_data.direction, degree),
            self.getTileRotation(unit_data.tile, degree),
          );
          units_container.addChild(unit.pixi);
          team.units.push(unit);

          Object.keys(unit_data).forEach(key => {
            if (key === 'type' || key === 'tile' || key === 'direction')
              return;

            let value = unit_data[key];

            if (key === 'focusing')
              value = value.map(xy => self.getTile(...xy));

            unit[key] = value;
          });

          if (unit_data.focusing || unit_data.paralyzed || unit_data.poisoned)
            unit.showFocus(0.5);
        });
      });

      return self.drawCard();
    },

    pushHistory: function () {
      // If any units are selected or viewed, deactivate them.
      self.deselect(true);

      self.history.push({
        teamId:  self.currentTeamId,
        units:   self.state,
        actions: self.actions,
      });

      self.currentTeamId = self.teams.getNextIndex(self.currentTeamId, team => !!team.units.length);
      self.state         = self.getState();
      self.actions       = [];
      self.moved         = self.attacked = self.turned = false;

      return self;
    },
    popHistory: function () {
      let history = self.history;
      if (history.length === 0) return;

      // If any units are selected or viewed, deactivate them.
      self.deselect(true);

      let turnData = history.pop();

      self.currentTeamId = turnData.teamId;
      self.state         = turnData.units;

      // Recalculate passed turn count for the team that popped a turn.
      let team = self.teams[self.currentTeamId];
      team.passedTurns = 0;

      for (let i = history.length-1; i > -1; i--) {
        if (history[i].teamId !== self.currentTeamId)
          continue;

        // Stop searching once an action is made (aside from endTurn or endGame).
        if (history[i].actions.length > 1)
          break;

        team.passedTurns++;

        // Stop searching once 2 passed turns are detected.
        if (team.passedTurns === 2)
          break;
      }

      return self.applyState();
    },

    reset: function () {
      self.dropTeams();
      self.eraseCard();
      self.history = [];
      self.currentTeamId = 0;
      self.actions = [];
      self.moved = self.attacked = self.turned = false;

      return self.setSelectMode('move');
    },

    playResults: function (results) {
      if (!Array.isArray(results))
        results = [results];

      let showResult = result => {
        let anim = new Tactics.Animation();
        let unit = result.unit.assigned;

        self.drawCard(unit);

        let changes = Object.assign({}, result.changes);

        // Changed separately
        let mHealth = changes.mHealth;
        delete changes.mHealth;

        unit.change(changes);
        if (result.results)
          self.applyChangeResults(result.results);

        anim.splice(self.animApplyFocusChanges(result));

        if (result.miss) {
          unit.change({notice: 'Miss!'});
          let caption = result.notice || 'Miss!';
          return unit.animCaption(caption).play();
        }

        if ('focusing' in changes) {
          let caption = result.notice;
          if (caption)
            anim.splice(0, unit.animCaption(caption));

          return anim.play();
        }

        if (changes.paralyzed) {
          let caption = result.notice || 'Paralyzed!';
          anim.splice(0, unit.animCaption(caption));

          return anim.play();
        }

        if (changes.poisoned) {
          let caption = result.notice || 'Poisoned!';
          anim.splice(0, unit.animCaption(caption));

          return anim.play();
        }

        if (mHealth !== undefined) {
          let increment;
          let options = {};

          if (mHealth > unit.mHealth)
            options.color = '#00FF00';
          else if (mHealth < unit.mHealth && mHealth !== -unit.health)
            options.color = '#FFBB44';

          // Die if the unit is dead.
          if (mHealth === -unit.health && unit.type !== 15) {
            let caption = result.notice || (unit.paralyzed ? '.......' : 'Nooo...');
            anim
              .splice(0, unit.animCaption(caption, options))
              .splice(unit.animDeath(self));

            unit.change({mHealth:mHealth});
            return anim.play();
          }

          let diff = unit.mHealth - mHealth;
          let caption = result.notice || Math.abs(diff).toString();
          anim.splice(0, unit.animCaption(caption, options));

          // Animate a change in health over 1 second (12 frames)
          if (mHealth !== unit.mHealth) {
            let progress = unit.mHealth;

            anim.splice(0, [
              {
                script: () => {
                  progress += (diff / 8) * -1;
                  unit.change({
                    mHealth: Math.round(progress),
                  });
                },
                repeat: 8,
              },
              // Pause to reflect upon the new health amount
              {
                script: () => {},
                repeat: 4,
              },
            ]);
          }

          return anim.play();
        }
      };

      return results.reduce(
        (promise, result) => promise.then(() =>
          showResult(result))
            .then(() => {
              let unit = result.unit.assigned;
              if (unit) unit.change({notice: null});
            }),
        Promise.resolve(),
      ).then(() => self.drawCard());
    },

    zoomToTurnOptions: function () {
      let panzoom = Tactics.panzoom;

      self.transformToRestore = panzoom.transform;

      // Get the absolute position of the turn options.
      let point = self.selected.assignment.getTop().clone();
      point.y -= 14;

      // Convert coordinates to percentages.
      point.x = point.x / Tactics.width;
      point.y = point.y / Tactics.height;

      panzoom.transitionPointToCenter(point, panzoom.maxScale);

      return self;
    },

    clearHighlight: function (tile) {
      let highlights = [];

      if (tile) {
        let h = highlighted.findIndex(h => h.tile === tile);
        if (h > -1) {
          highlights.push(highlighted[h]);
          highlighted.splice(h, 1);
        }
      }
      else {
        highlights  = highlighted;
        highlighted = [];
      }

      highlights.forEach(highlight => {
        var tile = highlight.tile;

        if (tile.focused && tile.assigned && !self.locked)
          tile.paint('focus', 0.3);
        else
          tile.strip();

        // Only deactivate units that have a mode in case one of them is the attacker.
        if (tile.action == 'target' && tile.assigned && tile.assigned.activated === true)
          tile.assigned.deactivate();

        if (tile.action) {
          tile.action = '';
          tile.set_interactive(!!tile.assigned);
          tile.off('select', highlight.select);
          tile.off('focus',  highlight.focus);
          tile.off('blur',   highlight.blur);
        }
      });
    },
    setHighlight: function (highlight, viewed) {
      var tile = highlight.tile;

      // Clobber an existing highlight on this tile.
      self.clearHighlight(highlight.tile);

      let alpha =
        viewed ? 0.15 :
        tile.focused ? 0.6 : 0.3;

      tile.paint(highlight.action, alpha, highlight.color);

      if (!viewed) {
        tile.action = highlight.action;
        tile.set_interactive(true);
        tile.on('select', highlight.select);
        tile.on('focus',  highlight.focus);
        tile.on('blur',   highlight.blur);
      }

      highlighted.push(highlight);
    }
  });

  return self;
};
