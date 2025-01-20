/*
  Philosophy:
    A tile should have no awareness of the overall board.
*/
import emitter from '#utils/emitter.js';

export const TILE_WIDTH  = 88;
export const TILE_HEIGHT = 56;
const points = [
  42,0,  // top-left
  45,0,  // top-right
  87,27, // right-top
  87,28, // right-bottom
  45,55, // bottom-right
  42,55, // bottom-left
  0 ,28, // left-bottom
  0 ,27, // left-top
  42,0   // close
];

export default class Tile {
  constructor(x, y) {
    Object.assign(this, {
      id: x+'x'+y,
      x: x,
      y: y,
      coords: [x, y],

      // Public properties
      pixi:     null,
      assigned: null,
      focused:  false,
      painted:  null,

      isDragging: false,
      isDropTarget: false,
    });
  }

  // Public methods
  draw() {
    let pixi = this.pixi = new PIXI.Graphics();
    pixi.label = 'Tile';
    pixi.position = new PIXI.Point(...this.position);

    // Clone the points array, cause it gets messed up otherwise.
    pixi.poly(points.slice());
    pixi.hitArea = new PIXI.Polygon(points.slice());

    pixi.alpha = 0;
    pixi.fill({ color:0xFFFFFF, alpha:1 });
    pixi.stroke({ width:1, color:0xFFFFFF, alpha:1 });

    pixi.interactive = true;
    pixi.cursor = null;
    pixi.on('pointertap', this.onSelect.bind(this));
    pixi.on('pointerover', this.onFocus.bind(this));
    pixi.on('pointerout', this.onBlur.bind(this));

    // Drag events are only supported for mouse pointers
    pixi.on('mousedown', this.onDragStart.bind(this));
    pixi.on('mouseup', this.onDragDrop.bind(this));
    pixi.on('mouseupoutside', this.onDragCancel.bind(this));

    // PIXI does not emit 'pointerover' or 'pointerout' events for touch pointers.
    // Use 'touchmove' to simulate focus events.
    // Use 'touchend' to simulate blur events.
    // The board object will handle blurring as the touch pointer moves.
    pixi.on('touchmove', this.onFocus.bind(this));
    pixi.on('touchend', this.onBlur.bind(this));
    pixi.on('touchendoutside', this.onBlur.bind(this));

    pixi.data = { type:'Tile', x:this.x, y:this.y };

    return this;
  }
  getTop() {
    if (this.top) return this.top;

    const position = this.pixi.position;

    return this.top = new PIXI.Point(
      Math.floor(position.x + TILE_WIDTH/2),
      Math.floor(position.y),
    );
  }
  getLeft() {
    if (this.left) return this.left;

    const position = this.pixi.position;

    return this.left = new PIXI.Point(
      Math.floor(position.x),
      Math.floor(position.y + TILE_HEIGHT/2),
    );
  }
  getRight() {
    if (this.right) return this.right;

    const position = this.pixi.position;

    return this.right = new PIXI.Point(
      Math.floor(position.x + TILE_WIDTH),
      Math.floor(position.y + TILE_HEIGHT/2),
    );
  }
  getBottom() {
    if (this.bottom) return this.bottom;

    const position = this.pixi.position;

    return this.bottom = new PIXI.Point(
      Math.floor(position.x + TILE_WIDTH/2),
      Math.floor(position.y + TILE_HEIGHT),
    );
  }
  getCenter() {
    if (this.center) return this.center;

    const position = this.pixi.position;

    return this.center = new PIXI.Point(
      Math.floor(position.x + TILE_WIDTH/2),
      Math.floor(position.y + TILE_HEIGHT/2),
    );
  }
  dismiss() {
    // Emit before dismissing so that the unit is blurred successfully.
    this._emit({ type:'dismiss', target:this });
    this.assigned.assignment = null;
    this.assigned = null;

    return this;
  }
  assign(unit) {
    unit.assignment = this;
    this.assigned = unit;
    this._emit({ type:'assign', target:this });

    return this;
  }
  set_interactive(interactive) {
    if ((this.pixi.cursor === 'pointer') === interactive)
      return;

    // A focused tile should be blurred before becoming interactive.
    if (this.focused && !interactive)
      this._emit({ type:'blur', target:this });

    this.pixi.cursor = interactive ? 'pointer' : null;

    // A focused tile should be focused after becoming interactive.
    if (this.focused && interactive)
      this._emit({ type:'focus', target:this });
  }
  is_interactive() {
    return this.pixi.cursor === 'pointer';
  }
  setAlpha(alpha) {
    this.pixi.alpha = alpha;
  }
  paint(name, alpha, color = 0xFFFFFF) {
    this.painted    = name;
    this.pixi.tint  = color;
    this.pixi.alpha = alpha;

    return this;
  }
  strip() {
    this.painted    = null;
    this.pixi.tint  = 0xFFFFFF;
    this.pixi.alpha = 0;
  }
  onSelect(event) {
    if (this.pixi.cursor === 'pointer') {
      // Prevent the board object from receiving this event.
      event.stopPropagation();

      const pointerEvent = event.data.originalEvent;

      this._emit({
        type: pointerEvent.pointerType === 'mouse' && pointerEvent.button === 2
          ? 'altSelect' : 'select',
        target: this,
        pixiEvent: event,
        pointerEvent,
      });
    }
  }
  onDragStart(event) {
    if (!this.assigned || !this.assigned.draggable) return;

    this._emit({
      type: 'dragStart',
      target: this,
      targetUnit: this.assigned,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  onDragDrop(event) {
    if (!this.isDragging && !this.isDropTarget) return;

    this._emit({
      type: 'dragDrop',
      target: this,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  /*
   * If the mouse releases anywhere other than origin tile, this will be fired.
   * But, we should ignore cases where the mouse was released on a valid drop target.
   * This is accomplished by ignoring cases where the tile is no longer being dragged.
   * A call to onDragDrop happens first and the Board object will clear the flag.
   */
  onDragCancel(event, target = null) {
    if (!this.isDragging) return;

    this._emit({
      type: 'dragDrop',
      target: null,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  onFocus(event) {
    if (this.focused) return;

    this.focused = true;

    this._emit({
      type: 'focus',
      target: this,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  onBlur(event) {
    if (!this.focused) return;

    // Chrome has been observed posting "pointerleave" events after a "click".
    // That is not the desired behavior, so this heuristic ignores them.
    if (event) {
      event = event.data.originalEvent;
      if (event.type === 'pointerleave' && event.relatedTarget === null)
        return;
    }

    this.focused = false;

    this._emit({
      type: 'blur',
      target: this,
    });
  }

  toJSON() {
    return [this.x, this.y];
  }
};

emitter(Tile);
