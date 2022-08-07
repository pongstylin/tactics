import { Container } from '@pixi/display';
import { Renderer } from '@pixi/core';

import { gameConfig } from 'config/client.js';
import trapFocus from 'components/trapFocus.js';
import Modal from 'components/Modal.js';
import UnitPicker from 'components/Modal/UnitPicker.js';
import Autosave from 'components/Autosave.js';
import ServerError from 'server/Error.js';
import Unit from 'tactics/Unit.js';
import unitDataMap from 'tactics/unitData.js';

import 'components/Modal/SetBuilder.scss';
import popup from 'components/popup.js';
import Board, {
  TILE_WIDTH,
  TILE_HEIGHT,
  FOCUS_TILE_COLOR,
} from 'tactics/Board.js';

const template = `
  <HEADER>
    <DIV class="name"></DIV>
    <DIV class="style"></DIV>
  </HEADER>
  <DIV class="field">
    <DIV class="card"></DIV>
  </DIV>
  <DIV class="buttons">
    <BUTTON type="button" name="save"   title="Save"       tabIndex="1" class="fa fa-check"></BUTTON>
    <BUTTON type="button" name="cancel" title="Cancel"     tabIndex="2" class="fa fa-xmark"></BUTTON>
    <BUTTON type="button" name="clear"  title="Clear"      tabIndex="3" class="fa fa-trash"></BUTTON>
    <BUTTON type="button" name="reset"  title="Reset"      tabIndex="4" class="fa fa-undo"></BUTTON>
    <BUTTON type="button" name="rotate" title="Rotate"     tabIndex="5" class="fa fa-location-arrow"></BUTTON>
    <BUTTON type="button" name="flip"   title="Flip Sides" tabIndex="6" class="fa fa-arrow-right-arrow-left"></BUTTON>
  </DIV>
`;

