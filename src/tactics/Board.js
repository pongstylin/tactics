'use strict';

import EventEmitter from 'events';
import Tile from 'tactics/Tile.js';
import unitFactory from 'tactics/unitFactory.js';
import colorMap from 'tactics/colorMap.js';

export const TILE_WIDTH        = 88;
export const TILE_HEIGHT       = 56;
export const HALF_TILE_WIDTH   = 44;
export const HALF_TILE_HEIGHT  = 28;
export const FOCUS_TILE_COLOR  = 0xFFFFFF;
export const MOVE_TILE_COLOR   = 0x0088FF;
export const ATTACK_TILE_COLOR = 0xFF8800;
export const TARGET_TILE_COLOR = 0xFF3300;

export default class {
  constructor() {
    let tiles = new Array(11*11);
    var sx = 6 - TILE_WIDTH;        // padding-left, 1 tile  wide
    var sy = 4 + TILE_HEIGHT*4 + 1; // padding-top , 4 tiles tall, tweak

    for (let x = 0; x < 11; x++) {
      let start = 0;
      let stop  = 11;
      if (x == 0)  { start = 2; stop =  9; }
      if (x == 1)  { start = 1; stop = 10; }
      if (x == 9)  { start = 1; stop = 10; }
      if (x == 10) { start = 2; stop =  9; }

      for (let y = start; y < stop; y++) {
        let index = x + y*11;
        let tile  = tiles[index] = new Tile(x, y);

        // Even when operating in headless mode, the relative position of tiles
        // still need to be known to facilitate LOS targetting.
        tile.position = [
          sx + tile.x*HALF_TILE_WIDTH  + tile.y*HALF_TILE_WIDTH,
          sy - tile.x*HALF_TILE_HEIGHT + tile.y*HALF_TILE_HEIGHT,
        ];
      }
    }

    // Create relationships between tiles (used in path finding)
    Object.values(tiles).forEach(tile => {
      let index = tile.x + tile.y*11;

      tile.N = tile.y >  0 ? tiles[index - 11] : null;
      tile.S = tile.y < 10 ? tiles[index + 11] : null;
      tile.E = tile.x < 10 ? tiles[index +  1] : null;
      tile.W = tile.x >  0 ? tiles[index -  1] : null;
    });

    Object.assign(this, {
      tiles:       tiles,
      pixi:        undefined,
      locked:      'readonly',
      focusedTile: null,

      card:        null,
      carded:      null,

      focused:     null,
      viewed:      null,
      selected:    null,
      targeted:    null,

      rotation:    'N',

      teams: [],
      teamsUnits: [], // 2-dimensional array of the units for each team.

      /*
       * Private properties
       */
      _trophy:          null,
      _units_container: null,
      _highlighted:     new Set(),
      _emitter:         new EventEmitter(),
    });
  }

