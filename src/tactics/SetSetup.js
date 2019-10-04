import EventEmitter from 'events';

import Board, {
  HALF_TILE_WIDTH,
  TILE_HEIGHT,
  TILE_FOCUS_COLOR,
} from 'tactics/Board.js';

export default class {
  constructor(team, gameTypeConfig) {
    let renderer = PIXI.autoDetectRenderer(Tactics.width, Tactics.height, { transparent:true });

    // Let's not go crazy with the move events.
    renderer.plugins.interaction.moveWhenInside = true;

    let board = new Board();
    board.rotation = 'S';

    board
      .on('focus', ({ tile, unit }) => {
        board.focused = unit;

        if (unit.team.name === 'Set')
          tile.paint('focus', 0.3, TILE_FOCUS_COLOR);
        else
          this._updateFocus();

        this.render();
      })
      .on('blur', ({ tile, unit }) => {
        if (board.focused === unit)
          board.focused = null;

        if (unit.team.name === 'Set')
          tile.strip();
        else
          this._updateFocus();

        this.render();
      })
      .on('select', event => {
        console.log(event);
      })
      .on('deselect', event => {
        console.log(event);
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
      _stage: new PIXI.Container(),
      _animators: {},

      _board: board,

      _emitter: new EventEmitter(),
    });

    board.draw(this._stage);

    let unitTypes = [...gameTypeConfig.limits.units.types.keys()].reverse();
    let positions = this._getPositions();
    this._picksTeam.set = unitTypes.map((ut, i) => ({ type:ut, assignment:positions[i] }));

    let units = team.set.map(unitData => ({ ...unitData, direction:'S' }));
    let picksTeamUnits = this._picksTeam.set.map(unitData => ({
      ...unitData, direction:'N'
    }));
    board.setState([units, picksTeamUnits], [this._team, this._picksTeam]);

    this._updateFocus();

    let leftPoint = board.getTile(0, 6).getLeft();
    let rightPoint = board.getTile(10, 6).getTop();
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
  }

  /*****************************************************************************
   * Public Properties
   ****************************************************************************/
  get canvas() {
    return this._canvas;
  }

  get stage() {
    return this._stage;
  }
  get board() {
    return this._board;
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
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
  _getPositions() {
    let cols = [5, 3, 7, 1, 9];
    let rows = [6, 8, 10, 7, 9];
    let positions = [];

    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < cols.length; x++) {
        if (!this._board.getTile(cols[x], rows[y])) continue;

        positions.push([ cols[x], rows[y] ]);
      }
    }

    return positions;
  }
  _updateFocus() {
    let counts = new Map();
    this._team.units.forEach(unit => {
      if (counts.has(unit.type))
        counts.set(unit.type, counts.get(unit.type) + 1);
      else
        counts.set(unit.type, 1);
    });

    let board = this._board;
    let gameTypeConfig = this.gameTypeConfig;
    this._picksTeam.units.forEach(unit => {
      let count = counts.get(unit.type) || 0;
      let max = gameTypeConfig.limits.units.types.get(unit.type).max;

      if (board.focused === unit)
        unit.showFocus(0.8, 0xFFFFFF);
      else if (count < max)
        unit.showFocus(0.8, 0x00FF00);
      else
        unit.showFocus(0.8);
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
