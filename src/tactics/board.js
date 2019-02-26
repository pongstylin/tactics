Tactics.Board = function () {
  'use strict';

  const TILE_WIDTH        = 88;
  const TILE_HEIGHT       = 56;
  const HALF_TILE_WIDTH   = 44;
  const HALF_TILE_HEIGHT  = 28;
  const MOVE_TILE_COLOR   = 0x0088FF;
  const ATTACK_TILE_COLOR = 0xFF8800;
  const TARGET_TILE_COLOR = 0xFF3300;

  var self = this;
  var game = Tactics.game;

  // Keep track of the currently focused tile.
  var focused_tile = null;

  // Map unit names to IDs until we get rid of the IDs.
  var unit_type_to_id_map = {};

  Tactics.units.forEach((unit, unitId) => {
    let name = unit.name.replace(/ /g, '');

    unit_type_to_id_map[name] = unitId;
  });

  var turnOptions;

  function prerenderTurnOptions() {
    turnOptions = new PIXI.Container();

    let onTurnSelect = event => {
      let target = event.target;

      Tactics.sounds.select.play();
      self._hideTurnOptions();
      event.currentTarget.filters = null;

      if (target.data.direction === self.selected.direction)
        self.emit({ type:'endTurn' });
      else
        self.emit({
          type:      'turn',
          direction: target.data.direction,
        });
    };
    let onTurnFocus = event => {
      Tactics.sounds.focus.play();

      let filter = new PIXI.filters.ColorMatrixFilter();
      filter.brightness(1.75);
      event.currentTarget.filters = [filter];
    };
    let onTurnBlur = event => {
      event.currentTarget.filters = null;
    };

    ['turn_tl.png','turn_tr.png','turn_bl.png','turn_br.png'].forEach((image, i) => {
      let sprite = new PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/'+image);
      sprite.interactive = true;
      sprite.buttonMode  = true;
      sprite.click       = onTurnSelect;
      sprite.tap         = onTurnSelect;
      sprite.mouseover   = onTurnFocus;
      sprite.mouseout    = onTurnBlur;

      if (i == 0) {
        sprite.position = new PIXI.Point(-42, -HALF_TILE_HEIGHT);
        sprite.data = {direction:'N'};
      }
      else if (i == 1) {
        sprite.position = new PIXI.Point( 12, -HALF_TILE_HEIGHT);
        sprite.data = {direction:'E'};
      }
      else if (i == 2) {
        sprite.position = new PIXI.Point(-43, 2);
        sprite.data = {direction:'W'};
      }
      else if (i == 3) {
        sprite.position = new PIXI.Point( 12, 2);
        sprite.data = {direction:'S'};
      }

      turnOptions.addChild(sprite);
    });
  }

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
        card.renderer.render(card.stage);
        card.rendering = false;
      });
    }
  };
  var highlighted = new Set();

  card.canvas = card.renderer.view;

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
          notice: {
            type: 'T',
            style: {
              fontFamily: 'Arial',
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

    card:       card,
    carded:     null,

    focused:    null,
    viewed:     null,
    selected:   null,
    targeted:   null,

    rotation:   'N',

    // 2-dimensional array of the units for each team.
    teamsUnits: [],

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

    findPath: function (unit, dest, start) {
      // http://en.wikipedia.org/wiki/A*_search_algorithm
      // Modified to avoid tiles with enemy or unpassable units.
      // Modified to favor a path with no friendly units.
      // Modified to pick a preferred direction, all things being equal.
      start = start || unit.assignment;

      let path     = [];
      let opened   = [];
      let closed   = [];
      let cameFrom = {};
      let gScore   = {};
      let fScore   = {};
      let current;
      let directions = ['N','S','E','W'],direction;
      let i,neighbor,score;

      opened.push(start);
      gScore[start.id] = 0;
      fScore[start.id] = self.getDistance(start, dest);

      while (opened.length) {
        current = opened.shift();

        if (current === dest) {
          while (current !== start) {
            path.unshift(current);
            current = cameFrom[current.id];
          }

          return path;
        }

        closed.push(current);

        // Apply directional preference and factor it into the score.
        direction = self.getDirection(current, dest);
        directions.sort((a,b) => direction.indexOf(b) - direction.indexOf(a));

        for (i = 0; i < directions.length; i++) {
          if (!(neighbor = current[directions[i]])) continue;
          if (neighbor.assigned) {
            if (neighbor.assigned.team !== unit.team) continue;
            if (!neighbor.assigned.isPassable()) continue;
          }
          if (closed.indexOf(neighbor) > -1) continue;

          score = gScore[current.id] + 1 + (i*.1);
          if (neighbor.assigned) score += 0.4;

          if (opened.indexOf(neighbor) === -1 || score < gScore[neighbor.id]) {
            cameFrom[neighbor.id] = current;
            gScore[neighbor.id] = score;
            fScore[neighbor.id] = score + self.getDistance(neighbor, dest);

            if (opened.indexOf(neighbor) === -1)
              opened.push(neighbor);

            opened.sort((a, b) => fScore[a.id] - fScore[b.id]);
          }
        }
      }

      return;
    },

    // Public methods
    draw: function (stage) {
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

        let unit = self.selected || self.viewed;
        if (!unit) return;

        self.emit({ type:'deselect', unit:unit });
      };
      pixi.position = new PIXI.Point(18, 44);

      /*
       * A select event occurs when a unit and/or an action tile is selected.
       */
      var selectEvent = event => {
        let tile = event.target;
        let action = tile.action;

        if (action === 'move')
          self.onMoveSelect(tile);
        else if (action === 'attack')
          self.onAttackSelect(tile);
        else if (action === 'target')
          self.onTargetSelect(tile);
        else
          self.onUnitSelect(tile);
      };

      var focusEvent = event => {
        let type = event.type;
        let tile = event.target;

        /*
         * Make sure tiles are blurred before focusing on a new one.
         */
        if (type === 'focus') {
          if (focused_tile && focused_tile !== tile)
            focused_tile.onBlur();
          focused_tile = tile;
        }
        else if (type === 'blur') {
          if (focused_tile === tile)
            focused_tile = null;
        }

        if (!tile.is_interactive()) return;

        if (type === 'focus')
          self.onTileFocus(tile);
        else
          self.onTileBlur(tile);
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

      stage.addChild(pixi);

      /*
       * While the board sprite and the tile children may be interactive, the units
       * aren't.  So optimize PIXI by not checking them for interactivity.
       */
      units_container = new PIXI.Container();
      units_container.interactiveChildren = false;

      stage.addChild(units_container);

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

      prerenderTurnOptions();

      return self;
    },
    createGradientSpriteForHealthBar: function (options) {
      const healthBarWidth  = 100;
      const healthBarHeight = 6;

      if (!self._healthBarData) self._healthBarData = {};

      let healthBarData = self._healthBarData[options.id];
      let canvas;
      if (healthBarData) {
        canvas = healthBarData.canvas;
      }
      else {
        // The canvas and base texture is only created once.
        canvas = document.createElement('canvas');
        canvas.width  = healthBarWidth;
        canvas.height = healthBarHeight;

        healthBarData = self._healthBarData[options.id] = {canvas:canvas};
      }

      if (healthBarData.size !== options.size) {
        if (healthBarData.texture)
          healthBarData.texture.destroy();

        let ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let gradient = ctx.createLinearGradient(0, 0, healthBarWidth, 0);
        gradient.addColorStop(0.0, options.startColor);
        gradient.addColorStop(0.6, options.shineColor);
        gradient.addColorStop(1.0, options.endColor);

        ctx.fillStyle = gradient;
        ctx.moveTo(10, 0);
        ctx.lineTo(healthBarWidth, 0);
        ctx.lineTo(healthBarWidth - 10, healthBarHeight);
        ctx.lineTo(0, healthBarHeight);
        ctx.closePath();
        ctx.fill();

        if (healthBarData.baseTexture)
          healthBarData.baseTexture.update();
        else
          healthBarData.baseTexture = new PIXI.BaseTexture(canvas);

        let frame = new PIXI.Rectangle();
        frame.width  = options.size * healthBarWidth;
        frame.height = healthBarHeight;

        healthBarData.texture = new PIXI.Texture(healthBarData.baseTexture, frame);
        healthBarData.size    = options.size;
      }

      return new PIXI.Sprite(healthBarData.texture);
    },
    drawHealth: function (unit) {
      var currentHealth = unit.health + unit.mHealth;
      var healthRatio = currentHealth / unit.health;
      var toColorCode = num => '#' + parseInt(num).toString(16);
      var gradientStartColor = Tactics.utils.getColorStop(0xFF0000, 0xc2f442, healthRatio);
      var gradientShineColor = Tactics.utils.getColorStop(gradientStartColor, 0xFFFFFF, 0.7);
      var gradientEndColor = gradientStartColor;

      // Create the health bar sprites
      var healthBarSprite;
      if (healthRatio > 0)
        healthBarSprite = self.createGradientSpriteForHealthBar({
          id:         'healthBar',
          size:       healthRatio,
          startColor: toColorCode(gradientStartColor),
          shineColor: toColorCode(gradientShineColor),
          endColor:   toColorCode(gradientEndColor),
        });
      var underlayBarSprite = self.createGradientSpriteForHealthBar({
        id:         'underlayHealthBar',
        size:       1,
        startColor: '#006600',
        shineColor: '#009900',
        endColor:   '#002200',
      });
      underlayBarSprite.x = 2;
      underlayBarSprite.y = 2;
      underlayBarSprite.alpha = 0.5;

      // Create the health text
      var textOptions = {
        fontFamily:      'Arial',
        fontSize:        '12px',
        stroke:          0,
        strokeThickness: 3,
        fill:            'white',
      };
      var currentHealthText = new PIXI.Text(
        currentHealth,
        textOptions,
      );
      currentHealthText.x = 28;
      currentHealthText.y = -16;
      currentHealthText.anchor.x = 1;
      var dividedByText = new PIXI.Text(
        '/',
        {...textOptions, fontSize: '20px'}
      );
      dividedByText.x = 27;
      dividedByText.y = -17;
      var totalHealthText = new PIXI.Text(
        unit.health,
        textOptions,
      );
      totalHealthText.x = 34;
      totalHealthText.y = -10;

      // Add everything to a container
      var container = new PIXI.Container();
      container.addChild(underlayBarSprite);
      if (healthBarSprite)
        container.addChild(healthBarSprite);
      container.addChild(currentHealthText);
      container.addChild(dividedByText);
      container.addChild(totalHealthText);
      return container;
    },
    // Make sure units overlap naturally.
    sortUnits: function () {
      units_container.children.sort((a, b) => a.y - b.y);
    },
    /*
     * Draw an information card based on these priorities:
     *   1) The provided 'unit' argument (optional)
     *   2) The unit that the user is currently focused upon
     *   3) The unit that the user has selected for viewing.
     *   4) The unit that the user has selected for control.
     *   5) The trophy avatar with the optional default notice.
     */
    drawCard: function (unit, defaultNotice) {
      let els = card.elements;
      let mask;
      let notice;
      let notices = [];
      let important = 0;

      if (unit === undefined)
        unit = self.focused || self.viewed || self.targeted || self.selected;

      if (els.healthBar.children.length) els.healthBar.removeChildren();

      if (unit) {
        mask = new PIXI.Graphics();
        mask.drawRect(0,0,88,60);

        els.notice.x = 174;
        els.notice.y = 27;
        els.notice.anchor.x = 1;
        els.notice.style.fontSize = unit.notice ? '12px' : '11px';

        els.healthBar.addChild(self.drawHealth(unit));

        //
        //  Status Detection
        //
        if (unit.mHealth === -unit.health) {
          if (unit.type === 15)
            notice = 'Hatched!';
          else
            notice = 'Dead!';
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

        if (unit.title)
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

        els.armor.text = unit.armor || '--';

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
      else if (defaultNotice) {
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

        els.notice.x = 74;
        els.notice.y = 32;
        els.notice.anchor.x = 0;
        els.notice.style.fontSize = '12px';
        els.notice.text = defaultNotice;

        //
        // Hide the rest.
        //
        els.layer1.visible = false;
        els.layer2.visible = false;
        els.layer3.visible = false;

        card.stage.buttonMode = true;
        card.render();
      }

      let old_carded = self.carded;
      self.carded = unit || null;

      if (old_carded !== unit) {
        if (old_carded)
          old_carded.off('change', card.listener);
        if (unit)
          unit.on('change', card.listener = () => self.drawCard(unit));

        self.emit({
          type:   'card-change',
          ovalue: old_carded,
          nvalue: unit,
        });
      }

      return self;
    },
    eraseCard: function () {
      if (!self.carded) return;

      card.stage.buttonMode = false;

      self.carded.off('change',card.listener);
      self.emit({type:'card-change',ovalue:self.carded,nvalue:null});
      self.carded = null;

      return self;
    },

    addUnit: function (unit_data, team) {
      let unit = new Tactics.Unit(unit_type_to_id_map[unit_data.type]);
      unit.team = team;

      unit.draw(unit_data.direction, unit_data.tile);
      units_container.addChild(unit.pixi);
      self.teamsUnits[team.id].push(unit);

      Object.keys(unit_data).forEach(key => {
        if (key === 'type' || key === 'tile' || key === 'direction')
          return;

        let value = unit_data[key];

        if (key === 'focusing' || key === 'paralyzed' || key === 'poisoned')
          value = value.map(xy => self.getTile(...xy));

        unit[key] = value;
      });

      if (unit_data.focusing || unit_data.paralyzed || unit_data.poisoned)
        unit.showFocus(0.5);

      return self;
    },
    dropUnit: function (unit) {
      var units = self.teamsUnits[unit.team.id];

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

      units.splice(units.indexOf(unit), 1);
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
      let units     = self.teamsUnits.flat();
      let degree    = self.getDegree(self.rotation, rotation);
      let activated = self.viewed || self.selected

      if (activated) self.hideMode();

      if (self.target)
        self.target = self.getTileRotation(self.target, degree);

      units.forEach(unit => {
        unit.assign(self.getTileRotation(unit.assignment, degree));
        unit.stand(self.getRotation(unit.direction, degree));
      });

      if (activated) self.showMode();

      self.rotation = rotation;

      return self;
    },

    lock: function (value) {
      if (self.locked === value) return;
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
      });

      self.emit({
        type:   'lock-change',
        ovalue: old_locked,
        nvalue: false,
      });
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

      return self.teamsUnits.map(units =>
        units.map(unit => {
          let assignment = self.getTileRotation(unit.assignment, degree);
          let unit_data  = {
            type: unit_id_to_type_map[unit.type],
            tile: [assignment.x, assignment.y],
          };

          if (unit.directional !== false)
            unit_data.direction = self.getRotation(unit.direction, degree);

          properties.forEach(prop => {
            if (unit[prop])
              if (prop === 'focusing' || prop === 'paralyzed' || prop === 'poisoned')
                unit_data[prop] = unit[prop].map(tile => [tile.x, tile.y]);
              else
                unit_data[prop] = unit[prop];
          });

          return unit_data;
        })
      );
    },
    setState: function (teamsUnits, teams) {
      self.clear();

      // Set the board
      let degree = self.getDegree('N', self.rotation);

      teamsUnits.forEach((units_data, teamId) => {
        let team = teams[teamId];

        self.teamsUnits.push(team.units = []);

        units_data.forEach(unit_data => {
          // Adjust assignment and direction based on board rotation.
          unit_data = Object.assign({}, unit_data, {
            tile:      self.getTileRotation(unit_data.tile, degree),
            direction: self.getRotation(unit_data.direction, degree),
          });

          self.addUnit(unit_data, team);
        });
      });

      return self.drawCard();
    },

    clear: function () {
      self.eraseCard();
      self.teamsUnits.flat().forEach(unit => self.dropUnit(unit));
      self.teamsUnits = [];

      return self;
    },

    showMode: function () {
      let selected = self.selected;
      if (selected && selected.activated === 'target')
        self.hideMode();
      else
        self.clearMode();

      let unit = self.viewed || selected;
      if (!unit) return;

      let mode = unit.activated;
      let view_only = !!self.viewed;

      if (mode === 'move')
        self._highlightMove(unit, view_only);
      else if (mode === 'attack')
        self._highlightAttack(unit, view_only);
      else if (mode === 'target')
        self._highlightTarget(unit);
      else if (mode === 'turn') {
        if (self.viewed)
          self._showDirection(unit);
        else
          self._showTurnOptions(unit);
      }

      return self;
    },
    hideMode: function () {
      let unit = self.viewed || self.selected;
      if (!unit) return;

      let mode = unit.activated;

      // Useful when clearing an attack or target mode
      if (self.focused)
        self.focused.change({ notice:null });

      if (self.target || (mode === 'attack' && unit.aAll))
        self.hideTargets();

      self._clearHighlight();
      self._hideTurnOptions();

      return self;
    },
    clearMode: function () {
      self.hideMode();
      self.target = null;

      return self;
    },

    showTargets: function () {
      let selected     = self.selected;
      let target       = self.target;
      let target_units = selected.getTargetUnits(target);

      // Units affected by the attack will pulsate.
      target_units.forEach(tu => {
        if (tu !== selected) tu.activate();
      });

      // If only one unit is affected, draw card.
      if (target_units.length === 1) {
        selected.setTargetNotice(target_units[0], target);
        self.targeted = target_units[0];
        self.drawCard(self.targeted);
      }

      return self;
    },
    hideTargets: function () {
      let selected     = self.selected;
      let target       = self.target;
      let target_units = selected.getTargetUnits(target);

      target_units.forEach(tu => {
        // Edge case: A pyro can target himself.
        if (tu === selected)
          tu.change({ notice:null });
        else
          tu.deactivate();
      });

      let targeted = self.targeted;
      if (targeted) {
        targeted.change({ notice:null });
        self.targeted = null;
        self.drawCard();
      }

      return self;
    },

    _showTurnOptions: function (unit) {
      let stage = game.stage;

      turnOptions.data = { unit:unit };
      turnOptions.position = unit.assignment.getTop().clone();
      turnOptions.position.y -= HALF_TILE_HEIGHT / 2;

      turnOptions.children.forEach(arrow => {
        arrow.interactive = arrow.buttonMode = true;
        arrow.visible = true;
      });

      if (stage.children.indexOf(turnOptions) === -1)
        stage.addChild(turnOptions);

      return self;
    },
    _showDirection: function (unit) {
      let stage = game.stage;

      turnOptions.data = { unit:unit };
      turnOptions.position = unit.assignment.getTop().clone();
      turnOptions.position.y -= HALF_TILE_HEIGHT / 2;

      turnOptions.children.forEach(arrow => {
        arrow.interactive = arrow.buttonMode = false;
        arrow.visible = unit.directional === false || arrow.data.direction == unit.direction;
      });

      if (stage.children.indexOf(turnOptions) === -1)
        stage.addChild(turnOptions);

      return self;
    },
    _hideTurnOptions: function () {
      let stage = game.stage;
      if (stage.children.indexOf(turnOptions) > -1)
        stage.removeChild(turnOptions);

      return self;
    },

    _highlightMove: function (unit, view_only) {
      let tiles = unit.getMoveTiles();

      self.setHighlight(tiles, {
        action: 'move',
        color:  MOVE_TILE_COLOR,
      }, view_only);

      return self;
    },
    _highlightAttack: function (unit, view_only) {
      if (!view_only && unit.aAll)
        return self._highlightTarget(unit);

      let tiles = unit.getAttackTiles();

      self.setHighlight(tiles, {
        action: 'attack',
        color:  ATTACK_TILE_COLOR,
      }, view_only);

      return self;
    },
    _highlightTarget: function (unit) {
      let tiles = unit.getTargetTiles(self.target);

      self.setHighlight(tiles, {
        action: 'target',
        color:  TARGET_TILE_COLOR,
      });

      self.showTargets();

      return self;
    },

    _highlightTargetMix: function (target) {
      let selected = self.selected;

      // Show target tiles
      selected.getTargetTiles(target).forEach(tile => {
        if (tile === target)
          // Reconfigure the focused tile to be a target tile.
          self.setHighlight(tile, {
            action: 'target',
            color:  TARGET_TILE_COLOR,
          });
        else
          // This attack tile only looks like a target tile.
          self.setHighlight(tile, {
            action: 'attack',
            color:  TARGET_TILE_COLOR,
          });
      });

      // Configure the target in case the attack is initiated.
      self.target = target;
      self.showTargets();

      return self;
    },
    _clearTargetMix: function (target) {
      let selected = self.selected;
      if (selected.aAll) return;

      let attackTiles = selected.getAttackTiles();

      // Reset target tiles to attack tiles
      selected.getTargetTiles(target).forEach(tile => {
        if (attackTiles.indexOf(tile) > -1)
          self.setHighlight(tile, {
            action: 'attack',
            color:  ATTACK_TILE_COLOR,
          });
        else
          self._clearHighlight(tile);
      });

      self.hideTargets();
      self.target = null;
    },

    onTileFocus: function (tile) {
      /*
       * Brighten the tile to show that it is being focused.
       */
      if (tile.action)
        tile.setAlpha(0.6);
      else if (tile.painted && tile.painted !== 'focus')
        tile.setAlpha(0.3);
      else
        tile.paint('focus', 0.3);

      let selected = self.selected;
      let unit = tile.assigned;

      if (tile.action === 'attack') {
        // Single-click attacks are only enabled for mouse pointers.
        if (game.pointerType === 'mouse')
          self._highlightTargetMix(tile);
        else if (unit)
          selected.setTargetNotice(unit);
      }
      else if (tile.action === 'target') {
        if (unit)
          selected.setTargetNotice(unit);
      }

      /*
       * Emit a change in unit focus.
       */
      let focused = self.focused;
      if (focused === unit || !unit)
        return;

      self.emit({ type:'focus', unit:unit });
    },
    onTileBlur: function (tile) {
      /*
       * Darken the tile when no longer focused.
       */
      if (tile.action)
        tile.setAlpha(0.3);
      else if (tile.painted && tile.painted !== 'focus')
        tile.setAlpha(0.15);
      else
        tile.strip();

      let unit = tile.assigned;

      // Single-click attacks are only enabled for mouse pointers.
      if (tile.action === 'attack') {
        if (unit)
          unit.change({ notice:null });
      }
      else if (tile.action === 'target') {
        if (unit && unit !== self.targeted)
          unit.change({ notice:null });

        if (game.pointerType === 'mouse')
          self._clearTargetMix(tile);
      }

      /*
       * Emit a change in unit focus.
       */
      let focused = self.focused;
      if (focused !== unit || !focused)
        return;

      self.emit({ type:'blur', unit:unit });
    },

    onMoveSelect: function (tile) {
      self.emit({
        type: 'move',
        tile: tile,
      });
    },
    onAttackSelect: function (tile) {
      self.target = tile;
      game.selectMode = 'target';
    },
    onTargetSelect: function (tile) {
      let selected = self.selected;
      let target = self.target;
      let action = {
        type: 'attack',
      };

      // Units that attack all targets don't have a specific target tile.
      if (target)
        action.tile = target;
      else {
        // Set unit to face the direction of the tapped tile.
        // (This is an aesthetic data point that needs no server validation)
        let direction = self.getDirection(
          selected.assignment,
          target || tile,
          selected.direction
        );
        if (direction !== selected.direction)
          action.direction = direction;
      }

      self.emit(action);
    },
    onUnitSelect: function (tile) {
      let unit = tile.assigned;

      self.emit({ type:'select', unit:unit });
    },

    setHighlight: function (tiles, highlight, viewed) {
      if (!Array.isArray(tiles)) tiles = [tiles];

      // Trigger the 'focus' event when highlighting the focused tile.
      let trigger_focus = false;

      tiles.forEach(tile => {
        let alpha = viewed ? 0.15 : 0.3;
        if (tile.focused && (tile.is_interactive() || !viewed))
          alpha *= 2;

        tile.paint(highlight.action, alpha, highlight.color);

        if (!viewed) {
          tile.action = highlight.action;

          if (tile === focused_tile)
            trigger_focus = true;
          else
            tile.set_interactive(true);
        }

        highlighted.add(tile);
      });

      // The 'focus' event is delayed until all tiles are highlighted.
      if (trigger_focus)
        if (focused_tile.is_interactive())
          self.onTileFocus(focused_tile);
        else
          focused_tile.set_interactive(true);
    },
    _clearHighlight: function (tile) {
      let highlights = [];

      if (tile) {
        if (highlighted.has(tile)) {
          highlights.push(tile);
          highlighted.delete(tile);
        }
      }
      else {
        highlights  = highlighted;
        highlighted = new Set();
      }

      highlights.forEach(tile => {
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
        }
      });
    },
  });

  return self;
};
