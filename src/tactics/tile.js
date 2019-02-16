/*
  Philosophy:
    A tile should have no awareness of the overall board.
*/
(function () {
  'use strict';

  var points = [
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

  Tactics.Tile = function (x, y) {
    var self = this;

    utils.addEvents.call(self);

    $.extend(self, {
      id: x+'x'+y,
      x: x,
      y: y,

      // Public properties
      pixi:     undefined,
      assigned: null,
      focused:  false,
      painted:  null,

      // Public methods
      draw: function () {
        var pixi = self.pixi = new PIXI.Graphics();

        pixi.alpha = 0;
        pixi.lineStyle(1,0xFFFFFF,1);
        pixi.beginFill(0xFFFFFF,1);

        // Clone the points array, cause it gets messed up otherwise.
        pixi.drawPolygon(points.slice());
        pixi.hitArea = new PIXI.Polygon(points.slice());

        pixi.interactive = true;
        pixi.pointertap  = self.onSelect;
        pixi.pointerover = self.onFocus;
        pixi.pointerout  = self.onBlur;

        // PIXI does not emit 'pointerover' or 'pointerout' events for touch pointers.
        // Use 'touchmove' to simulate focus events.
        // Use 'touchend' to simulate blur events.
        // The board object will handle blurring as the touch pointer moves.
        pixi.touchmove       = self.onFocus;
        pixi.touchend        = self.onBlur;
        pixi.touchendoutside = self.onBlur;

        return self;
      },
      getTop: function () {
        // Warning, this is only accurate if called after pixi transform is updated.
        var bounds;

        if (self.top) return self.top;

        bounds = self.pixi.getBounds();
        return self.top = new PIXI.Point(
          Math.floor(bounds.x+bounds.width/2),
          Math.floor(bounds.y)
        );
      },
      getCenter: function ()
      {
        // Warning, this is only accurate if called after pixi transform is updated.
        var bounds;

        if (self.center) return self.center;

        bounds = self.pixi.getBounds();
        return self.center = new PIXI.Point(
          Math.floor(bounds.x+bounds.width/2),
          Math.floor(bounds.y+bounds.height/2)
        );
      },
      dismiss: function () {
        self.assigned = null;
        self.set_interactive(false);

        return self;
      },
      assign: function (unit) {
        self.assigned = unit;
        self.set_interactive(true);

        return self;
      },
      set_interactive: function (bool) {
        self.pixi.buttonMode = bool;
      },
      setAlpha: function (alpha) {
        self.pixi.alpha = alpha;
      },
      paint: function (name, alpha, color) {
        self.painted    = name;
        self.pixi.tint  = color || 0xFFFFFF;
        self.pixi.alpha = alpha;
      },
      strip: function () {
        self.painted    = null;
        self.pixi.tint  = 0xFFFFFF;
        self.pixi.alpha = 0;
      },
      onSelect: function (event) {
        if (self.pixi.buttonMode) {
          // Prevent the board object from receiving this event.
          event.stopPropagation();

          self.emit({type: 'select', target: self});
          Tactics.render();
        }
      },
      onFocus: function (event) {
        if (self.focused) return;
        let pointerType = event.data.pointerType;

        self.focused = pointerType;

        self.emit({
          type:        'focus',
          target:      self,
          pointerType: pointerType,
          pixiEvent:   event,
        });
        Tactics.render();
      },
      onBlur: function (event) {
        if (!self.focused) return;
        let pointerType = event.data.pointerType;

        // Chrome has been observed posting "pointerleave" events after a "click".
        // That is not the desired behavior, so this heuristic ignores them.
        event = event.data.originalEvent;
        if (event.type === 'pointerleave' && event.relatedTarget === null)
          return;

        self.focused = false;

        self.emit({
          type:        'blur',
          target:      self,
          pointerType: pointerType,
          pixiEvent:   event,
        });

        Tactics.render();
      },

      toJSON: function () {
        return [self.x, self.y];
      },
    });

    return self;
  };
})();
