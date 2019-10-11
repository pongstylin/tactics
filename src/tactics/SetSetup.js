import EventEmitter from 'events';

import Board, {
  TILE_WIDTH,
  TILE_HEIGHT,
  FOCUS_TILE_COLOR,
} from 'tactics/Board.js';

export default class {
  constructor(team, gameTypeConfig) {
    // Clip unused empty space part #1
    let width = Tactics.width - TILE_WIDTH*2;
    let height = Tactics.height - TILE_HEIGHT*1.5;
    let renderer = PIXI.autoDetectRenderer(width, height, { transparent:true });

    // Let's not go crazy with the move events.
    renderer.plugins.interaction.moveWhenInside = true;

    let board = new Board();
    board.rotation = 'S';
    board.draw();

    board
      .on('focus', ({ tile, unit }) => {
        board.focused = unit;

        if (unit.team.name === 'Set')
          tile.paint('focus', 0.3, FOCUS_TILE_COLOR);
        else
          this._drawPicks();

        this.render();
      })
      .on('blur', ({ tile, unit }) => {
        if (board.focused === unit)
          board.focused = null;

        if (unit.team.name === 'Set')
          tile.strip();
        else
          this._drawPicks();

        this.render();
      })
      .on('select', ({ target:tile, pointerEvent }) => {
        let unit = tile.assigned;

        if (pointerEvent.pointerType === 'mouse' && pointerEvent.button === 2) {
          if (unit.team.name === 'Pick') return;

          pointerEvent.preventDefault();
          this.removeUnit(tile.assigned);
        }
        else {
          this.selected = unit === board.selected ? null : unit;
        }
      })
      .on('deselect', () => {
        this.selected = null;
      })
      .on('dragStart', this._onDragStart.bind(this))
      .on('dragFocus', this._onDragFocus.bind(this))
      .on('dragBlur',  this._onDragBlur.bind(this))
      .on('dragDrop',  this._onDragDrop.bind(this));

    let countsContainer = new PIXI.Container();
    countsContainer.position = board.pixi.position.clone();

    let trashSprite = PIXI.Sprite.fromImage('https://tactics.taorankings.com/images/trash.png');
    trashSprite.anchor.set(0.5, 0.8);
    trashSprite.scale.set(1.75);

    let focus = Tactics.effects.focus;
    let trashFocus = PIXI.Sprite.fromImage(focus.images[focus.frames[0][0].i]);
    trashFocus.anchor.set(0.5);
    trashFocus.alpha = 0;

    let trash = new PIXI.Container();
    let tilePoint = board.getTile(5, 10).getCenter();
    trash.position.set(
      tilePoint.x + board.pixi.position.x + TILE_WIDTH,
      tilePoint.y + board.pixi.position.y + TILE_HEIGHT,
    );
    trash.pointertap  = this._onTrashSelect.bind(this);
    trash.pointerover = this._onTrashFocus.bind(this);
    trash.pointerout  = this._onTrashBlur.bind(this);
    trash.addChild(trashFocus);
    trash.addChild(trashSprite);
    trash.alpha = 0.6;

    let stage = new PIXI.Container();
    // Clip unused empty space part #2
    stage.position.set(width - Tactics.width, height - Tactics.height);
    stage.addChild(board.pixi);
    stage.addChild(countsContainer);
    stage.addChild(trash);
    stage.mousemove = event => this._onDragMove({
      type: 'dragMove',
      target: null,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });

    Object.assign(this, {
      // Crude tracking of the pointer type being used.  Ideally, this should
      // reflect the last pointer type to fire an event on the board.
      pointerType: 'ontouchstart' in window ? 'touch' : 'mouse',
      gameTypeConfig: gameTypeConfig,

      _team:      { name:'Set',  ...team              },
      _picksTeam: { name:'Pick', colorId:team.colorId },

      _renderer: renderer,
      _rendering: false,
      _canvas: renderer.view,
      _stage: stage,
      _countsContainer: countsContainer,
      _trash: trash,
      _dragSource: null,
      _dragAvatar: null,
      _dragTarget: null,
      _animators: {},

      _board: board,

      _emitter: new EventEmitter(),
    });

    this._canvas.addEventListener('contextmenu', event => event.preventDefault());

    let unitTypes = [...gameTypeConfig.limits.units.types.keys()].reverse();
    let positions = this._getPositions();
    this._picksTeam.set = unitTypes.map((ut, i) => ({ type:ut, assignment:positions[i] }));

    let units = team.set.map(unitData => ({ ...unitData, direction:'S' }));
    let picksTeamUnits = this._picksTeam.set.map(unitData => ({
      ...unitData, direction:'N'
    }));
    board.setState([units, picksTeamUnits], [this._team, this._picksTeam]);
    board.teamsUnits.flat().forEach(u => u.draggable = true);

    // Set back the pick units and tiles to give the visible board some space.
    this._picksTeam.units.forEach(unit => {
      unit.assignment.pixi.position.x -= TILE_WIDTH / 4;
      unit.assignment.pixi.position.y -= TILE_HEIGHT / 4;
      unit.pixi.position.x -= TILE_WIDTH / 4;
      unit.pixi.position.y -= TILE_HEIGHT / 4;
    });

    this._drawPicks();

    let leftPoint = board.getTile(0, 6).getLeft();
    leftPoint.set(
      leftPoint.x + stage.position.x + board.pixi.position.x - 1,
      leftPoint.y + stage.position.y + board.pixi.position.y - 1,
    );
    let rightPoint = board.getTile(10, 6).getTop();
    rightPoint.set(
      rightPoint.x + stage.position.x + board.pixi.position.x - 1,
      rightPoint.y + stage.position.y + board.pixi.position.y - 1,
    );
    board.sprite.mask = new PIXI.Graphics();
    board.sprite.mask.lineStyle(1, 0xFFFFFF, 1);
    board.sprite.mask.beginFill(0xFFFFFF, 1);
    board.sprite.mask.drawPolygon([
      leftPoint.x, leftPoint.y,
      rightPoint.x, rightPoint.y,
      Tactics.width, rightPoint.y,
      Tactics.width, Tactics.height,
      0, Tactics.height,
    ]);

    this.render();

    // Allow the Animation class to render frames.
    Tactics.game = this;
  }

