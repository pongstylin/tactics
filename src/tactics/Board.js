import EventEmitter from 'events';
import Tile from 'tactics/Tile.js';
import Unit from 'tactics/Unit.js';
import unitFactory from 'tactics/unitFactory.js';
import colorMap from 'tactics/colorMap.js';

export const TILE_WIDTH        = 88;
export const TILE_HEIGHT       = 56;
export const HALF_TILE_WIDTH   = TILE_WIDTH / 2;
export const HALF_TILE_HEIGHT  = TILE_HEIGHT / 2;
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
      tiles: tiles,
      pixi: null,
      sprite: null,
      unitsContainer: null,
      locked: 'readonly',
      focusedTile: null,

      card:        null,
      carded:      null,

      focused:     null,
      viewed:      null,
      selected:    null,
      targeted:    new Set(),

      rotation:    'N',

      teams: [],
      teamsUnits: [], // 2-dimensional array of the units for each team.

      /*
       * Private properties
       */
      _trophy:         null,
      _highlighted:    new Map(),
      _emitter:        new EventEmitter(),
    });
  }

  initCard() {
    let card = {
      renderer: new PIXI.CanvasRenderer({
        width: 176,
        height: 100,
        transparent: true,
      }),
      stage: new PIXI.Container(),
      rendering: false,
      render: () => {
        if (card.rendering) return;
        card.rendering = true;

        requestAnimationFrame(() => {
          card.renderer.render(card.stage);
          card.rendering = false;
        });
      },
      updatePointer: () => {
        let interaction = card.renderer.plugins.interaction;
        interaction.didMove = false;
        interaction.update();
      },
    };

    // Save battery life by updating manually.
    card.renderer.plugins.interaction.useSystemTicker = false;

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

    card.mask = new PIXI.Graphics();
    card.mask.drawRect(0,0,88,46);

    card.elements = Tactics.draw({
      textStyle: {
        fontFamily: 'Arial',
        fontSize: '11px',
        fill: 'white',
        stroke: 0,
        strokeThickness: 3,
      },
      context: card.stage,
      children: {
        upper: {
          type: 'C',
          children: {
            avatar: { type:'C', x:28, y:0 },
            name: {
              type: 'T',
              x: 114,
              y: 4,
              anchor: { x:0.5 },
              style: {
                fontFamily: 'Arial',
                fontSize: '12px',
                fontWeight: 'bold',
              },
            },
            notice: {
              type: 'T',
              style: {
                fontFamily: 'Arial',
              },
            },
            healthBar: { type:'C', x:60, y:47 }
          }
        },
        divider: {
          type: 'G',
          draw: pixi => {
            pixi.lineTextureStyle({
              width: 1,
              gradient: {
                type: 'linear',
                beginPoint: new PIXI.Point(0, 0),
                endPoint: new PIXI.Point(176, 0),
                colorStops: [
                  [0,    '#000000'],
                  [0.09, '#FFFFFF'],
                  [0.62, '#FFEECC'],
                  [1,    '#000000'],
                ],
              },
            });
            pixi.moveTo(0, 60.5);
            pixi.lineTo(176, 60.5);
          }
        },
        lower: {
          type: 'C',
          x: 8,
          y: 66,
          children: {
            layer1: {
              type: 'C',
              children: {
                pLabel: { type:'T', x:0,   y:0,  text:'Power' },
                power : { type:'T', x:39,  y:0,  style:{ letterSpacing:1 }},
                mPower: { type:'T', x:70,  y:0,  style:{ letterSpacing:1 }},

                bLabel: { type:'T', x:80,  y:0,  text:'Block' },
                block : { type:'T', x:115, y:0,  style:{ letterSpacing:1 }},
                mBlock: { type:'T', x:143, y:0,  style:{ letterSpacing:1 }},

                aLabel: { type:'T', x:0,   y:16, text:'Armor' },
                armor : { type:'T', x:39,  y:16, style:{ letterSpacing:1 }},
                mArmor: { type:'T', x:70,  y:16, style:{ letterSpacing:1 }},
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
  trigger(event) {
    this._emitter.emit(event.type, event);
    return this;
  }

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
        if (
          !tile ||
          (isUnassigned === true && tile.assigned) ||
          (isUnassigned === false && !tile.assigned)
        ) continue;

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
  getOffset(offsetRatio, direction) {
    if (!offsetRatio || !direction)
      return [0, 0];

    let xOffset = Math.round(HALF_TILE_WIDTH * offsetRatio);
    let yOffset = Math.round(HALF_TILE_HEIGHT * offsetRatio);

    if (direction === 'N')
      return [-xOffset, -yOffset];
    else if (direction === 'NE')
      return [0, -yOffset];
    else if (direction === 'E')
      return [xOffset, -yOffset];
    else if (direction === 'SE')
      return [xOffset, 0];
    else if (direction === 'S')
      return [xOffset, yOffset];
    else if (direction === 'SW')
      return [0, yOffset];
    else if (direction === 'W')
      return [-xOffset, yOffset];
    else if (direction === 'NW')
      return [-xOffset, 0];
    else
      throw 'Unrecognized direction';
  }
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
  /*
   * Get a direction that is a rotation of a direction by N degrees.
   * e.g. getRotation('N', 180) === 'S'
   */
  getRotation(direction, degree) {
    if (direction === 'C') return direction;

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
    if (direction === 'C' || rotation === 'C') return 0;

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
    // Normalize directions for a board rotation agnostic decision.
    let degree = this.getDegree(this.rotation, 'N');
    let directions = [
      this.getRotation('N', degree),
      this.getRotation('S', degree),
      this.getRotation('E', degree),
      this.getRotation('W', degree),
    ];
    let direction;
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
  draw() {
    let pixi = this.pixi = new PIXI.Container();
    pixi.position = new PIXI.Point(18, 44);

    let lightFilter = new PIXI.filters.ColorMatrixFilter();
    lightFilter.brightness(1.25);

    let core = Tactics.getSprite('core');
    let sprite = this.sprite = PIXI.Sprite.from(core.getImage('board').texture);
    sprite.filters = [lightFilter];
    pixi.addChild(sprite);

    let tilesContainer = this.tilesContainer = new PIXI.Container();
    let tiles = this.tiles;

    // The tiles container is interactive since we want to detect a tap on a
    // blank tile to cancel current selection, if sensible.  Ultimately, this
    // functionality needs to be provided by an 'undo' button.
    tilesContainer.interactive = true;
    tilesContainer.pointertap = event => {
      if (this.locked === true) return;

      if (this.viewed || this.selected)
        this._emit({ type:'deselect' });
    };

    /*
     * A select event occurs when a unit and/or an action tile is selected.
     */
    let selectEvent = event => {
      if (this.locked === true) return;

      let tile = event.target;
      let action = tile.action;
      let highlight = this._highlighted.get(tile);

      if (highlight && highlight.onSelect)
        return highlight.onSelect(event);
      else if (action === 'move')
        return this.onMoveSelect(tile);
      else if (action === 'attack')
        return this.onAttackSelect(tile);
      else if (action === 'target')
        return this.onTargetSelect(tile);

      let unit = tile.assigned;

      if (this.viewed === unit)
        this._emit({ type:'deselect' });
      else if (!this.viewed && this.selected === unit)
        this._emit({ type:'deselect' });
      else
        this._emit(event);
    };

    Object.values(tiles).forEach(tile => {
      tile.on('select', selectEvent);
      tile.on('focus',  event => this.onTileFocus(event));
      tile.on('blur',   event => this.onTileBlur(event));
      tile.on('assign', () => {
        if (this.locked === true) return;

        tile.set_interactive(true);
      });
      tile.on('dismiss', () => {
        if (!tile.painted || tile.painted === 'focus')
          tile.set_interactive(false);
      });
      tile.on('dragStart', event => this._emit(event));
      tile.on('dragDrop',  event => this._emit(event));
      tile.draw();

      tilesContainer.addChild(tile.pixi);
    });

    pixi.addChild(tilesContainer);

    /*
     * While the board sprite and tiles are interactive, the units aren't.  So,
     * optimize PIXI by not checking them for interactivity.
     */
    let unitsContainer = this.unitsContainer = new PIXI.Container();
    unitsContainer.position = new PIXI.Point(1, -1);
    unitsContainer.interactiveChildren = false;
    unitsContainer.filters = [lightFilter];

    pixi.addChild(unitsContainer);

    this.drawTurnOptions();

    // Preload the Trophy data URLs
    if (this.card) {
      this._trophy = unitFactory('Trophy', this);
      this._trophy.drawAvatar();
    }

    return this;
  }
  drawTurnOptions() {
    let turnOptions = new PIXI.Container();
    let onTurnSelect = event => {
      let target = event.target;

      Tactics.playSound('select');
      this.hideTurnOptions();
      event.currentTarget.filters = null;

      this._emit({
        type:      'turn',
        direction: target.data.direction,
      });
    };
    let onTurnFocus = event => {
      Tactics.playSound('focus');

      let filter = new PIXI.filters.ColorMatrixFilter();
      filter.brightness(1.75);
      event.currentTarget.filters = [filter];
    };
    let onTurnBlur = event => {
      event.currentTarget.filters = null;
    };

    ['turn_tl.png','turn_tr.png','turn_bl.png','turn_br.png'].forEach((image, i) => {
      let sprite = new PIXI.Sprite.from('https://legacy.taorankings.com/images/'+image);
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
    var currentHealth = Math.max(0, unit.health + unit.mHealth);
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
      fontFamily: 'Arial',
      fontSize: '12px',
      stroke: 0,
      strokeThickness: 3,
      letterSpacing: 1,
      fill: 'white',
    };
    var currentHealthText = new PIXI.Text(
      currentHealth,
      textOptions,
    );
    currentHealthText.x = 28;
    currentHealthText.y = -15;
    currentHealthText.anchor.x = 1;
    var dividedByText = new PIXI.Text(
      '/',
      {...textOptions, fontSize: '20px'}
    );
    dividedByText.x = 27;
    dividedByText.y = -16;
    var totalHealthText = new PIXI.Text(
      unit.health,
      textOptions,
    );
    totalHealthText.x = 34;
    totalHealthText.y = -9;

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
    this.unitsContainer.children.sort((a, b) => {
      let ay = a.data && a.data.position ? a.data.position.y : a.position.y;
      let by = b.data && b.data.position ? b.data.position.y : b.position.y;

      return ay - by;
    });
  }
  /*
   * Draw an information card based on these priorities:
   *   1) The provided 'unit' argument (optional)
   *   2) The unit that is currently focused upon
   *   3) The unit that is currently targeted (if only one is targeted)
   *   4) The unit that is selected for viewing.
   *   5) The unit that is selected for control.
   *   6) The trophy avatar with the optional default notice.
   */
  drawCard(unit, defaultNotice) {
    if (!this.card) return;

    let card = this.card;
    let els  = card.elements;
    let notice;
    let notices = [];
    let important = 0;

    if (unit === undefined)
      unit = this.focused
        || (this.targeted.size === 1 && [...this.targeted][0])
        || this.viewed || this.selected;

    if (els.healthBar.children.length) els.healthBar.removeChildren();

    if (unit) {
      els.notice.x = 174;
      els.notice.y = 23;
      els.notice.anchor.x = 1;
      els.notice.style.fontSize = unit.notice ? '12px' : '11px';

      els.healthBar.addChild(this.drawHealth(unit));

      //
      //  Status Detection
      //
      if (unit.mHealth <= -unit.health) {
        if (unit.type === 'ChaosSeed')
          notice = 'Hatched!';
        else
          notice = 'Dead!';
      }
      else {
        notice = unit.notice;
      }

      if (unit.paralyzed)
        notices.push('Paralyzed!');

      if (unit.mRecovery)
        notices.push('Wait '+unit.mRecovery+' Turn'+(unit.mRecovery > 1 ? 's' : '')+'!');

      if (unit.poisoned)
        notices.push('Poisoned!');

      if (unit.canSpecial()) {
        if (unit.type === 'Assassin')
          notices.push('Enraged!');
        else if (unit.type === 'Furgon' && unit.mRecovery <= unit.recovery)
          notices.push('Empowered!');
      }

      if (unit.focusing)
        notices.push('Focused!');

      if (unit.barriered)
        notices.push('Barriered!');

      if (unit.armored)
        notices.push('Armored!');

      if (unit.mBlocking < 0)
        notices.push('Vulnerable!');

      if (unit.title)
        notices.push(unit.title);

      if (!notice)
        notice = notices.shift();

      //
      //  Draw the top part of the card.
      //
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
            els.mBlock.style.fill = '#00CC00';
          }
          else {
            els.mBlock.text = Math.round(unit.mBlocking)+'%';
            els.mBlock.style.fill = '#FF4444';
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
        els.block.text = '—';
        els.mBlock.text = '';
      }

      els.power.text = unit.power || '—';

      if (unit.mPower) {
        if (unit.mPower > 0) {
          els.mPower.text = '+'+unit.mPower;
          els.mPower.style.fill = '#00CC00';
        }
        else {
          els.mPower.text = unit.mPower;
          els.mPower.style.fill = '#FF4444';
        }

        els.power.updateText();
        els.mPower.position.x = els.power.position.x + els.power.width;
      }
      else {
        els.mPower.text = '';
      }

      els.armor.text = unit.armor || '—';

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

      els.ability.text = unit.ability || 'None';
      els.specialty.text = unit.specialty || 'None';

      //
      //  Draw the 3rd layer of the bottom part of the card.
      //
      els.layer3.visible = false;

      els.recovery.text = 'Recovery  '+unit.mRecovery+'/'+unit.recovery;
      els.notice1.text = notices.length ? notices.shift() : '—';
      els.notice2.text = notices.length ? notices.shift() : '—';
      els.notice3.text = notices.length ? notices.shift() : '—';
    }
    else if (defaultNotice) {
      unit = this._trophy;

      //
      //  Draw the top part of the card.
      //
      els.name.text = 'Champion';

      els.notice.x = 110;
      els.notice.y = 28;
      els.notice.anchor.x = 0.5;
      els.notice.style.fontSize = '12px';
      els.notice.text = defaultNotice;

      //
      // Hide the rest.
      //
      els.layer1.visible = false;
      els.layer2.visible = false;
      els.layer3.visible = false;
    }
    else
      this.eraseCard();

    if (unit) {
      let mask = new PIXI.Graphics();
      mask.drawRect(0, 0, 150, 60);

      let avatar = unit.drawAvatar();
      let avatarBounds = avatar.getLocalBounds();
      avatar.position.y = Math.min(76, Math.max(54, -avatarBounds.y));
      avatar.filters = this.unitsContainer.filters;
      avatar.mask = mask;

      els.avatar.removeChildren();
      els.avatar.addChild(avatar);

      let nameColor;
      if (unit.tier === 1)
        nameColor = '#AAA9AD';
      else if (unit.tier === 2)
        nameColor = '#DAA520';
      else if (unit.tier === 3 || unit.tier === 4)
        nameColor = '#FFA500';
      else
        nameColor = '#ffffff';

      els.name.style.fill = nameColor;

      card.stage.buttonMode = true;
      card.render();
    }

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

  makeUnit(unitState) {
    let unit = unitFactory(unitState.type, this);
    if (unitState.colorId)
      unit.color = colorMap.get(unitState.colorId);
    else if (unitState.color)
      unit.color = unitState.color;
    unit.direction = unit.directional === false ? 'S' : unitState.direction;

    for (let [key, value] of Object.entries(unitState)) {
      if (key === 'type' || key === 'direction' || key === 'color' || key === 'colorId')
        continue;
      else if (key === 'assignment')
        unit[key] = Array.isArray(value) ? this.getTile(...value) : value;
      else
        unit[key] = value;
    }

    return unit;
  }
  addUnit(unit, team) {
    if (!(unit instanceof Unit))
      unit = this.makeUnit(unit);

    unit.team = team;
    if (unit.color === null)
      unit.color = colorMap.get(team.colorId);
    unit.stand();

    this.assign(unit, unit.assignment);

    team.units.push(unit);
    unit.attach();

    return unit;
  }
  dropUnit(unit) {
    var units = unit.team.units;

    if (unit === this.focused) {
      unit.blur();
      this.focused = null;
    }

    if (unit === this.viewed) {
      unit.deactivate();
      this.viewed = null;
    }

    if (unit === this.selected) {
      unit.deactivate();
      this.selected = null;
    }

    if (unit === this.carded)
      this.drawCard();

    this.dismiss(unit);

    units.splice(units.indexOf(unit), 1);
    unit.detach();

    return this;
  }
  assign(unit, tile) {
    if (tile.assigned)
      this.dismiss(tile.assigned);

    // The unit may have an assignment before it is added to the board.
    if (unit.assignment !== tile)
      this.dismiss(unit);
    tile.assign(unit);

    let unitsContainer = this.unitsContainer;
    if (unitsContainer) {
      unit.setPositionToTile();
      unitsContainer.addChild(unit.pixi);
    }

    return this;
  }
  dismiss(unit) {
    if (unit.assignment)
      unit.assignment.dismiss();

    let unitsContainer = this.unitsContainer;
    if (unitsContainer) {
      unitsContainer.removeChild(unit.pixi);
    }

    return this;
  }

  applyAction(action) {
    let unit = action.unit;

    if (unit) {
      if (action.assignment)
        this.assign(unit, action.assignment);
      if (action.direction)
        unit.direction = action.direction;
      if (action.colorId)
        unit.color = colorMap.get(action.colorId);
    }

    this.applyActionResults(action.results);

    // Remove dead units.
    this.teamsUnits.flat().forEach(unit => {
      // Chaos Seed doesn't die.  It hatches.
      if (unit.type === 'ChaosSeed') return;

      if (unit.mHealth <= -unit.health)
        this.dropUnit(unit);
    });
  }
  applyActionResults(results) {
    if (!results) return;

    results.forEach(result => {
      let unit = result.unit;

      if (result.type === 'summon') {
        // Add a clone of the unit so that the original unit remains unchanged
        this.addUnit(unit.clone(), this.teams[result.teamId]);
      }
      else {
        // Use a shallow clone to protect against modification.
        let changes = Object.assign({}, result.changes);

        if (Object.keys(changes).length) {
          // For a change in type, we need to replace the unit instance.
          // Only Chaos Seed changes type to a Chaos Dragon.
          // By default, only the old unit id, direction, assignment, and color is inherited.
          if (changes.type) {
            // Dropping a unit clears the assignment.  So get it first.
            let assignment = unit.assignment;

            unit = this
              .dropUnit(unit)
              .addUnit({
                id:         unit.id,
                type:       changes.type,
                assignment: assignment,
                direction:  changes.direction || unit.direction,
                color:      unit.color,
              }, unit.team);
            delete changes.type;
          }

          if (Object.keys(changes).length)
            unit.change(changes);
        }

        if (result.results)
          this.applyActionResults(result.results);
      }
    });
  }

  /*
    This does not actually rotate the board - that causes all kinds of
    complexity.  Rather, it rearranges the units so that it appears the
    board has rotated.  This means unit coordinates and directions must
    be translated to a server based on our current rotation.
  */
  rotate(rotation) {
    // Get unit positions normalized to server board north.
    let state = this.getState().flat();

    // Numeric rotation is relative to current rotation.
    if (typeof rotation === 'number')
      rotation = this.getRotation(this.rotation, rotation);

    let degree    = this.getDegree('N', rotation);
    let activated = this.viewed || this.selected;

    if (activated) this.hideMode();

    this.teamsUnits.flat().forEach(unit => {
      let unitData = state.find(u => u.id === unit.id);

      this.assign(unit, this.getTileRotation(unitData.assignment, degree));
      unit.stand(this.getRotation(unitData.direction, degree));
    });

    if (this.target)
      this.target = this.getTileRotation(
        this.target,
        this.getDegree(this.rotation, rotation),
      );

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
        if (obj.type === 'summon') {
          let unit = encoded.unit = encoded.unit.toJSON();
          if (unit.direction)
            unit.direction = this.getRotation(unit.direction, degree);
          unit.assignment = this.getTileRotation(unit.assignment, degree).coords;
        }
        else
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
      if (encoded.barriered)
        encoded.barriered = encoded.barriered.map(u => u.id);
      if (encoded.poisoned)
        encoded.poisoned = encoded.poisoned.map(u => u.id);
      if (encoded.armored)
        encoded.armored = encoded.armored.map(u => u.id);

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

      if ('unit' in decoded) {
        if (obj.type === 'summon') {
          let unit = decoded.unit = this.makeUnit(decoded.unit);
          if (unit.directional !== false)
            unit.direction = this.getRotation(unit.direction, degree);
          unit.assignment = this.getTileRotation(unit.assignment, degree);
        }
        else
          decoded.unit = units.find(u => u.id === decoded.unit);
      }
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
      if (decoded.barriered)
        decoded.barriered = decoded.barriered.map(uId => units.find(u => u.id === uId));
      if (decoded.poisoned)
        decoded.poisoned = decoded.poisoned.map(uId => units.find(u => u.id === uId));
      if (decoded.armored)
        decoded.armored = decoded.armored.map(uId => units.find(u => u.id === uId));

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

      if (degree) {
        // Normalize assignment and direction based on North board rotation.
        let assignment = this.getTileRotation(unitState.assignment, degree);
        unitState.assignment = [assignment.x, assignment.y];

        if (unitState.direction)
          unitState.direction = this.getRotation(unitState.direction, degree);
      }

      return unitState;
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
      if (unit.barriered)
        unit.barriered = unit.barriered.map(uId => units.find(u => u.id === uId));
      if (unit.poisoned)
        unit.poisoned = unit.poisoned.map(uId => units.find(u => u.id === uId));
      if (unit.armored)
        unit.armored = unit.armored.map(uId => units.find(u => u.id === uId));

      if (unit.pixi) {
        if (unit.focusing || unit.paralyzed || unit.poisoned)
          unit.showFocus();
        if (unit.barriered)
          unit.showBarrier();
      }
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

  /*
   * This method must be called AFTER the previously shown mode, if any, has
   * been hidden AND the viewed or selected unit activated with the new mode.
   */
  showMode() {
    let unit = this.viewed || this.selected;
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

    if (this.targeted.size)
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

  showTargets(target) {
    let selected = this.selected;
    let targeted = this.targeted = new Set(selected.getTargetUnits(target));

    // Units affected by the attack will pulsate.
    targeted.forEach(tu => {
      // Edge case: A pyro can target himself.
      if (tu !== selected) tu.activate();
      selected.setTargetNotice(tu, target);
    });

    // If only one unit is affected, draw card.
    if (targeted.size === 1)
      // Pass the targeted unit to override the focused unit, if any.
      this.drawCard([...this.targeted][0]);

    return this;
  }
  hideTargets() {
    let selected = this.selected;
    let targeted = this.targeted;

    targeted.forEach(tu => {
      // Edge case: A pyro can target himself.
      if (tu !== selected) tu.deactivate();
      tu.change({ notice:null });
    });

    // If only one unit is affected, draw card.
    if (targeted.size === 1) {
      targeted.clear();
      this.drawCard();
    }
    else
      targeted.clear();

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

      team.units.forEach(u => chp += Math.max(0, u.health + u.mHealth));

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
    let pixi = this.pixi;
    let turnOptions = this._turnOptions;

    turnOptions.data = { unit:unit };
    turnOptions.position = unit.assignment.getTop().clone();
    turnOptions.position.y -= HALF_TILE_HEIGHT / 2;

    turnOptions.children.forEach(arrow => {
      arrow.interactive = arrow.buttonMode = true;
      arrow.visible = true;
    });

    if (!pixi.children.includes(turnOptions))
      pixi.addChild(turnOptions);

    return this;
  }
  showDirection(unit) {
    let pixi = this.pixi;
    let turnOptions = this._turnOptions;

    turnOptions.data = { unit:unit };
    turnOptions.position = unit.assignment.getTop().clone();
    turnOptions.position.y -= HALF_TILE_HEIGHT / 2;

    turnOptions.children.forEach(arrow => {
      arrow.interactive = arrow.buttonMode = false;
      arrow.visible = unit.directional === false || arrow.data.direction == unit.direction;
    });

    if (!pixi.children.includes(turnOptions))
      pixi.addChild(turnOptions);

    return this;
  }
  hideTurnOptions() {
    let pixi = this.pixi;
    let turnOptions = this._turnOptions;

    if (pixi.children.includes(turnOptions))
      pixi.removeChild(turnOptions);

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
    let target = this.target;
    let tiles = unit.getTargetTiles(target);

    this.setHighlight(tiles, {
      action: 'target',
      color:  TARGET_TILE_COLOR,
    });

    this.showTargets(target);

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
    this.showTargets(target);

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

    this.target = null;
    this.hideTargets();
  }

  onTileFocus(event) {
    let tile = event.target;
    let focusedTile = this.focusedTile;
    // Make sure tiles are blurred before focusing on a new one.
    if (focusedTile && focusedTile !== tile)
      focusedTile.onBlur();
    this.focusedTile = tile;

    if (tile.isDropTarget)
      return this._emit({ ...event, type:'dragFocus' });
    else if (!tile.is_interactive())
      return;

    /*
     * Brighten the tile to show that it is being focused.
     */
    let highlighted = this._highlighted.get(tile);
    if (highlighted && highlighted.onFocus)
      return highlighted.onFocus(event);
    else if (tile.action)
      tile.setAlpha(0.6);
    else if (tile.painted && tile.painted !== 'focus')
      tile.setAlpha(0.3);

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

    /*
     * Emit a change in unit focus.
     */
    let focused = this.focused;
    if (focused === unit || !unit)
      return;

    this._emit({ type:'focus', tile:tile, unit:unit });
  }
  onTileBlur(event) {
    let tile = event.target;
    let focusedTile = this.focusedTile;
    // The tile might still be focused if the blur event was fired in
    // response to the board becoming locked and tile non-interactive
    if (focusedTile && !focusedTile.focused)
      this.focusedTile = null;

    if (tile.isDropTarget)
      return this._emit({ ...event, type:'dragBlur' });
    else if (!tile.is_interactive())
      return;

    /*
     * Darken the tile when no longer focused.
     */
    let highlighted = this._highlighted.get(tile);
    if (highlighted && highlighted.onBlur)
      return highlighted.onBlur(event);
    else if (tile.action)
      tile.setAlpha(0.3);
    else if (tile.painted && tile.painted !== 'focus')
      tile.setAlpha(0.15);

    let unit = tile.assigned;
    let game = Tactics.game;

    // Single-click attacks are only enabled for mouse pointers.
    if (tile.action === 'attack') {
      if (unit)
        unit.change({ notice:null });
    }
    else if (tile.action === 'target') {
      if (game.pointerType === 'mouse')
        this._clearTargetMix(tile);
    }

    /*
     * Emit a change in unit focus.
     */
    let focused = this.focused;
    if (focused !== unit || !focused)
      return;

    this._emit({ type:'blur', tile:tile, unit:unit });
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

  setHighlight(tiles, highlight, viewed = false) {
    if (!Array.isArray(tiles)) tiles = [tiles];

    let highlighted = this._highlighted;
    // Trigger the 'focus' event when highlighting the focused tile.
    let focusedTile = this.focusedTile;
    let triggerFocus = false;

    tiles.forEach(tile => {
      let alpha;
      if ('alpha' in highlight)
        alpha = highlight.alpha;
      else {
        alpha = viewed ? 0.15 : 0.3;
        if (tile.focused && (tile.is_interactive() || !viewed))
          alpha *= 2;
      }

      tile.paint(highlight.action, alpha, highlight.color);

      if (!viewed) {
        tile.action = highlight.action;

        if (tile === focusedTile)
          triggerFocus = true;
        else
          tile.set_interactive(true);
      }

      highlighted.set(tile, highlight);
    });

    // The 'focus' event is delayed until all tiles are highlighted.
    if (triggerFocus) {
      this.onTileFocus({ target:focusedTile });
      focusedTile.set_interactive(true);
    }
  }
  clearHighlight(tiles) {
    let highlighted = this._highlighted;

    if (!tiles)
      tiles = [...highlighted.keys()];
    else if (!Array.isArray(tiles))
      tiles = [tiles];

    tiles.forEach(tile => {
      highlighted.delete(tile);

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
