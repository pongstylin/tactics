'use strict';
/*
  Philosophy:
    A tile should have no awareness of the overall board.
*/

import EventEmitter from 'events';

const points = [
  42,0,  // top-left
  45,0,  // top-right
  86,27, // right-top
  86,28, // right-bottom
  45,55, // bottom-right
  42,55, // bottom-left
  1 ,28, // left-bottom
  1 ,27, // left-top
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
    pixi.mousemove      = this.onDragMove.bind(this);
    pixi.mouseup        = this.onDragEnd.bind(this);
    pixi.mouseupoutside = this.onDragEnd.bind(this);

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
    // Warning, this is only accurate if called after pixi transform is updated.
    var bounds;

    if (this.top) return this.top;

    bounds = this.pixi.getBounds();
    return this.top = new PIXI.Point(
      Math.floor(bounds.x + bounds.width/2),
      Math.floor(bounds.y),
    );
  }
  getLeft() {
    // Warning, this is only accurate if called after pixi transform is updated.
    var bounds;

    if (this.left) return this.left;

    bounds = this.pixi.getBounds();
    return this.left = new PIXI.Point(
      Math.floor(bounds.x),
      Math.floor(bounds.y + bounds.height/2),
    );
  }
  getBottom() {
    // Warning, this is only accurate if called after pixi transform is updated.
    var bounds;

    if (this.bottom) return this.bottom;

    bounds = this.pixi.getBounds();
    return this.bottom = new PIXI.Point(
      Math.floor(bounds.x + bounds.width/2),
      Math.floor(bounds.y + bounds.width),
    );
  }
  getCenter() {
    // Warning, this is only accurate if called after pixi transform is updated.
    var bounds;

    if (this.center) return this.center;

    bounds = this.pixi.getBounds();
    return this.center = new PIXI.Point(
      Math.floor(bounds.x + bounds.width/2),
      Math.floor(bounds.y + bounds.height/2),
    );
  }
  dismiss() {
    this.assigned = null;
    this._emit({ type:'dismiss', target:this });

    return this;
  }
  assign(unit) {
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
    // Prevent the board object from receiving this event.
    event.stopPropagation();

    if (!this.assigned) return;
    if (!this.assigned.draggable) return;

    this._emit({
      type: 'dragStart',
      target: this,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  onDragMove(event) {
    // Prevent the board object from receiving this event.
    event.stopPropagation();

    this._emit({
      type: 'dragMove',
      target: this,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
  }
  onDragEnd(event) {
    // Prevent the board object from receiving this event.
    // Actually, don't do this since it prevents 'tap' from firing.
    //event.stopPropagation();

    this._emit({
      type: 'dragEnd',
      target: this,
      pixiEvent: event,
      pointerEvent: event.data.originalEvent,
    });
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
      type:   'focus',
      target: this,
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