  /*****************************************************************************
   * Public Properties
   ****************************************************************************/
  get canvas() {
    return this._canvas;
  }

  get board() {
    return this._board;
  }

  get selected() {
    return this._board.selected;
  }
  set selected(unit) {
    let board = this._board;
    let trash = this._trash;

    if (unit) {
      if (board.selected)
        board.selected.deactivate();

      unit.activate();
      board.selected = unit;

      this._highlightPlaces(unit);

      if (unit.team.name === 'Set')
        this._enableTrash();
    }
    else if (board.selected) {
      board.selected.deactivate();
      board.selected = null;

      board.clearHighlight();
      this._disableTrash();
    }
    else
      return;

    this._drawPicks();
    this.render();
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  lock() {
    this._board.lock();
  }
  getSet() {
    return this._board.getState()[0].map(unit => {
      delete unit.direction;
      return unit;
    });
  }

  placeUnit(unitType, tile) {
    let board = this._board;
    let degree = board.getDegree('N', board.rotation);

    if (tile.assigned)
      board.dropUnit(tile.assigned);

    let unit = board.addUnit({
      type: unitType,
      assignment: tile,
      direction: board.getRotation('S', degree),
    }, this._team);
    unit.draggable = true;

    let unitCounts = this._getAvailableUnitCounts();

    if (unitCounts.get(unitType) < 0) {
      this.removeUnit(
        this._team.units.find(u => !u.dead && u.type === unitType)
      );
    }
    else {
      while (unitCounts.get('any') < 0) {
        this.removeUnit(this._team.units.find(u => !u.dead));

        // Multiple units might have to die to make room for a large unit.
        unitCounts = this._getAvailableUnitCounts();
      }
    }

    this._drawPicks();
  }
  moveUnit(unit, tile) {
    let board = this._board;
    let oldTile = unit.assignment;

    board.assign(unit, tile);
    this._highlightPlaces(unit, oldTile);
  }
  swapUnit(unit, srcTile, dstTile) {
    let board = this._board;
    let dstUnit = dstTile.assigned;

    board.assign(unit, dstTile);
    if (dstUnit)
      board.assign(dstUnit, srcTile);
  }
  removeUnit(unit) {
    let board = this._board;
    let tile = unit.assignment;

    unit.dead = true;
    tile.set_interactive(false);
    board.clearHighlight(tile);

    unit.animDeath().play().then(() => {
      if (board.selected && !tile.assigned)
        this._highlightPlaces(board.selected, tile);
    });

    this._drawPicks();
  }
  /*
   * Allow touch devices to upscale to normal size.
   */
  resize() {
    let canvas = this._canvas;
    canvas.style.width  = '';
    canvas.style.height = '';

    let container = canvas.parentNode;
    let width     = container.clientWidth;
    let height    = container.clientHeight;
    // window.innerHeight is buggy on iOS Safari during orientation change
    let vpHeight  = document.body.offsetHeight;

    if (vpHeight < height) {
      let rect = canvas.getBoundingClientRect();

      height  = vpHeight;
      height -= rect.top;
      //height -= vpHeight - rect.bottom;
      //console.log(vpHeight, rect.bottom);
    }
    else
      height -= canvas.offsetTop;

    let width_ratio  = width  / Tactics.width;
    let height_ratio = height / Tactics.height;
    let elementScale = Math.min(1, width_ratio, height_ratio);

    if (elementScale < 1)
      if (width_ratio < height_ratio)
        canvas.style.width = '100%';
      else
        canvas.style.height = height+'px';

    return self;
  }

  /*
   * Most games have a "render loop" that refreshes all display objects on the
   * stage every time the screen refreshes - about 60 frames per second.  The
   * animations in this game runs at about 12 frames per second and do not run
   * at all times.  To improve battery life on mobile devices, it is better to
   * only render when needed.  Only two things may cause the stage to change:
   *   1) An animation is being run.
   *   2) The user interacted with the game.
   *
   * So, call this method once per animation frame or once after handling a
   * user interaction event.  If this causes the render method to be called
   * more frequently than the screen refresh rate (which is very possible
   * just by whipping around the mouse over the game board), then the calls
   * will be throttled thanks to requestAnimationFrame().
   */
  render() {
    if (this._rendering) return;
    this._rendering = true;

    requestAnimationFrame(this._render.bind(this));
  }
  /*
   * This clever function will call your animator every throttle millseconds
   * and render the result.  The animator must return false when the animation
   * is complete.  The animator is passed the number of frames that should be
   * skipped to maintain speed.
   */
  renderAnim(anim, fps) {
    let throttle = 1000 / fps;
    let animators = [anim];
    let start;
    let delay = 0;
    let count = 0;
    let skip = 0;
    let i;

    let loop = now => {
      skip = 0;

      // stop the loop if all animators returned false
      if (animators.length) {
        if (count) {
          delay = (now - start) - (count * throttle);

          if (delay > throttle) {
            skip = Math.floor(delay / throttle);
            count += skip;

            requestAnimationFrame(loop);
          }
          else {
            setTimeout(() => requestAnimationFrame(loop), throttle - delay);
          }
        }
        else {
          start = now;
          setTimeout(() => requestAnimationFrame(loop), throttle);
        }

        // Iterate backward since elements may be removed.
        for (i = animators.length-1; i > -1; i--) {
          if (animators[i](skip) === false)
            animators.splice(i, 1);
        }
        this.render();
        count++;
      }
      else {
        delete this._animators[fps];
      }
    };

    // Stack multiple animations using the same FPS into one loop.
    if (fps in this._animators)
      this._animators[fps].push(anim);
    else {
      this._animators[fps] = animators;
      requestAnimationFrame(loop);
    }
  }

  rotateBoard(rotation) {
    this._board.rotate(rotation);
    this.render();
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  /*
   * DragStart fires by simply pressing the mouse button.
   * We don't know yet if this is a tap or a drag situation.
   * So, track mouse position to see if it is dragged before release.
   */
  _onDragStart(event) {
    this._dragSource = event;

    this._stage.interactive = true;
    this.render();
  }
  _onDragFocus({ target:tile }) {
    tile.paint('focus', 0.3, FOCUS_TILE_COLOR);
  }
  _onDragBlur({ target:tile }) {
    tile.strip();
  }
  _onDragMove({ pixiEvent, pointerEvent }) {
    let dragSource = this._dragSource;
    if (!dragSource) return;

    let board = this._board;
    let dragUnit = dragSource.targetUnit;

    let dragAvatar = this._dragAvatar;
    if (!dragAvatar) {
      let sx = dragSource.pointerEvent.clientX;
      let sy = dragSource.pointerEvent.clientY;
      let cx = pointerEvent.clientX;
      let cy = pointerEvent.clientY;
      let dist = Math.sqrt(Math.abs(cx - sx)**2 + Math.abs(cy - sy)**2);
      if (dist < 5) return;

      dragAvatar = new PIXI.Container();
      dragAvatar.addChild(dragUnit.drawAvatar(dragUnit.direction));

      this.selected = null;

      if (dragUnit.team.name === 'Set') {
        // Avatar is behind trash can.
        let trashIndex = this._stage.getChildIndex(this._trash);
        this._stage.addChildAt(this._dragAvatar = dragAvatar, trashIndex);

        board.dismiss(dragUnit);
        this._enableTrash(false);
      }
      else {
        // Avatar is in front of trash can.
        this._stage.addChild(this._dragAvatar = dragAvatar);
      }

      this._getAvailableTiles(dragUnit.type).forEach(tile => {
        tile.isDropTarget = true;
      });
    }

    if (
      board.focusedTile && board.focusedTile.isDropTarget ||
      dragUnit.team.name === 'Pick'
    ) {
      // Show shadow while over tiles
      dragAvatar.children[0].children.find(c => c.data.name === 'shadow')
        .alpha = 0.5;

      dragAvatar.position = pixiEvent.data.getLocalPosition(this._stage);
      this._onTrashBlur();
    }
    else {
      // Hide shadow while over trash can
      dragAvatar.children[0].children.find(c => c.data.name === 'shadow')
        .alpha = 0;

      let trashPoint = this._trash.position;
      dragAvatar.position.set(
        trashPoint.x,
        trashPoint.y - TILE_HEIGHT/4,
      );
      this._onTrashFocus();
    }

    this.render();
  }
  _onDragDrop({ pixiEvent, target:tile, cancelled }) {
    let dragSource = this._dragSource;
    if (!dragSource) return;

    this._dragSource = null;
    this._stage.interactive = false;

    if (this._dragAvatar) {
      this._dragAvatar.destroy();
      this._dragAvatar = null;
      this._board.tiles.forEach(tile => {
        tile.isDropTarget = false;
      });

      let dragUnit = dragSource.targetUnit;
      if (cancelled) {
        // Prevent tap event from firing
        pixiEvent.stopPropagation();

        if (dragUnit.team.name === 'Set') {
          if (tile)
            this._board.assign(dragUnit, tile);
          else {
            this._board.dropUnit(dragUnit);
            this._drawPicks();
          }
        }
      }
      else {
        if (dragUnit.team.name === 'Set')
          this.swapUnit(dragUnit, dragSource.target, tile);
        else
          this.placeUnit(dragUnit.type, tile);
      }

      this._disableTrash();
    }

    this.render();
  }

  _enableTrash(buttonMode = true) {
    this._trash.interactive = true;
    this._trash.buttonMode = buttonMode;
    this._trash.alpha = 1;
  }
  _disableTrash() {
    this._onTrashBlur();
    this._trash.interactive = false;
    this._trash.buttonMode = false;
    this._trash.alpha = 0.6;
  }

  _onTrashSelect() {
    let selected = this.selected;
    this.selected = null;

    this.removeUnit(selected);
    this._disableTrash();
  }
  _onTrashFocus() {
    this._trash.children[0].alpha = 1;
  }
  _onTrashBlur() {
    this._trash.children[0].alpha = 0;
  }

  /*
   * It is not used right now, but the unit type will be used to limit the tiles
   * in which THIS unit type is allowed to be placed.
   */
  _getAvailableTiles(unitType) {
    let board = this._board;
    let degree = board.getDegree(board.rotation, 'N');
    let gameTypeConfig = this.gameTypeConfig;
    let tileLimit = gameTypeConfig.limits.tiles;
    let tiles = [];

    for (let x = tileLimit.start[0]; x <= tileLimit.end[0]; x++) {
      for (let y = tileLimit.start[1]; y <= tileLimit.end[1]; y++) {
        let tile = board.getTileRotation([x, y], degree);
        if (!tile) continue;

        tiles.push(tile);
      }
    }

    return tiles;
  }

  _getPositions() {
    let cols = [5, 3, 7, 1, 9];
    let rows = [5, 7, 9, 6, 8, 10];
    let positions = [];

    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < cols.length; x++) {
        if (!this._board.getTile(cols[x], rows[y])) continue;

        positions.push([ cols[x], rows[y] ]);
      }
    }

    return positions;
  }
  _getAvailableUnitCounts() {
    let gameTypeConfig = this.gameTypeConfig;
    let unitTypes = gameTypeConfig.limits.units.types;
    let counts = new Map(
      [...unitTypes].map(([unitType, { max }]) => [unitType, max])
    );
    counts.set('any', gameTypeConfig.limits.units.max);

    this._team.units.forEach(unit => {
      if (unit.dead) return;

      counts.set(unit.type, counts.get(unit.type) - 1);

      let unitSize = unitTypes.get(unit.type).size || 1;
      counts.set('any', counts.get('any') - unitSize);
    });

    return counts;
  }
  _highlightPlaces(unit, tiles) {
    let board = this._board;
    if (tiles === undefined)
      tiles = this._getAvailableTiles(unit.type).filter(t => !t.assigned);

    board.setHighlight(tiles, {
      action: 'place',
      color: 0xFFFFFF,
      alpha: 0,
      onFocus: ({ target:tile }) => {
        tile.setAlpha(0.3);
        this.render();
      },
      onBlur: ({ target:tile }) => {
        tile.setAlpha(0);
        this.render();
      },
      onSelect: ({ target:tile }) => {
        board.clearHighlight(tile);

        if (unit.team.name === 'Pick')
          this.placeUnit(unit.type, tile);
        else
          this.moveUnit(unit, tile);

        this.render();
      },
    });
  }
  /*
   * Not used yet... intended for use in places a unit may not go.
   */
  _highlightNoPlaces(tiles) {
    this._board.setHighlight(tiles, {
      action: 'noplace',
      color: 0x000000,
      alpha: 0.3,
      onFocus: () => {},
      onBlur: () => {},
      onSelect: () => {},
    }, true);
  }
  _drawPicks() {
    let counts = this._getAvailableUnitCounts();

    this._countsContainer.removeChildren();

    let board = this._board;
    this._picksTeam.units.forEach(unit => {
      let count = counts.get(unit.type) || 0;

      if (board.focused === unit || board.selected === unit)
        unit.showFocus(0.8, 0xFFFFFF);
      else
        unit.showFocus(0.8);

      let bgColor;
      let textColor;
      let borderColor;
      let text;
      if (count === 0) {
        bgColor = 0x444444;
        textColor = 0xFF0000;
        borderColor = 0x222222;
        text = 'X';
      }
      else {
        bgColor = 0x008800;
        textColor = 0xFFFFFF;
        borderColor = 0x888888;
        text = count;
      }

      let position = unit.assignment.getTop();
      let countBox = new PIXI.Graphics();
      countBox.position = new PIXI.Point(
        position.x - TILE_WIDTH/4,
        position.y - TILE_HEIGHT,
      );
      countBox.lineStyle(1, borderColor, 1);
      countBox.beginFill(bgColor, 1);
      countBox.drawPolygon([
        20,  0,
        50,  0,
        60, 12,
        56, 20,
        24, 20,
        14,  8,
        20,  0,
      ]);
      let countText = new PIXI.Text(text, {
        fontFamily:      'Arial',
        fontSize:        '12px',
        stroke:          0,
        strokeThickness: 3,
        fill:            textColor,
      });
      countText.x = 37;
      countText.y = 1;
      countText.anchor.x = 0.5;
      countBox.addChild(countText);

      this._countsContainer.addChild(countBox);
    });
  }

  _render() {
    let renderer = this._renderer;

    this._board.sortUnits();

    // This is a hammer.  Without it, the mouse cursor will not change to a
    // pointer and back when needed without moving the mouse.
    renderer.plugins.interaction.update();

    renderer.render(this._stage);
    this._rendering = false;
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
