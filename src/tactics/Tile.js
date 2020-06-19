/*
  Philosophy:
    A tile should have no awareness of the overall board.
*/

import EventEmitter from 'events';

export const TILE_WIDTH        = 88;
export const TILE_HEIGHT       = 56;
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

export default class {
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

      _emitter: new EventEmitter(),
    });
  }

  // Public methods
  draw() {
    let pixi = this.pixi = new PIXI.Graphics();
    pixi.position = new PIXI.Point(...this.position);

    pixi.alpha = 0;
    pixi.lineStyle(1,0xFFFFFF,1);
    pixi.beginFill(0xFFFFFF,1);

    // Clone the points array, cause it gets messed up otherwise.
    pixi.drawPolygon(points.slice());
    pixi.hitArea = new PIXI.Polygon(points.slice());

    pixi.interactive = true;
    pixi.buttonMode  = false;
    pixi.pointertap  = this.onSelect.bind(this);
    pixi.pointerover = this.onFocus.bind(this);
    pixi.pointerout  = this.onBlur.bind(this);

    // Drag events are only supported for mouse pointers
    pixi.mousedown      = this.onDragStart.bind(this);
    pixi.mouseup        = this.onDragDrop.bind(this);
    pixi.mouseupoutside = this.onDragCancel.bind(this);

    // PIXI does not emit 'pointerover' or 'pointerout' events for touch pointers.
    // Use 'touchmove' to simulate focus events.
    // Use 'touchend' to simulate blur events.
    // The board object will handle blurring as the touch pointer moves.
    pixi.touchmove       = this.onFocus.bind(this);
    pixi.touchend        = this.onBlur.bind(this);
    pixi.touchendoutside = this.onBlur.bind(this);

    pixi.data = { type:'Tile', x:this.x, y:this.y };

    return this;
  }
  getTop() {
    if (this.top) return this.top;

    let position = this.pixi.position;

    return this.top = new PIXI.Point(
      Math.floor(position.x + TILE_WIDTH/2),
      Math.floor(position.y),
    );
  }
  getLeft() {
    if (this.left) return this.left;

    let position = this.pixi.position;

    return this.left = new PIXI.Point(
      Math.floor(position.x),
      Math.floor(position.y + TILE_HEIGHT/2),
    );
  }
  getBottom() {
    if (this.bottom) return this.bottom;

    let position = this.pixi.position;

    return this.bottom = new PIXI.Point(
      Math.floor(position.x + TILE_WIDTH/2),
      Math.floor(position.y + TILE_HEIGHT),
    );
  }
  getCenter() {
    if (this.center) return this.center;

    let position = this.pixi.position;

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
    if (this.pixi.buttonMode === interactive)
      return;

    // A focused tile should be blurred before becoming interactive.
    if (this.focused && !interactive)
      this._emit({ type:'blur', target:this });

    this.pixi.buttonMode = interactive;

    // A focused tile should be focused after becoming interactive.
    if (this.focused && interactive)
      this._emit({ type:'focus', target:this });
  }
  is_interactive() {
    return this.pixi.buttonMode;
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
    if (this.pixi.buttonMode) {
      // Prevent the board object from receiving this event.
      event.stopPropagation();

      this._emit({
        type: 'select',
        target: this,
        pixiEvent: event,
        pointerEvent: event.data.originalEvent,
      });
    }
  }
  onDragStart(event) {
    if (!this.assigned || !this.assigned.draggable) return;
    this.isDragging = true;

    this._emit({
      type: 'dragStart',
      target: this,
      targetUnit: this.assigned,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  onDragDrop(event) {
    if (this.isDragging) return this.onDragCancel(event);
    if (!this.isDropTarget) return;

    this._emit({
      type: 'dragDrop',
      target: this,
      cancelled: false,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  /*
   * Dragging can be cancelled in two ways:
   *   1) Drag never left (or returned to) origin.
   *
   *   In this case, the drop target is the origin and it was triggered by a
   *   'mouseup' event.
   *
   *   2) Drag was dropped outside the origin.
   *
   *   In this case, the drop target is null and it was triggered by a
   *   'mouseupoutside' event.  This event is also delayed so that another tile
   *   might detect a drag drop event and be handled first.  This way, the
   *   cancellation event may be ignored since it wasn't truly cancelled.
   */
  onDragCancel(event) {
    if (!this.isDragging) return;
    this.isDragging = false;

    // Generate event data early since 'event' may change before timeout.
    let dragCancelEvent = {
      type: 'dragDrop',
      target: event.type === 'mouseup' ? this : null,
      cancelled: true,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    };

    if (dragCancelEvent.target)
      this._emit(dragCancelEvent);
    else
      setTimeout(() => this._emit(dragCancelEvent));
  }
  /*
   * All tiles are interactive at all times so that we can keep track of the
   * currently focused tile even if it isn't in buttonMode (yet).
   *
   * But events are only emitted when in buttonMode.
   */
  onFocus(event) {
    if (this.focused) return;

    this.focused = true;

    // Events are posted even if not interactive so that the board can track
    // the currently focused tile.
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

    // Events are posted even if not interactive so that the board can track
    // the currently focused tile.
    this._emit({
      type:   'blur',
      target: this,
    });
  }

  on(eventType, fn) {
    eventType.split(/ +/).forEach(et => this._emitter.addListener(et, fn));
    return this;
  }
  off(eventType, fn) {
    eventType.split(/ +/).forEach(et => this._emitter.removeListener(et, fn));
    return this;
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