  initCard() {
    let card = {
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

    card.canvas = card.renderer.view;

    card.stage.hitArea = new PIXI.Polygon([0,0, 175,0, 175,99, 0,99]);
    card.stage.interactive = card.stage.buttonMode = true;
    card.stage.pointertap = () => {
      let els = card.elements;

      if (els.layer1.visible) {
        els.layer1.visible = !(els.layer2.visible = true);
        return card.render();
      }
      else if (els.layer2.visible) {
        els.layer2.visible = !(els.layer3.visible = true);
        return card.render();
      }

      this.eraseCard();
    };

    let style = card.renderer.context.createLinearGradient(0,0,176,0);
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
          draw: function (pixi) {
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

    return this.card = card;
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  // Property accessors
  getTile(x, y) {
    return this.tiles[x+y*11];
  }
  /*
   * Get all tiles that are within range.
   *  start: (Tile) The start tile.
   *  min: (Number) The minimum range.  Use zero to include start tile.
   *  max: (Number) The maximum range.  Should be greater than 'min'.
   *  isUnassigned: (Boolean) Whether tiles must be unassigned.
   *
   * Example: Determine Dragon movement range.
   *  getTileRange(unit.assignment, 1, 3, true);
   *
   * Example: Determine Pyromancer attack range.
   *  getTileRange(unit.assignment, 0, 3);
   *
   * Example: Determine Pyromancer target range.
   *  getTileRange(unit.assignment, 0, 1);
   *
   * Example: Determine Ambusher attack range.
   *  getTileRange(unit.assignment, 2, 5);
   *
   * Code must be as optimized as possible.
   */
  getTileRange(start, min, max, isUnassigned) {
    let tiles = this.tiles;
    let ylb = Math.max(0,  start.y - max);     // Y Lower-Bound (inclusive)
    let yub = Math.min(10, start.y + max) + 1; // Y Upper-Bound (exclusive)
    let xlb = Math.max(0,  start.x - max);
    let xub = Math.min(10, start.x + max) + 1;
    let distance = 0;
    let sx = start.x, sy = start.y;
    let x, y;
    let tile;
    let range = [];

    for (y = ylb; y < yub; y++) {
      for (x = xlb; x < xub; x++) {
        distance = Math.abs(sy - y) + Math.abs(sx - x);
        if (distance < min) continue;
        if (distance > max) continue;

        tile = tiles[y*11 + x];
        if (!tile || (isUnassigned && tile.assigned))
          continue;

        range.push(tile);
      }
    }

    return range;
  }
  getTileLinearRange(start, radius) {
    let tiles = [];
    let north = start.N;
    let south = start.S;
    let east = start.E;
    let west = start.W;

    for (let x = 0; x < radius; x++) {
      if (north) {
        tiles.push(north);
        north = north.N;
      }
      if (south) {
        tiles.push(south);
        south = south.S;
      }
      if (east) {
        tiles.push(east);
        east = east.E;
      }
      if (west) {
        tiles.push(west);
        west = west.W;
      }
    }

    return tiles;
  }
  /*
   * Get all tiles that are within movement path range.
   *
   * Example: Determine Knight path range.
   *  getUnitRange(unit);
   *
   * Code must be as optimized as possible.
   */
  getUnitPathRange(unit) {
    let start   = unit.assignment;
    let max     = unit.mRadius;
    let tiles   = [];
    let search  = [[start,0]];
    let checked = new Set([start]);
    let tile;
    let tUnit;
    let distance;

    for (let i=0; i<search.length; i++) {
      tile = search[i][0];
      tUnit = tile.assigned;
      distance = search[i][1];

      if (tUnit) {
        if (tUnit !== unit)
          if (tUnit.team !== unit.team || !tUnit.isPassable())
            continue;
      }
      else
        tiles.push(tile);

      if (distance < max) {
        distance++;
        if (tile.N && !checked.has(tile.N)) {
          checked.add(tile.N);
          search.push([tile.N, distance]);
        }
        if (tile.E && !checked.has(tile.E)) {
          checked.add(tile.E);
          search.push([tile.E, distance]);
        }
        if (tile.S && !checked.has(tile.S)) {
          checked.add(tile.S);
          search.push([tile.S, distance]);
        }
        if (tile.W && !checked.has(tile.W)) {
          checked.add(tile.W);
          search.push([tile.W, distance]);
        }
      }
    }

    return tiles;
  }

  // Public functions
  getDistance(a, b) {
    // Return the distance between two tiles.
    return Math.abs(a.x-b.x) + Math.abs(a.y-b.y);
  }
  getBetween(a, b, empty) {
    var distance = this.getDistance(a,b);
    var dx = Math.abs(a.x-b.x);
    var dy = Math.abs(a.y-b.y);
    var x,y;
    var tile,tiles = [];

    for (x=a.x-dx; x<a.x+dx+1; x++)
    {
      for (y=a.y-dy; y<a.y+dy+1; y++)
      {
        if (x == a.x && y == a.y) continue;
        if (!(tile = this.getTile(x,y))) continue;

        if (!empty || !tile.assigned) tiles.push(tile);
      }
    }

    return tiles;
  }
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
  getDirection(a, b, simple) {
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
        this.getRotation(simple, 90),
        this.getRotation(simple, -90),
      ].find(d => direction.indexOf(d) > -1);

    return direction;
  }
  getRotation(direction, degree) {
    var directions = ['N','NE','E','SE','S','SW','W','NW'];
    // 90 = 360 / directions.length;
    var index = directions.indexOf(direction) + (degree / 45);

    // 3 = directions.length-1; 4 = directions.length;
    return directions.slice(index > 7 ? index-8 : index)[0];
  }
  /*
   * Get the degree difference between direction and rotation.
   *
   * Example: getDegree('N', 'E') =  90 degrees
   * Example: getDegree('N', 'W') = 270 degrees
   * Example: getDegree('S', 'E') = -90 degrees
   */
  getDegree(direction, rotation) {
    var directions = ['N','NE','E','SE','S','SW','W','NW'];

    return (directions.indexOf(rotation) - directions.indexOf(direction)) * 45;
  }
  /*
   * The 'coords' can be either an xy tuple or object (e.g. tile object)
   * Coords object must have 'x' and 'y' properties.
   */
  getTileRotation(coords, degree) {
    if (coords.length === undefined)
      coords = [coords.x, coords.y];

    if (degree === 0)
      return this.getTile(...coords);
    else if (degree ===  90 || degree === -270)
      return this.getTile(10 - coords[1], coords[0]);
    else if (degree === 180 || degree === -180)
      return this.getTile(10 - coords[0], 10 - coords[1]);
    else if (degree === 270 || degree ===  -90)
      return this.getTile(coords[1], 10 - coords[0]);

    return null;
  }

  findPath(unit, dest) {
    // http://en.wikipedia.org/wiki/A*_search_algorithm
    // Modified to avoid tiles with enemy or unpassable units.
    // Modified to favor a path with no friendly units.
    // Modified to pick a preferred direction, all things being equal.

    let start    = unit.assignment;
    let path     = [];
    let opened   = [];
    let closed   = [];
    let cameFrom = {};
    let gScore   = {};
    let fScore   = {};
    let current;
    let directions = ['N','S','E','W'], direction;
    // This is the desired final direction, if possible.
    let fdirection = this.getDirection(start, dest, unit.direction);
    let i,neighbor,score;

    opened.push(start);
    gScore[start.id] = 0;
    fScore[start.id] = this.getDistance(start, dest);

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

      for (i = 0; i < directions.length; i++) {
        direction = directions[i];

        if (!(neighbor = current[direction])) continue;
        if (neighbor.assigned) {
          if (neighbor.assigned.team !== unit.team) continue;
          if (!neighbor.assigned.isPassable()) continue;
        }
        if (closed.includes(neighbor)) continue;

        // Use anything but the final direction for a score tie breaker.
        score = gScore[current.id] + 1 + (direction === fdirection ? 0.1 : 0);
        if (neighbor.assigned) score += 0.4;

        if (!opened.includes(neighbor) || score < gScore[neighbor.id]) {
          cameFrom[neighbor.id] = current;
          gScore[neighbor.id] = score;
          fScore[neighbor.id] = score + this.getDistance(neighbor, dest);

          if (!opened.includes(neighbor))
            opened.push(neighbor);

          opened.sort((a, b) => fScore[a.id] - fScore[b.id]);
        }
      }
    }

    return;
  }

  // Public methods
  draw(stage) {
    var pixi = this.pixi = PIXI.Sprite.fromImage('https://tactics.taorankings.com/images/board.png');
    var tiles = this.tiles;

    // The board itself is interactive since we want to detect a tap on a
    // blank tile to cancel current selection, if sensible.  Ultimately, this
    // functionality needs to be provided by an 'undo' button.
    pixi.interactive = true;
    pixi.pointertap = event => {
      if (this.locked === true) return;

      let unit = this.selected || this.viewed;
      if (!unit) return;

      this._emit({ type:'deselect', unit:unit });
    };
    pixi.position = new PIXI.Point(18, 44);

    /*
     * A select event occurs when a unit and/or an action tile is selected.
     */
    var selectEvent = event => {
      let tile = event.target;
      let action = tile.action;

      if (action === 'move')
        this.onMoveSelect(tile);
      else if (action === 'attack')
        this.onAttackSelect(tile);
      else if (action === 'target')
        this.onTargetSelect(tile);
      else
        this.onUnitSelect(tile);
    };

    var focusEvent = event => {
      let type = event.type;
      let tile = event.target;

      /*
       * Make sure tiles are blurred before focusing on a new one.
       */
      let focusedTile = this.focusedTile;
      if (type === 'focus') {
        if (focusedTile && focusedTile !== tile)
          focusedTile.onBlur();
        this.focusedTile = tile;
      }
      else if (type === 'blur') {
        // The tile might not actually be blurred if the blur event was fired in
        // response to the board becoming locked and tile non-interactive
        if (!this.focusedTile.focused)
          this.focusedTile = null;
      }

      if (!tile.is_interactive()) return;

      if (type === 'focus')
        this.onTileFocus(tile);
      else
        this.onTileBlur(tile);
    };

    Object.values(tiles).forEach(tile => {
      tile.on('select',     selectEvent);
      tile.on('focus blur', focusEvent);
      tile.on('assign', event => {
        if (this.locked !== true)
          event.target.set_interactive(true);
      });
      tile.on('dismiss', event => {
        event.target.set_interactive(false);
      });
      tile.draw();

      pixi.addChild(tile.pixi);
    });

    stage.addChild(pixi);

    /*
     * While the board sprite and the tile children may be interactive, the units
     * aren't.  So optimize PIXI by not checking them for interactivity.
     */
    let units_container = new PIXI.Container();
    units_container.interactiveChildren = false;
    this._units_container = units_container;

    stage.addChild(units_container);

    // Required to place units in the correct places.
    pixi.updateTransform();

    // Hack to avoid apparent bug where x/y offsets change
    Object.values(tiles).forEach(tile => { tile.getCenter() });

    this.drawShocks();
    this.drawTurnOptions();

    // Preload the Trophy data URLs
    this._trophy = unitFactory('Champion', this);
    this._trophy.drawAvatar();

    return this;
  }
  drawShocks() {
    let shocks = [
      new PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/shock.png'),
      new PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/shock.png'),
      new PIXI.Sprite.fromImage('https://legacy.taorankings.com/images/shock.png')
    ];

    shocks[0].anchor = new PIXI.Point(0.5, 0.5);
    shocks[0].scale = new PIXI.Point(4.65, 0.65);
    shocks[0].rotation = 0.5;

    shocks[1].anchor = new PIXI.Point(0.5, 0.5);
    shocks[1].scale = new PIXI.Point(2, 0.7);
    shocks[1].rotation = 0.5;

    shocks[2].anchor = new PIXI.Point(0.5, 0.5);
    shocks[2].scale = new PIXI.Point(0.4, 3);
    shocks[2].rotation = 0.5;
    shocks[2].alpha = 0.5;

    return this.shocks = shocks;
  }
  drawTurnOptions() {
    let turnOptions = new PIXI.Container();
    let onTurnSelect = event => {
      let target = event.target;

      Tactics.sounds.select.play();
      this.hideTurnOptions();
      event.currentTarget.filters = null;

      this._emit({
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

    return this._turnOptions = turnOptions;
  }

  createGradientSpriteForHealthBar(options) {
    const healthBarWidth  = 100;
    const healthBarHeight = 6;

    if (!this._healthBarData) this._healthBarData = {};

    let healthBarData = this._healthBarData[options.id];
    let canvas;
    if (healthBarData) {
      canvas = healthBarData.canvas;
    }
    else {
      // The canvas and base texture is only created once.
      canvas = document.createElement('canvas');
      canvas.width  = healthBarWidth;
      canvas.height = healthBarHeight;

      healthBarData = this._healthBarData[options.id] = {canvas:canvas};
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
  }
  drawHealth(unit) {
    var currentHealth = unit.health + unit.mHealth;
    var healthRatio = currentHealth / unit.health;
    var toColorCode = num => '#' + parseInt(num).toString(16);
    var gradientStartColor = Tactics.utils.getColorStop(0xFF0000, 0xc2f442, healthRatio);
    var gradientShineColor = Tactics.utils.getColorStop(gradientStartColor, 0xFFFFFF, 0.7);
    var gradientEndColor = gradientStartColor;

    // Create the health bar sprites
    var healthBarSprite;
    if (healthRatio > 0)
      healthBarSprite = this.createGradientSpriteForHealthBar({
        id:         'healthBar',
        size:       healthRatio,
        startColor: toColorCode(gradientStartColor),
        shineColor: toColorCode(gradientShineColor),
        endColor:   toColorCode(gradientEndColor),
      });
    var underlayBarSprite = this.createGradientSpriteForHealthBar({
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
  }
  // Make sure units overlap naturally.
  sortUnits() {
    this._units_container.children.sort((a, b) => a.y - b.y);
  }
  /*
   * Draw an information card based on these priorities:
   *   1) The provided 'unit' argument (optional)
   *   2) The unit that the user is currently focused upon
   *   3) The unit that the user has selected for viewing.
   *   4) The unit that the user has selected for control.
   *   5) The trophy avatar with the optional default notice.
   */
  drawCard(unit, defaultNotice) {
    if (!this.card) return;

    let card = this.card;
    let els  = card.elements;
    let mask;
    let notice;
    let notices = [];
    let important = 0;

    if (unit === undefined)
      unit = this.focused || this.viewed || this.targeted || this.selected;

    if (els.healthBar.children.length) els.healthBar.removeChildren();

    if (unit) {
      mask = new PIXI.Graphics();
      mask.drawRect(0,0,88,60);

      els.notice.x = 174;
      els.notice.y = 27;
      els.notice.anchor.x = 1;
      els.notice.style.fontSize = unit.notice ? '12px' : '11px';

      els.healthBar.addChild(this.drawHealth(unit));

      //
      //  Status Detection
      //
      if (unit.mHealth === -unit.health) {
        if (unit.type === 'ChaosSeed')
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
      unit = this._trophy;

      mask = new PIXI.Graphics();
      mask.drawRect(0,0,88,60);

      //
      //  Draw the top part of the card.
      //
      if (els.avatar.children.length) els.avatar.removeChildren();
      els.avatar.addChild(unit.drawAvatar());
      els.avatar.children[0].mask = mask;

      els.name.text = 'Champion';

      els.notice.x = 110;
      els.notice.y = 32;
      els.notice.anchor.x = 0.5;
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
    else
      this.eraseCard();

    let old_carded = this.carded;
    this.carded = unit || null;

    if (old_carded !== unit) {
      if (old_carded)
        old_carded.off('change', card.listener);
      if (unit)
        unit.on('change', card.listener = () => this.drawCard(unit));

      this._emit({
        type:   'card-change',
        ovalue: old_carded,
        nvalue: unit,
      });
    }

    return this;
  }
  eraseCard() {
    let card = this.card;
    if (!card) return;

    let carded = this.carded;
    if (!carded) return;

    card.stage.buttonMode = false;

    carded.off('change', card.listener);
    this._emit({ type:'card-change', ovalue:carded, nvalue:null });
    this.carded = null;

    return this;
  }

  addUnit(unitState, team) {
    if (Array.isArray(unitState.assignment))
      unitState.assignment = this.getTile(...unitState.assignment);

    let unit = unitFactory(unitState.type, this);
    unit.id = unitState.id;
    unit.team = team;
    unit.color = 'color' in unitState
      ? unitState.color
      : colorMap.get('colorId' in unitState ? unitState.colorId : team.colorId);
    unit.assign(unitState.assignment);
    unit.stand(unit.directional === false ? 'S' : unitState.direction);

    let units_container = this._units_container;
    if (units_container) {
      unit.draw();
      this._units_container.addChild(unit.pixi);
    }

    team.units.push(unit);

    Object.keys(unitState).forEach(key => {
      if (key === 'type' || key === 'tile' || key === 'direction')
        return;

      unit[key] = unitState[key];
    });

    if (unit.pixi)
      if (unitState.focusing || unitState.paralyzed || unitState.poisoned)
        unit.showFocus(0.5);

    return unit;
  }
  dropUnit(unit) {
    var units = this.teamsUnits[unit.team.id];

    if (unit == this.focused) {
      unit.blur();
      this.focused = null;
    }

    if (unit == this.viewed) {
      unit.deactivate();
      this.viewed = null;
    }

    if (unit == this.selected) {
      unit.deactivate();
      this.selected = null;
    }

    if (unit == this.carded)
      this.drawCard();

    units.splice(units.indexOf(unit), 1);
    unit.assign(null);

    let units_container = this._units_container;
    if (units_container) units_container.removeChild(unit.pixi);

    return this;
  }

  /*
    This does not actually rotate the board - that causes all kinds of
    complexity.  Rather, it rearranges the units so that it appears the
    board has rotated.  This means unit coordinates and directions must
    be translated to a server based on our current rotation.
  */
  rotate(rotation) {
    let degree;
    if (typeof rotation === 'number') {
      degree = rotation;
      rotation = this.getRotation(this.rotation, degree);
    }
    else
      degree = this.getDegree(this.rotation, rotation);

    let units     = this.teamsUnits.flat();
    let activated = this.viewed || this.selected

    if (activated) this.hideMode();

    if (this.target)
      this.target = this.getTileRotation(this.target, degree);

    units.forEach(unit => {
      unit.assign(this.getTileRotation(unit.assignment, degree));
      unit.stand(this.getRotation(unit.direction, degree));
    });

    if (activated) this.showMode();

    this.rotation = rotation;

    return this;
  }

  lock(value = true) {
    let old_locked = this.locked;
    if (old_locked === value) return;
    this.locked = value;

    if (this.locked === true)
      this.tiles.forEach(tile => tile.set_interactive(false));
    if (old_locked === true)
      this.tiles.forEach(tile => {
        tile.set_interactive(!!(tile.action || tile.assigned));
      });

    this._emit({
      type:   'lock-change',
      ovalue: false,
      nvalue: this.locked,
    });
  }
  unlock() {
    let old_locked = this.locked;
    if (!old_locked) return;
    this.locked = false;

    if (old_locked === true)
      this.tiles.forEach(tile => {
        tile.set_interactive(!!(tile.action || tile.assigned));
      });

    this._emit({
      type:   'lock-change',
      ovalue: old_locked,
      nvalue: false,
    });
  }

  /*
   * Encode unit and tile references without modifying original object.
   */
  encodeAction(action) {
    let degree = this.getDegree(this.rotation, 'N');
    let encode = obj => {
      let encoded = {...obj};

      if ('unit' in encoded)
        encoded.unit = encoded.unit.id;
      if ('assignment' in encoded)
        encoded.assignment = this.getTileRotation(encoded.assignment, degree).coords;
      if ('target' in encoded)
        encoded.target = this.getTileRotation(encoded.target, degree).coords;
      if ('direction' in encoded)
        encoded.direction = this.getRotation(encoded.direction, degree);
      if (encoded.focusing)
        encoded.focusing = encoded.focusing.map(u => u.id);
      if (encoded.paralyzed)
        encoded.paralyzed = encoded.paralyzed.map(u => u.id);
      if (encoded.poisoned)
        encoded.poisoned = encoded.poisoned.map(u => u.id);

      if ('changes' in encoded)
        encoded.changes = encode(encoded.changes);
      if ('results' in encoded)
        encoded.results = encoded.results.map(r => encode(r));

      return encoded;
    };

    if (Array.isArray(action))
      return action.map(a => encode(a));
    else
      return encode(action);
  }
  /*
   * Decode unit and tile references by modifying original object.
   */
  decodeAction(action) {
    let degree = this.getDegree('N', this.rotation);
    let units = this.teamsUnits.flat();
    let decode = obj => {
      let decoded = {...obj};

      if ('unit' in decoded)
        decoded.unit = units.find(u => u.id === decoded.unit);
      if ('assignment' in decoded)
        decoded.assignment = this.getTileRotation(decoded.assignment, degree);
      if ('target' in decoded)
        decoded.target = this.getTileRotation(decoded.target, degree);
      if ('direction' in decoded)
        decoded.direction = this.getRotation(decoded.direction, degree);
      if (decoded.focusing)
        decoded.focusing = decoded.focusing.map(uId => units.find(u => u.id === uId));
      if (decoded.paralyzed)
        decoded.paralyzed = decoded.paralyzed.map(uId => units.find(u => u.id === uId));
      if (decoded.poisoned)
        decoded.poisoned = decoded.poisoned.map(uId => units.find(u => u.id === uId));

      if ('changes' in decoded)
        decoded.changes = decode(decoded.changes);
      if ('results' in decoded)
        decoded.results = decoded.results.map(r => decode(r));

      return decoded;
    };

    if (Array.isArray(action))
      return action.map(a => decode(a));
    else
      return decode(action);
  }

  getState() {
    // Right now, degree will always be zero since only the Game class
    // calls this method and the Game board instance is never rotated.
    let degree = this.getDegree(this.rotation, 'N');

    return this.teamsUnits.map(units => units.map(unit => {
      let unitState = unit.toJSON();
      if (!degree) return unitState;

      // Normalize assignment and direction based on North board rotation.
      let assignment = this.getTileRotation(unitState.assignment, degree);
      unitState.assignment = [assignment.x, assignment.y];

      if (unitState.direction)
        unitState.direction = this.getRotation(unitState.direction, degree);
    }));
  }
  setState(teamsUnits, teams) {
    this.clear();
    this.teams = teams;

    // The Game class calls this method so the North-normalized data needs
    // to be rotated appropriately based on board rotation.
    let degree = this.getDegree('N', this.rotation);

    // Set the board
    teamsUnits.forEach((unitsState, teamId) => {
      let team = teams[teamId];

      this.teamsUnits.push(team.units = []);

      unitsState.forEach(unitState => {
        // Clone the object to protect against modification.
        unitState = Object.assign({}, unitState);

        // Adjust assignment and direction based on current board rotation.
        if (degree) {
          unitState.assignment = this.getTileRotation(unitState.assignment, degree);
          if (unitState.direction)
            unitState.direction = this.getRotation(unitState.direction, degree);
        }

        this.addUnit(unitState, team);
      });
    });

    // Now that all units exist, resolve unit references.
    let units = this.teamsUnits.flat();
    units.forEach(unit => {
      if (unit.focusing)
        unit.focusing = unit.focusing.map(uId => units.find(u => u.id === uId));
      if (unit.paralyzed)
        unit.paralyzed = unit.paralyzed.map(uId => units.find(u => u.id === uId));
      if (unit.poisoned)
        unit.poisoned = unit.poisoned.map(uId => units.find(u => u.id === uId));
    });

    return this;
  }

  clear() {
    this.eraseCard();
    this.teamsUnits.flat().forEach(unit => this.dropUnit(unit));
    this.teamsUnits = [];
    this.teams = [];
    this.clearHighlight();

    return this;
  }

  showMode() {
    let selected = this.selected;
    if (selected && selected.activated === 'target')
      this.hideMode();
    else
      this.clearMode();

    let unit = this.viewed || selected;
    if (!unit) return;

    let mode = unit.activated;
    let view_only = !!this.viewed;

    if (mode === 'move')
      this._highlightMove(unit, view_only);
    else if (mode === 'attack')
      this._highlightAttack(unit, view_only);
    else if (mode === 'target')
      this._highlightTarget(unit);
    else if (mode === 'turn') {
      if (this.viewed)
        this.showDirection(unit);
      else
        this._showTurnOptions(unit);
    }

    return this;
  }
  hideMode() {
    let unit = this.viewed || this.selected;
    if (!unit) return;

    let mode = unit.activated;

    // Useful when clearing an attack or target mode
    let focused = this.focused;
    if (focused && focused.notice)
      focused.change({ notice:null });

    if (this.target)
      this.hideTargets();
    else if (mode === 'attack' && unit.aAll && this.selected)
      this.hideTargets();

    this.clearHighlight();
    this.hideTurnOptions();

    return this;
  }
  clearMode() {
    this.hideMode();
    this.target = null;

    return this;
  }

  showTargets() {
    let selected     = this.selected;
    let target       = this.target;
    let target_units = selected.getTargetUnits(target);

    // Units affected by the attack will pulsate.
    target_units.forEach(tu => {
      if (tu !== selected) tu.activate();
    });

    // If only one unit is affected, draw card.
    if (target_units.length === 1) {
      selected.setTargetNotice(target_units[0], target);
      this.targeted = target_units[0];
      this.drawCard(this.targeted);
    }

    return this;
  }
  hideTargets() {
    let selected     = this.selected;
    let target       = this.target;
    let target_units = selected.getTargetUnits(target);

    target_units.forEach(tu => {
      // Edge case: A pyro can target himself.
      if (tu === selected)
        tu.change({ notice:null });
      else
        tu.deactivate();
    });

    let targeted = this.targeted;
    if (targeted) {
      targeted.change({ notice:null });
      this.targeted = null;
      this.drawCard();
    }

    return this;
  }

  /*****************************************************************************
   * Exclusively used by the Chaos Seed/Dragon
   ****************************************************************************/
  getWinningTeams() {
    let teams = this._calcTeams();

    teams.sort((a, b) => (b.score - a.score) || (b.size - a.size) || (a.random - b.random));

    return teams;
  }
  _calcTeams() {
    let choices = [];

    this.teams.forEach(team => {
      if (team.name === 'Chaos') return;
      if (team.units.length === 0) return;

      let thp = 50 * 3;
      let chp = 0;

      team.units.forEach(unit => chp += unit.health + unit.mHealth);

      choices.push({
        id:     team.id,
        score:  chp / thp,
        random: Math.random(),
      });
    });

    return choices;
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _showTurnOptions(unit) {
    let stage = Tactics.game.stage;
    let turnOptions = this._turnOptions;

    turnOptions.data = { unit:unit };
    turnOptions.position = unit.assignment.getTop().clone();
    turnOptions.position.y -= HALF_TILE_HEIGHT / 2;

    turnOptions.children.forEach(arrow => {
      arrow.interactive = arrow.buttonMode = true;
      arrow.visible = true;
    });

    if (!stage.children.includes(turnOptions))
      stage.addChild(turnOptions);

    return this;
  }
  showDirection(unit) {
    let stage = Tactics.game.stage;
    let turnOptions = this._turnOptions;

    turnOptions.data = { unit:unit };
    turnOptions.position = unit.assignment.getTop().clone();
    turnOptions.position.y -= HALF_TILE_HEIGHT / 2;

    turnOptions.children.forEach(arrow => {
      arrow.interactive = arrow.buttonMode = false;
      arrow.visible = unit.directional === false || arrow.data.direction == unit.direction;
    });

    if (!stage.children.includes(turnOptions))
      stage.addChild(turnOptions);

    return this;
  }
  hideTurnOptions() {
    let stage = Tactics.game.stage;
    let turnOptions = this._turnOptions;

    if (stage.children.includes(turnOptions))
      stage.removeChild(turnOptions);

    return this;
  }

  _highlightMove(unit, view_only) {
    let tiles = unit.getMoveTiles();

    this.setHighlight(tiles, {
      action: 'move',
      color:  MOVE_TILE_COLOR,
    }, view_only);

    return this;
  }
  _highlightAttack(unit, view_only) {
    if (!view_only && unit.aAll)
      return this._highlightTarget(unit);

    let tiles = unit.getAttackTiles();

    this.setHighlight(tiles, {
      action: 'attack',
      color:  ATTACK_TILE_COLOR,
    }, view_only);

    return this;
  }
  _highlightTarget(unit) {
    let tiles = unit.getTargetTiles(this.target);

    this.setHighlight(tiles, {
      action: 'target',
      color:  TARGET_TILE_COLOR,
    });

    this.showTargets();

    return this;
  }

  _highlightTargetMix(target) {
    let selected = this.selected;

    // Show target tiles
    selected.getTargetTiles(target).forEach(tile => {
      if (tile === target)
        // Reconfigure the focused tile to be a target tile.
        this.setHighlight(tile, {
          action: 'target',
          color:  TARGET_TILE_COLOR,
        });
      else
        // This attack tile only looks like a target tile.
        this.setHighlight(tile, {
          action: 'attack',
          color:  TARGET_TILE_COLOR,
        });
    });

    // Configure the target in case the attack is initiated.
    this.target = target;
    this.showTargets();

    return this;
  }
  _clearTargetMix(target) {
    let selected = this.selected;
    if (selected.aAll) return;

    let attackTiles = selected.getAttackTiles();

    // Reset target tiles to attack tiles
    selected.getTargetTiles(target).forEach(tile => {
      if (attackTiles.includes(tile))
        this.setHighlight(tile, {
          action: 'attack',
          color:  ATTACK_TILE_COLOR,
        });
      else
        this.clearHighlight(tile);
    });

    this.hideTargets();
    this.target = null;
  }

  onTileFocus(tile) {
    /*
     * Brighten the tile to show that it is being focused.
     */
    if (tile.action)
      tile.setAlpha(0.6);
    else if (tile.painted && tile.painted !== 'focus')
      tile.setAlpha(0.3);
    else
      tile.paint('focus', 0.3, FOCUS_TILE_COLOR);

    let selected = this.selected;
    let unit = tile.assigned;
    let game = Tactics.game;

    if (tile.action === 'attack') {
      // Single-click attacks are only enabled for mouse pointers.
      if (game.pointerType === 'mouse')
        this._highlightTargetMix(tile);
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
    let focused = this.focused;
    if (focused === unit || !unit)
      return;

    this._emit({ type:'focus', unit:unit });
  }
  onTileBlur(tile) {
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
    let game = Tactics.game;

    // Single-click attacks are only enabled for mouse pointers.
    if (tile.action === 'attack') {
      if (unit)
        unit.change({ notice:null });
    }
    else if (tile.action === 'target') {
      if (unit && unit !== this.targeted)
        unit.change({ notice:null });

      if (game.pointerType === 'mouse')
        this._clearTargetMix(tile);
    }

    /*
     * Emit a change in unit focus.
     */
    let focused = this.focused;
    if (focused !== unit || !focused)
      return;

    this._emit({ type:'blur', unit:unit });
  }

  onMoveSelect(tile) {
    this._emit({
      type: 'move',
      assignment: tile,
    });
  }
  onAttackSelect(tile) {
    this.target = tile;
    Tactics.game.selectMode = 'target';
  }
  onTargetSelect(tile) {
    let selected = this.selected;
    let target = this.target;
    let action = {
      type: 'attack',
    };

    // Units that attack all targets don't have a specific target tile.
    if (target)
      action.target = target;
    else {
      // Set unit to face the direction of the tapped tile.
      // (This is an aesthetic data point that needs no server validation)
      let direction = this.getDirection(
        selected.assignment,
        target || tile,
        selected.direction
      );
      if (direction !== selected.direction)
        action.direction = direction;
    }

    this._emit(action);
  }
  onUnitSelect(tile) {
    let unit = tile.assigned;

    this._emit({ type:'select', unit:unit });
  }

  setHighlight(tiles, highlight, viewed) {
    if (!Array.isArray(tiles)) tiles = [tiles];

    let highlighted = this._highlighted;
    // Trigger the 'focus' event when highlighting the focused tile.
    let focusedTile = this.focusedTile;
    let trigger_focus = false;

    tiles.forEach(tile => {
      let alpha = viewed ? 0.15 : 0.3;
      if (tile.focused && (tile.is_interactive() || !viewed))
        alpha *= 2;

      tile.paint(highlight.action, alpha, highlight.color);

      if (!viewed) {
        tile.action = highlight.action;

        if (tile === focusedTile)
          trigger_focus = true;
        else
          tile.set_interactive(true);
      }

      highlighted.add(tile);
    });

    // The 'focus' event is delayed until all tiles are highlighted.
    if (trigger_focus)
      if (focusedTile.is_interactive())
        this.onTileFocus(focusedTile);
      else
        focusedTile.set_interactive(true);
  }
  clearHighlight(tile) {
    let highlighted = this._highlighted;
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
      if (tile.focused && tile.assigned && !this.locked)
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
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
