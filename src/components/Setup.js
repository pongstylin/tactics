import { Renderer } from '@pixi/core';
import { Container } from '@pixi/display';
import ServerError from 'server/Error.js';
import emitter from 'utils/emitter.js';

import './Setup.scss';
import popup from 'components/popup.js';
import Board, {
  TILE_WIDTH,
  TILE_HEIGHT,
  FOCUS_TILE_COLOR,
} from 'tactics/Board.js';

const template = `
  <DIV class="field"></DIV>
  <DIV class="menubar">
    <DIV class="back">
      <A href="javascript:void(0)">Go Back</A>
    </DIV>
    <DIV class="title"></DIV>
    <DIV class="buttons">
      <BUTTON name="save">Save and Exit</BUTTON>
    </DIV>
  </DIV>
`;

export default class Setup {
  constructor(team, gameType) {
    let root = document.createElement('DIV');
    root.className = 'view setup';
    root.innerHTML = template;
    root.querySelector('.back A')
      .addEventListener('click', this._onBack.bind(this));
    root.querySelector('.title')
      .textContent = gameType.name;
    root.querySelector('BUTTON[name=save]')
      .addEventListener('click', this._onSave.bind(this));

    document.body.appendChild(root);

    // Clip unused empty space part #1
    let width = Tactics.width - TILE_WIDTH*2;
    let height = Tactics.height - TILE_HEIGHT*1.5;
    let renderer = new Renderer({ width, height, backgroundAlpha:0 });

    // Let's not go crazy with the move events.
    renderer.plugins.interaction.moveWhenInside = true;

    let board = new Board();
    board.initCard();
    board.rotation = 'S';
    board.draw();

    // Set back the pick tiles to give the visible board some space.
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 11; x++) {
        let tile = board.getTile(x, y);
        if (!tile) continue;

        tile.pixi.position.set(
          tile.pixi.position.x - TILE_WIDTH/4,
          tile.pixi.position.y - TILE_HEIGHT/4,
        );
      }
    }

    board
      .on('focus', ({ tile, unit }) => {
        if (unit.team.name === 'Pick') {
          let count = this._getAvailableUnitCounts().get(unit.type);
          if (count === 0) return;
        }

        Tactics.playSound('focus');
        board.focused = unit;

        if (unit.team.name === 'Set') {
          this.drawCard();
          tile.paint('focus', 0.3, FOCUS_TILE_COLOR);
        }
        else
          this._drawPicks();

        this.render();
      })
      .on('blur', ({ tile, unit }) => {
        if (unit.team.name === 'Pick') {
          let count = this._getAvailableUnitCounts().get(unit.type);
          if (count === 0) return;
        }

        if (board.focused === unit)
          board.focused = null;

        if (unit.team.name === 'Set') {
          this.drawCard();
          tile.strip();
        }
        else
          this._drawPicks();

        this.render();
      })
      .on('select', ({ target:tile }) => {
        let unit = tile.assigned;

        Tactics.playSound('select');
        if (unit.team.name === 'Pick') {
          let count = this._getAvailableUnitCounts().get(unit.type);
          if (count === 0) return;
        }

        this.selected = unit === board.selected ? null : unit;
      })
      .on('altSelect', ({ target:tile }) => {
        let unit = tile.assigned;
        if (!unit || unit.team.name === 'Pick') return;

        this.killUnit(unit);
      })
      .on('deselect', () => {
        this.selected = null;
      })
      .on('dragStart', this._onDragStart.bind(this))
      .on('dragFocus', this._onDragFocus.bind(this))
      .on('dragBlur',  this._onDragBlur.bind(this))
      .on('dragDrop',  this._onDragDrop.bind(this))
      .on('card-change', event => {
        let card = board.card;
        let cardCanvas = card.canvas;

        // Update the pointer once the card finishes (dis)appearing.
        let transitionEndListener = () => {
          card.updatePointer();
          cardCanvas.removeEventListener('transitionend', transitionEndListener);
        };
        cardCanvas.addEventListener('transitionend', transitionEndListener);

        if (event.nvalue && event.ovalue === null)
          cardCanvas.classList.add('show');
        else if (event.nvalue === null)
          cardCanvas.classList.remove('show');
      });

    let countsContainer = new PIXI.Container();
    countsContainer.position = board.pixi.position.clone();

    let core = Tactics.getSprite('core');

    let tilePoint = board.getTile(5, 10).getCenter();
    let trash = core.renderFrame({ spriteName:'Trash' }).container;
    trash.position.set(
      tilePoint.x + board.pixi.position.x + TILE_WIDTH,
      tilePoint.y + board.pixi.position.y + TILE_HEIGHT,
    );
    trash.pointertap  = this._onTrashSelect.bind(this);
    trash.pointerover = this._onTrashFocus.bind(this);
    trash.pointerout  = this._onTrashBlur.bind(this);
    trash.alpha = 0.6;

    let trashFocus = core.renderFrame({ spriteName:'Focus' }).container;
    trashFocus.alpha = 0;
    trash.addChildAt(trashFocus, 0);

    let trashSprite = trash.children[1];
    let trashScale = 1.75;
    trashSprite.scale.set(trashScale);
    trashSprite.position.set(
      trashSprite.position.x * trashScale,
      trashSprite.position.y * trashScale,
    );

    let stage = new PIXI.Container();
    // Clip unused empty space part #2
    stage.position.set(width - Tactics.width + 20, height - Tactics.height);
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
      root: root,

      // Crude tracking of the pointer type being used.  Ideally, this should
      // reflect the last pointer type to fire an event on the board.
      pointerType: 'ontouchstart' in window ? 'touch' : 'mouse',
      gameType: gameType,

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

      _resizeListener: null,
    });

    board.card.canvas.classList.add('card');
    this.canvas.classList.add('board');

    root.querySelector('.field').appendChild(board.card.canvas);
    root.querySelector('.field').appendChild(this.canvas);

    this._canvas.addEventListener('contextmenu', event => event.preventDefault());

    let unitTypes = gameType.getUnitTypes().reverse();
    let positions = this._getPositions(unitTypes.length);
    this._picksTeam.set = {
      units: unitTypes.map((ut, i) => ({ type:ut, assignment:positions[i] })),
    };

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

    this.resize();
    this._resizeListener = this.resize.bind(this);
    window.addEventListener('resize', this._resizeListener);

    this.reset();
  }

  /*****************************************************************************
   * Public Properties
   ****************************************************************************/
  get renderer() {
    return this._renderer;
  }
  get canvas() {
    return this._canvas;
  }

  get set() {
    return this._team.set;
  }
  set set(set) {
    return this._team.set = set;
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
      this.drawCard();

      this._highlightPlaces();

      if (unit.team.name === 'Set')
        this._enableTrash();
    }
    else if (board.selected) {
      board.selected.deactivate();
      board.selected = null;
      this.drawCard();

      this._highlightPlaces();

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
  show() {
    this.root.classList.add('show');

    // Allow the Animation class to render frames.
    Tactics.game = this;

    return this;
  }
  hide() {
    this.root.classList.remove('show');

    this.selected = null;
    Tactics.game = null;

    return this;
  }

  reset() {
    let board = this._board;
    let units = this._team.set.units.map(unitData => ({ ...unitData, direction:'S' }));
    let picksTeamUnits = this._picksTeam.set.units.map(unitData => ({
      ...unitData, direction:'N'
    }));

    board.clear();
    board.setState([units, picksTeamUnits], [this._team, this._picksTeam]);
    board.teamsUnits.flat().forEach(u => u.draggable = true);

    this._highlightPlaces();
    this._drawPicks();
    this._setUnitsState();
    this.render();
  }

  placeUnit(unitType, tile) {
    let board = this._board;
    let degree = board.getDegree('N', board.rotation);

    if (tile.assigned)
      this.removeUnit(tile.assigned);

    let unit = board.addUnit({
      type: unitType,
      assignment: tile,
      direction: board.getRotation('S', degree),
    }, this._team);
    unit.draggable = true;

    this._highlightPlaces();
    this._drawPicks();
    this._setUnitsState();

    // Replacing units may require removing other units.
    this.killUnit();
  }
  moveUnit(unit, tile) {
    let board = this._board;

    if (tile.assigned)
      this.removeUnit(tile.assigned);

    board.assign(unit, tile);

    // Moving and replacing units may require removing other units.
    this.killUnit();
  }
  swapUnit(unit, srcTile, dstTile) {
    let board = this._board;
    let dstUnit = dstTile.assigned;

    board.assign(unit, dstTile);
    if (dstUnit)
      board.assign(dstUnit, srcTile);

    // Moving units may require removing other units.
    this.killUnit();
  }
  async killUnit(unit) {
    let animDeath;
    let deadUnits = [];
    if (unit) {
      unit.change({ mHealth:-unit.health });
      unit.assignment.set_interactive(false);
      deadUnits.push(unit);
      animDeath = unit.animDie();
    }
    else
      animDeath = new Tactics.Animation();

    let board = this._board;
    let auditUnits;
    while (auditUnits = this._auditUnitPlaces()) {
      auditUnits.forEach(unit => {
        unit.change({ mHealth:-unit.health });
        unit.assignment.set_interactive(false);
        deadUnits.push(unit);
        animDeath.splice(0, unit.animDie());
      });
    }

    if (animDeath.frames.length) {
      await animDeath.play();

      this._highlightPlaces();
      this._drawPicks();
      this._setUnitsState();
    }
  }
  removeUnit(unit) {
    let board = this._board;

    unit.change({ mHealth:-unit.health });
    board.dropUnit(unit);

    this._highlightPlaces();
    this._drawPicks();
    this._setUnitsState();
  }
  _auditUnitPlaces() {
    let auditUnits = [];

    this._team.units.forEach(unit => {
      if (unit.mHealth === -unit.health) return;

      let tiles = this._getAvailableTiles(unit.type);
      if (!tiles.has(unit.assignment))
        auditUnits.push(unit);
    });

    return auditUnits.length ? auditUnits : null;
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

    height -= canvas.offsetTop;

    let widthRatio   = width  / canvas.width;
    let heightRatio  = height / canvas.height;
    let elementScale = Math.min(1, widthRatio, heightRatio);

    if (elementScale < 1)
      if (widthRatio < heightRatio)
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

  drawCard() {
    let board = this._board;
    let unit = board.selected;
    if (board.focused && board.focused.team.name === 'Set')
      unit = board.focused;

    board.drawCard(unit);
    return this;
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _onBack(event) {
    let emitBack = () => {
      this.hide();
      this._emit({ type:'back' });
    };

    /*
     * Check if the current set is different from the initial set
     */
    let board = this._board;
    let oUnits = this._team.set.units.map(unitData => ({ ...unitData, direction:'S' }));
    let nUnits = this._team.units;
    let mismatch = oUnits.length !== nUnits.length || oUnits.find(unit => {
      let unit2 = board.getTileRotation(unit.assignment, 180).assigned;

      return !(unit2 && unit2.type === unit.type);
    });

    if (mismatch) {
      popup({
        message: 'Any changes you made will be lost.  Are you sure?',
        buttons: [
          { label:'Yes', onClick:emitBack },
          { label:'No' },
        ],
      });
    }
    else
      emitBack();
  }
  _onSave(event) {
    let board = this._board;
    let set = {
      units: board.getState()[0],
    };

    try {
      this.gameType.validateSet(set);
    }
    catch (error) {
      if (error instanceof ServerError)
        popup(error.message);
      else {
        popup('Unexpected validation error');
        throw error;
      }
      return;
    }

    let emitSave = () => {
      this.hide();

      this._emit({ type:'save', data:set });
    };

    let counts = this._getAvailableUnitCounts();
    if (counts.get('any'))
      popup({
        message: 'You can still add more unit(s) to your team.  Are you sure?',
        buttons: [
          { label:'Yes', onClick:emitSave },
          { label:'No' },
        ],
      });
    else
      emitSave();
  }

  /*
   * DragStart fires by simply pressing the mouse button.
   * We don't know yet if this is a tap or a drag situation.
   * So, track mouse position to see if it is dragged before release.
   */
  _onDragStart(event) {
    let unit = event.targetUnit;
    if (unit.team.name === 'Pick') {
      let count = this._getAvailableUnitCounts().get(unit.type);
      if (count === 0) return;
    }

    this._dragSource = event;

    this._stage.interactive = true;
    this.render();
  }
  _onDragFocus(event) {
    Tactics.playSound('focus');
    event.target.paint('focus', 0.3, FOCUS_TILE_COLOR);
    this._onDragMove(event);
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
      dragAvatar.addChild(dragUnit.drawAvatar(dragUnit.direction, false));

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

      let { places, noplaces } = this._highlightPlaces(dragUnit, true);

      places.forEach(tile => {
        tile.isDropTarget = true;
      });
      noplaces.forEach(tile => {
        tile.set_interactive(false);
      });
    }

    if (
      board.focusedTile && board.focusedTile.isDropTarget ||
      dragUnit.team.name === 'Pick'
    ) {
      // Show shadow while over tiles
      dragUnit.getContainerByName('shadow', dragAvatar).alpha = 1;

      if (pixiEvent)
        dragAvatar.position = pixiEvent.data.getLocalPosition(this._stage);
      this._onTrashBlur();
    }
    else if (!this._trashIsFocused()) {
      // There can be a very brief delay between the old tile blurring and a new
      // tile focusing.  So, only focus trash if appropriate after a delay.
      setTimeout(() => {
        // Skip if the drag has dropped
        if (this._dragAvatar !== dragAvatar) return;

        // Skip if cursor has moved back over a drop target
        let focusedTile = board.focusedTile;
        if (focusedTile && focusedTile.isDropTarget) return;

        // Hide shadow while over trash can
        dragUnit.getContainerByName('shadow', dragAvatar).alpha = 0;

        let trashPoint = this._trash.position;
        dragAvatar.position.set(
          trashPoint.x,
          trashPoint.y - TILE_HEIGHT/4,
        );
        this._onTrashFocus();
      });
    }

    this.render();
  }
  /*
   * If cancelled === true:
   *   It means the unit was dropped outside a valid tile or on the origin tile.
   *   If tile is defined, it is the latter.
   * else
   *   The unit was dropped on an empty or occupied tile.
   *   If occupied, the units are swapped.
   */
  _onDragDrop({ pixiEvent, target:tile, cancelled }) {
    let dragSource = this._dragSource;
    if (!dragSource) return;

    this._dragSource = null;
    this._stage.interactive = false;

    if (this._dragAvatar) {
      Tactics.playSound('select');

      this._dragAvatar.destroy();
      this._dragAvatar = null;
      this._board.tiles.forEach(tile => {
        tile.isDropTarget = false;
        tile.set_interactive(!!tile.assigned);
      });

      let dragUnit = dragSource.targetUnit;
      if (cancelled) {
        if (dragUnit.team.name === 'Set') {
          if (tile) {
            this._board.assign(dragUnit, tile);

            // Prevent tap event from firing
            tile.set_interactive(false);
            setTimeout(() => {
              tile.set_interactive(true);
              this._highlightPlaces();
              this._drawPicks();
              this._setUnitsState();
            });
          }
          else {
            this.removeUnit(dragUnit);
            this.killUnit();
          }
        }
      }
      else {
        // Make sure the unit is focused after assignment
        this._board.clearHighlight(tile);

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
    Tactics.playSound('select');
    let selected = this.selected;
    this.selected = null;

    this.killUnit(selected);
    this._disableTrash();
  }
  _trashIsFocused() {
    return this._trash.children[0].alpha !== 0;
  }
  _onTrashFocus() {
    Tactics.playSound('focus');
    this._trash.children[0].alpha = 1;
  }
  _onTrashBlur() {
    this._trash.children[0].alpha = 0;
  }
  _getAvailableTiles(unitType) {
    return this.gameType.getAvailableTiles(this._board, unitType);
  }

  _getPositions(num) {
    let board = this._board;

    if (num < 10)
      return [
        [5, 5], [3, 5], [7, 5], [1, 5], [9, 5],
        [5, 7], [3, 7], [7, 7],
        [5, 9],
      ];
    else if (num < 14) {
      /*
       * Space out the tiles a bit
       */
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 11; x++) {
          let tile = board.getTile(x, y);
          if (!tile) continue;

          let distance = 5 - Math.abs(x - 10);
          let offset = board.getOffset(distance / 3, 'E');

          tile.pixi.position.x += offset[0];
          tile.pixi.position.y += offset[1];
        }
      }

      return [
        [5, 5], [4, 5], [6, 5], [3, 5], [7, 5], [2, 5], [8, 5],
        [5, 7], [4, 7], [6, 7], [3, 7], [7, 7],
        [5, 9],
      ];
    }
    else if (num < 19) {
      /*
       * Space out the tiles a bit
       */
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 11; x++) {
          let tile = board.getTile(x, y);
          if (!tile) continue;

          let distanceX = 5 - Math.abs(x - 10);
          let offsetX = board.getOffset(distanceX / 4, 'E');
          let distanceY = Math.abs(y - 5);
          let offsetY = board.getOffset(distanceY / 2, 'N');

          tile.pixi.position.x += offsetX[0] + offsetY[0];
          tile.pixi.position.y += offsetX[1] + offsetY[1];

          if (y === 4) {
            let offset = board.getOffset(1 / 3, 'E');
            tile.pixi.position.x += offset[0];
            tile.pixi.position.y += offset[1];
          }
        }
      }

      return [
        [5, 5], [4, 5], [6, 5], [3, 5], [7, 5], [2, 5], [8, 5], [1, 5], [9, 5],
        [5, 6], [6, 6], [4, 6], [7, 6], [3, 6], [8, 6],
        [5, 7], [6, 7], [4, 7],
      ];
    }
    else if (num < 20) {
      /*
       * Space out the tiles a bit
       */
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 11; x++) {
          let tile = board.getTile(x, y);
          if (!tile) continue;

          let distanceX = 5 - Math.abs(x - 10);
          let offsetX = board.getOffset(distanceX / 4, 'E');
          let distanceY = Math.abs(y - 5);
          let offsetY = board.getOffset(distanceY / 2, 'N');

          tile.pixi.position.x += offsetX[0] + offsetY[0];
          tile.pixi.position.y += offsetX[1] + offsetY[1];

          if (y === 3) {
            let offset = board.getOffset(2 / 3, 'E');
            tile.pixi.position.x += offset[0];
            tile.pixi.position.y += offset[1];
          }
          else if (y === 4) {
            let offset = board.getOffset(1 / 3, 'E');
            tile.pixi.position.x += offset[0];
            tile.pixi.position.y += offset[1];
          }
        }
      }

      return [
        [5, 5], [4, 5], [6, 5], [3, 5], [7, 5], [2, 5], [8, 5], [1, 5], [9, 5],
        [5, 6], [6, 6], [4, 6], [7, 6], [3, 6], [8, 6],
        [5, 7], [6, 7], [4, 7], [7, 7],
      ];
    }

    return positions;
  }
  _getAvailableUnitCounts() {
    const gameType = this.gameType;
    const unitCounts = new Map();
    const counts = new Map();
    let unitsRemaining = gameType.getMaxUnits();

    this._team.units.forEach(unit => {
      if (unit.mHealth === -unit.health) return;

      const unitCount = unitCounts.get(unit.type) || 0;
      const unitSize = gameType.getUnitSize(unit.type);

      unitsRemaining -= unitSize;
      unitCounts.set(unit.type, unitCount + 1);
    });

    counts.set('any', false);

    gameType.getUnitTypes().forEach(unitType => {
      const unitCount = unitCounts.get(unitType) || 0;
      const unitSize = gameType.getUnitSize(unitType);
      const unitMaxCount = gameType.getUnitMaxCount(unitType);

      if (unitsRemaining < unitSize)
        counts.set(unitType, 0);
      else {
        counts.set('any', true);
        counts.set(unitType, unitMaxCount - unitCount);
      }
    });

    return counts;
  }
  _highlightPlaces(unit = this._board.selected, dragMode) {
    let board = this._board;
    let tiles = this._getAvailableTiles(unit && unit.type);
    let places = [];
    let noplaces = [];

    for (let x = 0; x < 11; x++) {
      for (let y = 6; y < 11; y++) {
        let tile = board.getTile(x, y);
        if (!tile) continue;

        if (tiles.has(tile)) {
          if (unit && (!tile.assigned || dragMode))
            places.push(tile);
        }
        else {
          tile.set_interactive(!!tile.assigned);
          noplaces.push(tile);
        }
      }
    }

    board.clearHighlight();

    board.setHighlight(places, {
      action: 'place',
      color: 0xFFFFFF,
      alpha: 0,
      onFocus: ({ target:tile }) => {
        Tactics.playSound('focus');
        tile.setAlpha(0.3);
        this.render();
      },
      onBlur: ({ target:tile }) => {
        tile.setAlpha(0);
        this.render();
      },
      onSelect: ({ target:tile }) => {
        Tactics.playSound('select');
        // Make sure the unit is focused after assignment
        board.clearHighlight(tile);

        if (unit.team.name === 'Pick')
          this.placeUnit(unit.type, tile);
        else
          this.moveUnit(unit, tile);

        this._highlightPlaces();
        this.render();
      },
    });

    board.setHighlight(noplaces, {
      action: 'noplace',
      color: 0x000000,
      alpha: 0.3,
      onFocus: ({ target:tile }) => {
        if (!tile.is_interactive()) return;

        Tactics.playSound('focus');
        tile.paint('focus', 0.3, 0xFFFFFF);
        this.render();
      },
      onBlur: ({ target:tile }) => {
        if (!tile.is_interactive()) return;

        tile.paint('noplace', 0.3, 0x000000);
        this.render();
      },
      onSelect: ({ target:tile }) => {
        this.selected = tile.assigned;
      },
    }, true);

    return { places, noplaces };
  }
  _drawPicks() {
    const counts = this._getAvailableUnitCounts();

    this._countsContainer.removeChildren();

    const board = this._board;
    this._picksTeam.units.forEach(unit => {
      let count = counts.get(unit.type);

      if (count === 0) {
        if (board.selected === unit)
          this.selected = null;
        if (board.focused === unit) {
          board.focused = null;
          this.drawCard();
        }

        unit.assignment.set_interactive(false);
        unit.showFocus(0.8);
      } else {
        unit.assignment.set_interactive(true);

        if (board.focused === unit || board.selected === unit)
          unit.showFocus(0.8, 0xFFFFFF);
        else
          unit.showFocus(0.8);
      }

      let textColor;
      let text;
      if (count === 0) {
        textColor = 0x888888;
        text = 'x';
      } else {
        textColor = 0xFFFFFF;
        text = count;
      }

      const countText = new PIXI.Text(text, {
        fontFamily:      'Arial',
        fontSize:        '16px',
        stroke:          0,
        strokeThickness: 3,
        fill:            textColor,
      });
      countText.position = unit.assignment.getBottom();
      countText.position.y -= 20;
      countText.anchor.x = 0.5;

      this._countsContainer.addChild(countText);
    });
  }
  _setUnitsState() {
    let gameType = this.gameType;
    let set = gameType.applySetUnitState(gameType.cleanSet({
      units: this._board.getState()[0],
    }));

    for (let i = 0; i < this._team.units.length; i++) {
      let unit = this._team.units[i];

      let changes = {
        mPower: 0,
        ...set.units[i],
      };
      delete changes.type;
      delete changes.assignment;
      delete changes.direction;

      unit.change(changes);
    }
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
};

emitter(Setup);