export default class SetBuilder extends Modal {
  constructor(data = {}, options = {}) {
    options.content = template;
    options.autoShow = false;
    options.closeOnCancel = false;

    super(options, Object.assign({
      gameType: null,
      set: null,
      colorId: data.colorId ?? gameConfig.myColorId,
      rotation: data.rotation ?? gameConfig.rotation,
    }));

    Object.assign(this, {
      _team: null,
      _unitPicker: null,
    });
    Object.assign(this._els, {
      name: this._els.content.querySelector('HEADER .name'),
      style: this._els.content.querySelector('HEADER .style'),
      field: this._els.content.querySelector('.field'),
      card: this._els.content.querySelector('.card'),
      save: this._els.content.querySelector('BUTTON[name=save]'),
      cancel: this._els.content.querySelector('BUTTON[name=cancel'),
      clear: this._els.content.querySelector('BUTTON[name=clear]'),
      reset: this._els.content.querySelector('BUTTON[name=reset]'),
      rotate: this._els.content.querySelector('BUTTON[name=rotate]'),
      flip: this._els.content.querySelector('BUTTON[name=flip]'),
    });
    this._els.modal.classList.add('setBuilder');
    this._els.save.addEventListener('click', this._onSave.bind(this));
    this._els.cancel.addEventListener('click', this._onCancel.bind(this));
    this._els.clear.addEventListener('click', this._onClear.bind(this));
    this._els.reset.addEventListener('click', this._onReset.bind(this));
    this._els.rotate.addEventListener('click', this._onRotate.bind(this));
    this._els.flip.addEventListener('click', this._onFlip.bind(this));

    const name = new Autosave({
      submitOnChange: true,
      defaultValue: false,
      value: this.data.set?.name ?? '',
      maxLength: 20,
      hideIcons: true,
    })
      .on('change', () => this._renderButtons())
      .appendTo(this._els.name);

    const width = Tactics.width - TILE_WIDTH*2;
    const height = Tactics.height - TILE_HEIGHT*2;
    const renderer = new Renderer({ width, height, backgroundAlpha:0 });

    // Let's not go crazy with the move events.
    renderer.plugins.interaction.moveWhenInside = true;

    // Save battery life by updating manually.
    renderer.plugins.interaction.useSystemTicker = false;

    const board = new Board();
    board.initCard();
    board.draw();
    board.on('card-tap', () => {
      popup({
        title: 'Set Management Tips',
        message: `
          <DIV>You can remove units from your set in 4 ways:</DIV>
          <UL>
            <LI>Click the trash can button to remove them all.  This is useful if you want to make a completely different set with different units.</LI>
            <LI>First tap a unit to select it.  This will cause the trash can on the board to light up.  Tap it to delete the selected unit.</LI>
            <LI>(Mouse Only) Drag a unit off the board and release.</LI>
            <LI>(Mouse Only) Right-click a unit and watch it die.</LI>
          </UL>
          <DIV>You can move units around the board in 3 ways:</DIV>
          <UL>
            <LI>First tap a unit to select it.  Then tap the empty destination tile of choice.</LI>
            <LI>If a unit cannot be placed on a tile, it will be darkened.</LI>
            <LI>The "Flip Side" button is useful if you just want to move your set to the other side of the board.</LI>
          </UL>
          <DIV>This is how you can add a unit to the board:</DIV>
          <UL>
            <LI>Make sure no units are selected.  If you want to deselect a unit, you can tap it again.</LI>
            <LI>Tap an empty tile to pop up unit selection.</LI>
          </UL>
        `,
        maxWidth: '500px',
      });
    });

    board
      .on('focus', ({ tile, unit }) => {
        Tactics.playSound('focus');
        board.focused = unit;

        this.drawCard();
        tile.paint('focus', 0.3, FOCUS_TILE_COLOR);

        this.renderBoard();
      })
      .on('blur', ({ tile, unit }) => {
        if (board.focused === unit)
          board.focused = null;

        this.drawCard();
        tile.strip();

        this.renderBoard();
      })
      .on('select', ({ target:tile }) => {
        if (!this.gameType.isCustomizable)
          return;

        const unit = tile.assigned;

        Tactics.playSound('select');

        this.selected = unit === board.selected ? null : unit;
      })
      .on('altSelect', ({ target:tile }) => {
        const unit = tile.assigned;
        if (!unit) return;

        this.killUnits(unit);
      })
      .on('deselect', () => {
        this.selected = null;
      })
      .on('dragStart', this._onDragStart.bind(this))
      .on('dragFocus', this._onDragFocus.bind(this))
      .on('dragBlur',  this._onDragBlur.bind(this))
      .on('dragDrop',  this._onDragDrop.bind(this))
      .on('card-change', event => {
        const card = board.card;
        const cardCanvas = card.canvas;

        // Update the pointer once the card finishes (dis)appearing.
        const transitionEndListener = () => {
          card.updatePointer();
          cardCanvas.removeEventListener('transitionend', transitionEndListener);
        };
        cardCanvas.addEventListener('transitionend', transitionEndListener);

        if (event.nvalue && event.ovalue === null)
          cardCanvas.classList.add('show');
        else if (event.nvalue === null)
          cardCanvas.classList.remove('show');
      });

    const countsContainer = new PIXI.Container();
    countsContainer.position = board.pixi.position.clone();

    const core = Tactics.getSprite('core');

    const trash = core.renderFrame({ spriteName:'Trash' }).container;
    trash.pointertap  = this._onTrashSelect.bind(this);
    trash.pointerover = this._onTrashFocus.bind(this);
    trash.pointerout  = this._onTrashBlur.bind(this);
    trash.alpha = 0;

    const trashFocus = core.renderFrame({ spriteName:'Focus' }).container;
    trashFocus.alpha = 0;
    trash.addChildAt(trashFocus, 0);

    const trashSprite = trash.children[1];
    const trashScale = 1.75;
    trashSprite.scale.set(trashScale);
    trashSprite.position.set(
      trashSprite.position.x * trashScale,
      trashSprite.position.y * trashScale,
    );

    const stage = new PIXI.Container();
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

      _name: name,

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
      _stage: stage,

      _resizeListener: this.resize.bind(this),
    });

    this._canvas.classList.add('board');
    // Allow a user to blur another element when clicking this one
    this._canvas.tabIndex = -1;

    this._els.card.appendChild(board.card.canvas);
    this._els.field.appendChild(this._canvas);

    this._canvas.addEventListener('contextmenu', event => event.preventDefault());

    this.on('attach', () => {
      this.resize();
      window.addEventListener('resize', this._resizeListener);
    });

    // Make sure the set name is included
    trapFocus(this._els.root);

    // Allow the Animation class to render frames.
    Tactics.game = this;

    if (data.gameType !== undefined && data.gameType !== null)
      this.gameType = data.gameType;
    if (data.set !== undefined && data.set !== null)
      this.set = data.set;

    this.rotateBoard(this.data.rotation);
    this._renderButtons();
  }

  /*****************************************************************************
   * Public Properties
   ****************************************************************************/
  get gameType() {
    return this.data.gameType;
  }
  set gameType(gameType) {
    this._els.style.textContent = gameType.name;
    this.data.gameType = gameType;

    const board = this._board;
    if (gameType.isCustomizable)
      board.unlock();
    else
      board.lock('readonly');

    if (this._unitPicker)
      this._unitPicker.destroy();
    this._unitPicker = new UnitPicker({ gameType, team:this._team });
  }

  get set() {
    const set = {};
    if (this.data.set.id) {
      set.id = this.data.set.id;
      set.name = this._name.value;
    }
    set.units = this._board.getState()[0];

    return set;
  }
  set set(set) {
    if (!set)
      set = {};
    if (set.name === undefined || set.name === null)
      set.name = set.id ? gameConfig.setsById.get(set.id) : 'Custom';
    if (set.units === undefined || set.units === null)
      set.units = [];

    this.data.set = set;
    this._team = { colorId:this.data.colorId, set };
    this._unitPicker.team = this._team;
    this._name.value = set.name;
    this._name.disabled = !this.data.gameType.isCustomizable || !set.id;
    this.reset();
    this._renderButtons();
  }

  get colorId() {
    return this.data.colorId;
  }
  set colorId(colorId) {
    this.data.colorId = colorId;
  }

  get renderer() {
    return this._renderer;
  }
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
    const board = this._board;
    const trash = this._trash;

    if (unit) {
      if (board.selected)
        board.selected.deactivate();

      unit.activate();
      board.selected = unit;
      this.drawCard();

      this._highlightPlaces();

      this._enableTrash();
    } else if (board.selected) {
      board.selected.deactivate();
      board.selected = null;
      this.drawCard();

      this._highlightPlaces();

      this._disableTrash();
    }
    else
      return;

    this.renderBoard();
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  show() {
    if (this.data.set === null)
      this.set = {};

    this._trash.alpha = 0.6;
    this._renderer.render(this._stage);

    this._els.modal.classList.toggle('left', gameConfig.barPosition === 'left');
    this._els.modal.classList.toggle('right', gameConfig.barPosition === 'right');

    return super.show(() => {
      this.drawCard();
    });
  }
  hide() {
    this.selected = null;

    this._trash.alpha = 0;

    return super.hide();
  }

  reset() {
    const board = this._board;
    const units = this.data.set.units.map(unitData => ({ ...unitData, direction:'S' }));

    board.clear();
    board.setState([ units, [] ], [ this._team, {} ]);
    board.sortUnits();
    board.teamsUnits.flat().forEach(u => u.draggable = true);

    this._highlightPlaces();
    this._setUnitsState();
    this.renderBoard();
  }

  placeUnit(unitType, tile) {
    const board = this._board;
    const degree = board.getDegree('N', board.rotation);

    if (tile.assigned)
      this.removeUnit(tile.assigned);

    const unit = board.addUnit({
      type: unitType,
      assignment: tile,
      direction: board.getRotation('S', degree),
    }, this._team);
    unit.draggable = true;

    this._highlightPlaces();
    this._setUnitsState();

    // Replacing units may require removing other units.
    this.killUnits();
  }
  moveUnit(unit, tile) {
    const board = this._board;

    if (tile.assigned)
      this.removeUnit(tile.assigned);

    board.assign(unit, tile);

    // Moving and replacing units may require removing other units.
    this.killUnits();
  }
  swapUnit(unit, srcTile, dstTile) {
    const board = this._board;
    const dstUnit = dstTile.assigned;

    board.assign(unit, dstTile);
    if (dstUnit)
      board.assign(dstUnit, srcTile);

    // Moving units may require removing other units.
    this.killUnits();
  }
  async killUnits(units) {
    const animDeath = new Tactics.Animation();
    const deadUnits = [];

    if (units) {
      if (!Array.isArray(units))
        units = [ units ];

      for (const unit of units) {
        unit.change({ mHealth:-unit.health });
        unit.assignment.set_interactive(false);
        deadUnits.push(unit);
        animDeath.splice(0, unit.animDie());
      }
    }

    const board = this._board;
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

      this._setUnitsState();
    }

    this._highlightPlaces();
    this._renderButtons();
    this.renderBoard();
  }
  removeUnit(unit) {
    const board = this._board;

    unit.change({ mHealth:-unit.health });
    board.dropUnit(unit);

    this._setUnitsState();
  }
  _auditUnitPlaces() {
    const auditUnits = [];

    this._team.units.forEach(unit => {
      if (unit.mHealth === -unit.health) return;

      const tiles = this._getAvailableTiles(unit.type);
      if (!tiles.has(unit.assignment))
        auditUnits.push(unit);
    });

    return auditUnits.length ? auditUnits : null;
  }
  /*
   * Allow touch devices to upscale to normal size.
   */
  resize() {
    const canvas = this._canvas;
    canvas.style.width  = '';
    canvas.style.height = '';

    const container = canvas.parentNode;
    const width = container.clientWidth;
    let height = container.clientHeight;

    height -= canvas.offsetTop;

    const widthRatio = width / canvas.width;
    const heightRatio = height / canvas.height;
    const elementScale = Math.min(1, widthRatio, heightRatio);

    if (elementScale < 1)
      if (widthRatio < heightRatio)
        canvas.style.width = '100%';
      else
        canvas.style.height = height + 'px';
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
  renderBoard() {
    if (!this.isVisible || this._rendering) return;
    this._rendering = true;

    requestAnimationFrame(this._renderBoard.bind(this));
  }
  /*
   * This clever function will call your animator every throttle millseconds
   * and render the result.  The animator must return false when the animation
   * is complete.  The animator is passed the number of frames that should be
   * skipped to maintain speed.
   */
  renderAnim(anim, fps) {
    const throttle = 1000 / fps;
    const animators = [anim];
    let start;
    let delay = 0;
    let count = 0;
    let skip = 0;
    let i;

    const loop = now => {
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
        this.renderBoard();
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
    const renderer = this._renderer;
    const board = this._board;
    const stage = this._stage;
    const trash = this._trash;

    this._els.modal.classList.remove(`rotation-${board.rotation}`);
    board.rotate(rotation);
    this._els.modal.classList.add(`rotation-${board.rotation}`);

    if (board.rotation === 'N') {
      stage.position.set(0, 0);

      const leftPoint = board.getTile(0, 4).getBottom().clone();
      leftPoint.set(
        leftPoint.x + stage.position.x + board.pixi.position.x - 1,
        leftPoint.y + stage.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(10, 4).getRight().clone();
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
        rightPoint.x, 0,
        0, 0,
        0, Tactics.height,
      ]);

      const tilePoint = board.getTile(5, 0).getCenter();
      trash.position.set(
        tilePoint.x + board.pixi.position.x - TILE_WIDTH,
        tilePoint.y + board.pixi.position.y - TILE_HEIGHT,
      );
    } else if (board.rotation === 'S') {
      stage.position.set(renderer.width - Tactics.width, renderer.height - Tactics.height);

      const leftPoint = board.getTile(0, 6).getLeft().clone();
      leftPoint.set(
        leftPoint.x + stage.position.x + board.pixi.position.x - 1,
        leftPoint.y + stage.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(10, 6).getTop().clone();
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

      const tilePoint = board.getTile(5, 10).getCenter();
      trash.position.set(
        tilePoint.x + board.pixi.position.x + TILE_WIDTH,
        tilePoint.y + board.pixi.position.y + TILE_HEIGHT,
      );
    } else if (board.rotation === 'E') {
      stage.position.set(renderer.width - Tactics.width, 0);

      const leftPoint = board.getTile(6, 0).getLeft().clone();
      leftPoint.set(
        leftPoint.x + stage.position.x + board.pixi.position.x - 1,
        leftPoint.y + stage.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(6, 10).getBottom().clone();
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
        Tactics.width, 0,
        0, 0,
      ]);

      const tilePoint = board.getTile(10, 5).getCenter();
      trash.position.set(
        tilePoint.x + board.pixi.position.x + TILE_WIDTH,
        tilePoint.y + board.pixi.position.y - TILE_HEIGHT,
      );
    } else if (board.rotation === 'W') {
      stage.position.set(0, renderer.height - Tactics.height);

      const leftPoint = board.getTile(4, 0).getTop().clone();
      leftPoint.set(
        leftPoint.x + stage.position.x + board.pixi.position.x - 1,
        leftPoint.y + stage.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(4, 10).getRight().clone();
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
        rightPoint.x, Tactics.height,
        0, Tactics.height,
        0, 0,
      ]);

      const tilePoint = board.getTile(0, 5).getCenter();
      trash.position.set(
        tilePoint.x + board.pixi.position.x - TILE_WIDTH,
        tilePoint.y + board.pixi.position.y + TILE_HEIGHT,
      );
    }

    this._highlightPlaces();
    this.renderBoard();
  }

  drawCard() {
    if (!this.isVisible) return;

    const board = this._board;
    const unit = board.focused ?? board.selected;

    if (unit)
      board.drawCard(unit);
    else if (this._hasFixedSet())
      board.drawCard(null, {
        title: 'Take a look!',
        body: 'This style does not support custom sets.',
      });
    else if (this._hasFullSet()) {
      if (this._hasChangedSet())
        board.drawCard(null, {
          title: 'Your set is full!',
          body: 'You can save your set with the checkmark button.',
        });
      else
        board.drawCard(null, {
          title: 'Want tips?',
          body: 'Tap this card any time for tips.',
        });
    } else {
      const stats = this._unitPicker.getStats();
      const numUnits = stats.available;
      const numPoints = stats.points.remaining;

      board.drawCard(null, {
        title: 'Add more units!',
        body: `You can still add ${numUnits} unit(s) with ${numPoints} point(s) remaining.`,
      });
    }

    return this;
  }

  getImage() {
    this._renderer.render(this._stage);

    return { src:this._canvas.toDataURL('image/png') };
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _onSave(event) {
    this._els.save.blur();

    const set = this.set;

    if (set.units.length === 0) {
      if (this.data.set.id === undefined)
        return this._emitDelete();

      const message = this.data.set.id === 'default'
        ? 'You are about to revert the set to the style default.  Are you sure?'
        : 'You are about to delete the set.  Are you sure?';

      popup({
        message,
        buttons: [
          { label:'Yes', onClick:() => this._emitDelete() },
          { label:'No' },
        ],
      });
      return;
    }

    try {
      this.data.gameType.validateSet(set);
    } catch (error) {
      if (error instanceof ServerError)
        popup(error.message);
      else {
        popup('Unexpected validation error');
        throw error;
      }
      return;
    }

    if (!this._hasFullSet())
      popup({
        message: 'You can still add more unit(s) to your team.  Are you sure?',
        buttons: [
          { label:'Yes', onClick:() => this._emitSave(set) },
          { label:'No' },
        ],
      });
    else
      this._emitSave(set);
  }
  _onCancel(event) {
    this._els.cancel.blur();

    const board = this._board;

    const emitCancel = () => {
      this._onReset(event);
      this.hide();
    };

    if (this._hasChangedSet()) {
      popup({
        message: 'The changes you made will be lost.  Are you sure?',
        buttons: [
          { label:'Yes', onClick:emitCancel },
          { label:'No' },
        ],
      });
    } else
      emitCancel();
  }
  async _onClear(event) {
    this._els.clear.blur();
    this._els.clear.disabled = true;
    await this.killUnits(this._team.units);
    if (!this._name.disabled)
      this._name.value = gameConfig.setsById.get(this.data.set.id);
  }
  _onReset(event) {
    this._els.reset.blur();
    this._name.value = this.data.set.name;
    this.reset();
    this._renderButtons();
  }
  _onRotate(event) {
    this._els.rotate.blur();
    this.rotateBoard(90);
    gameConfig.rotation = this._board.rotation;
    this._renderButtons();
  }
  _onFlip(event) {
    this._els.flip.blur();
    this._board.flip();
    this.renderBoard();
    this._renderButtons();
  }
  _renderButtons() {
    const board = this._board;
    const setIsFixed = this._hasFixedSet();
    const setIsFull = this._hasFullSet();
    const setIsEmpty = this._hasEmptySet();
    const setIsValid = this._hasValidSet();
    const setHasChanged = this._hasChangedSet();

    this._els.save.disabled = !setHasChanged;
    this._els.save.classList.toggle('alert', !setIsFull || setIsEmpty || !setIsValid);
    this._els.cancel.classList.toggle('alert', setHasChanged);
    this._els.clear.disabled = setIsFixed || setIsEmpty;
    this._els.reset.disabled = !setHasChanged;
    this._els.rotate.classList.toggle('fa-rotate-90', board.rotation === 'S');
    this._els.rotate.classList.toggle('fa-rotate-180', board.rotation === 'W');
    this._els.rotate.classList.toggle('fa-rotate-270', board.rotation === 'N');
    this._els.rotate.disabled = board.rotation !== gameConfig.rotation;
    this._els.flip.disabled = setIsEmpty || this.gameType.hasFixedPositions;

    this.drawCard();
  }

  async _emitDelete() {
    if (this.data.set.id) {
      const defaultSet = await Tactics.gameClient.deletePlayerSet(this.data.gameType.id, this.data.set.id);
      if (defaultSet)
        this.set = defaultSet;
    }
    this.hide();
  }
  async _emitSave(set) {
    if (set.id) {
      await Tactics.gameClient.savePlayerSet(this.data.gameType.id, set);
    }
    this.hide();
  }

  _hasFixedSet() {
    return !this.gameType.isCustomizable;
  }
  /*
   * Check if the current set is different from the initial set
   */
  _hasChangedSet() {
    if (!this._team)
      return false;

    const board = this._board;
    const degree = board.getDegree('N', board.rotation);
    const oName = this.data.set.name;
    const oUnits = this.data.set.units.map(unitData => ({ ...unitData, direction:'S' }));
    const nName = this._name.value;
    const nUnits = this._team.units;

    return oName !== nName || oUnits.length !== nUnits.length || oUnits.findIndex(unit => {
      const unit2 = board.getTileRotation(unit.assignment, degree).assigned;

      return !(unit2 && unit2.type === unit.type);
    }) > -1;
  }
  _hasFullSet() {
    if (!this._team)
      return false;

    return !this._unitPicker.canPick();
  }
  _hasEmptySet() {
    if (!this._team)
      return false;

    return this._team.units.length === 0;
  }
  _hasValidSet() {
    if (!this._team)
      return false;

    try {
      this.data.gameType.validateSet({ units:this._board.getState()[0] });
    } catch (e) {
      return false;
    }

    return true;
  }

  /*
   * DragStart fires by simply pressing the mouse button.
   * We don't know yet if this is a tap or a drag situation.
   * So, track mouse position to see if it is dragged before release.
   */
  _onDragStart(event) {
    const unit = event.targetUnit;

    this._dragSource = event;

    this._stage.interactive = true;
    this.renderBoard();
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
    const dragSource = this._dragSource;
    if (!dragSource) return;

    const board = this._board;
    const dragUnit = dragSource.targetUnit;

    let dragAvatar = this._dragAvatar;
    if (!dragAvatar) {
      const sx = dragSource.pointerEvent.clientX;
      const sy = dragSource.pointerEvent.clientY;
      const cx = pointerEvent.clientX;
      const cy = pointerEvent.clientY;
      const dist = Math.sqrt(Math.abs(cx - sx)**2 + Math.abs(cy - sy)**2);
      if (dist < 5) return;

      dragAvatar = new PIXI.Container();
      dragAvatar.addChild(Tactics.drawAvatar(dragUnit, { as:'frame', direction:dragUnit.direction }));

      this.selected = null;

      // Avatar is behind trash can.
      const trashIndex = this._stage.getChildIndex(this._trash);
      this._stage.addChildAt(this._dragAvatar = dragAvatar, trashIndex);

      board.dismiss(dragUnit);
      this._enableTrash(false);

      const { places, noplaces } = this._highlightPlaces(dragUnit, true);

      places.forEach(tile => {
        tile.isDropTarget = true;
      });
      noplaces.forEach(tile => {
        tile.set_interactive(false);
      });
    }

    if (board.focusedTile && board.focusedTile.isDropTarget) {
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
        const focusedTile = board.focusedTile;
        if (focusedTile && focusedTile.isDropTarget) return;

        // Hide shadow while over trash can
        dragUnit.getContainerByName('shadow', dragAvatar).alpha = 0;

        const trashPoint = this._trash.position;
        dragAvatar.position.set(
          trashPoint.x,
          trashPoint.y - TILE_HEIGHT/4,
        );
        this._onTrashFocus();
      });
    }

    this.renderBoard();
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
    const dragSource = this._dragSource;
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

      const dragUnit = dragSource.targetUnit;
      if (cancelled) {
        if (tile) {
          this._board.assign(dragUnit, tile);

          // Prevent tap event from firing
          tile.set_interactive(false);
          setTimeout(() => {
            tile.set_interactive(true);
            this._highlightPlaces();
            this._setUnitsState();
          });
        } else {
          this.removeUnit(dragUnit);
          this.killUnits();
        }
      } else {
        // Make sure the unit is focused after assignment
        this._board.clearHighlight(tile);

        this.swapUnit(dragUnit, dragSource.target, tile);
      }

      this._disableTrash();
    }

    this.renderBoard();
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
    const selected = this.selected;
    this.selected = null;

    this.killUnits(selected);
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
    return this.data.gameType.getAvailableTiles(this._board, unitType);
  }

  _highlightPlaces(unit = this._board.selected, dragMode) {
    if (!this.data.gameType.isCustomizable)
      return;

    const board = this._board;
    board.clearHighlight();

    const tiles = this._getAvailableTiles(unit && unit.type);
    const hasFullSet = this._hasFullSet();
    const places = [];
    const noplaces = [];

    for (let x = 0; x < 11; x++) {
      for (let y = 0; y < 11; y++) {
        const tile = board.getTile(x, y);
        if (!tile) continue;

        if (tiles.has(tile)) {
          if (unit && (!tile.assigned || dragMode))
            places.push(tile);
          else if (!unit && !hasFullSet && !tile.assigned)
            places.push(tile);
        } else {
          tile.set_interactive(!!tile.assigned);
          noplaces.push(tile);
        }
      }
    }

    board.setHighlight(places, {
      action: 'place',
      color: 0xFFFFFF,
      alpha: 0,
      onFocus: ({ target:tile }) => {
        Tactics.playSound('focus');
        tile.setAlpha(0.3);
        this.renderBoard();
      },
      onBlur: ({ target:tile }) => {
        tile.setAlpha(0);
        this.renderBoard();
      },
      onSelect: async ({ target:tile }) => {
        Tactics.playSound('select');

        if (unit) {
          // Make sure the unit is focused after assignment
          board.clearHighlight(tile);

          this.moveUnit(unit, tile);
        } else {
          const unitType = await this._unitPicker.pick();
          Tactics.playSound('select');
          this.placeUnit(unitType, tile);
        }
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
        this.renderBoard();
      },
      onBlur: ({ target:tile }) => {
        if (!tile.is_interactive()) return;

        tile.paint('noplace', 0.3, 0x000000);
        this.renderBoard();
      },
      onSelect: ({ target:tile }) => {
        this.selected = tile.assigned;
      },
    }, true);

    return { places, noplaces };
  }
  _setUnitsState() {
    const gameType = this.data.gameType;
    const set = gameType.applySetUnitState(gameType.cleanSet({
      units: this._board.getState()[0],
    }));

    for (let i = 0; i < this._team.units.length; i++) {
      const unit = this._team.units[i];

      const changes = {
        mPower: 0,
        ...set.units[i],
      };
      delete changes.type;
      delete changes.assignment;
      delete changes.direction;

      unit.change(changes);
    }
  }

  _renderBoard() {
    const renderer = this._renderer;

    this._board.sortUnits();

    // This is a hammer.  Without it, the mouse cursor will not change to a
    // pointer and back when needed without moving the mouse.
    renderer.plugins.interaction.update();

    renderer.render(this._stage);
    this._rendering = false;
  }

  destroy() {
    Tactics.game = null;
    super.destroy();
  }
};
