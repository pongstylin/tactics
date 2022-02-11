import { Renderer } from '@pixi/core';
import { Container } from '@pixi/display';
import emitter from 'utils/emitter.js';

import Cursor from 'tactics/GameStateCursor.js';
import PanZoom from 'utils/panzoom.js';
import sleep from 'utils/sleep.js';

import Board, {
  FOCUS_TILE_COLOR,
  MOVE_TILE_COLOR,
  ATTACK_TILE_COLOR,
} from 'tactics/Board.js';
import colorMap from 'tactics/colorMap.js';

export default class Game {
  /*
   * Arguments:
   *  state: An object supporting the GameState class interface.
   */
  constructor(state, playerId = null) {
    if (!state)
      throw new TypeError('Required game state');

    const renderer = new Renderer({
      width: Tactics.width,
      height: Tactics.height,
      backgroundAlpha: 0,
    });

    // Let's not go crazy with the move events.
    renderer.plugins.interaction.moveWhenInside = true;

    // Save battery life by updating manually.
    renderer.plugins.interaction.useSystemTicker = false;

    const board = new Board();
    board.initCard();
    board.draw();
    board
      .on('focus', ({ tile, unit }) => {
        Tactics.playSound('focus');

        if (!tile.action && !tile.painted)
          tile.paint('focus', 0.3, FOCUS_TILE_COLOR);

        this.focused = unit;
      })
      .on('blur', ({ tile }) => {
        if (tile.painted === 'focus')
          tile.strip();

        this.focused = null;
      })
      .on('select', event => {
        let unit = event.target.assigned;

        Tactics.playSound('select');
        if (this.canSelect(unit))
          this.selected = unit;
        else
          this.viewed = unit;
      })
      .on('deselect', () => {
        if (this.viewed)
          this.viewed = null;
        else if (this.selected) {
          if (
            this._inReplay ||
            this.state.actions.length ||
            this._selectMode === 'target'
          ) return;

          this.selected = null;
        }
      })
      // 'move' and 'attack' events do not yet come from the board.
      .on('move',    event => this._submitAction(event))
      .on('attack',  event => this._submitAction(event))
      .on('turn',    event => this._submitAction(event))
      .on('endTurn', event => this._submitAction(event))
      .on('card-change', event => this._emit(event))
      .on('lock-change', event => this._emit(event));

    /*
     * Disable tile selection while pinching is in progress
     */
    const panzoom = PanZoom({ target:renderer.view })
      .on('start', () => {
        board.tilesContainer.interactive = false;
        board.tilesContainer.interactiveChildren = false;
      })
      .on('stop', () => {
        // Delay interactivity to prevent tap events triggered by release.
        setTimeout(() => {
          board.tilesContainer.interactive = true;
          board.tilesContainer.interactiveChildren = true;
        }, 100);
      });

    const whilePlaying = Promise.resolve();
    whilePlaying.state = 'stopped';

    Object.assign(this, {
      // Crude tracking of the pointer type being used.  Ideally, this should
      // reflect the last pointer type to fire an event on the board.
      pointerType: 'ontouchstart' in window ? 'touch' : 'mouse',

      playerId,
      state,

      _onStateEventListener: this._onStateEvent.bind(this),
      _onCursorChangeListener: () => this._emit({ type:'cursor-change' }),

      _teams: [],
      _turnTimeout: null,
      _speed: 'auto',

      // The currently displayed turn and action
      cursor: null,

      // Set to true when the user activates replay mode by pausing the game.
      // Set to false when the user resumes normal game play.
      _inReplay: false,

      // Set to true while keeping up with current game state
      // Set to false while gameplay is paused
      _isSynced: false,

      // Actions are actively being played until this promise resolves
      _whilePlaying: whilePlaying,

      _renderer: renderer,
      _rendering: false,
      _canvas: renderer.view,
      _stage: new Container(),
      _animators: {},

      _selectMode: 'move',
      _tranformToRestore: null,

      _notice: null,
      _board: board,

      _panzoom: panzoom,
    });

    this._stage.addChild(board.pixi);

    Tactics.game = this;
  }

  /*****************************************************************************
   * Public Properties
   ****************************************************************************/
  get whenStarted() {
    return this.state.whenStarted;
  }
  get turnTimeLimit() {
    return this.state.getTurnTimeLimit();
  }
  get turnTimeRemaining() {
    return this.state.getTurnTimeRemaining();
  }
  set speed(speed) {
    if (typeof speed === 'number')
      this._speed = speed;
    else
      this._speed = 'auto';
  }
  get speed() {
    if (this._speed === 'auto')
      return this.state.turnTimeLimit === 30 ? 2 : 1;
    else
      return this._speed;
  }
  get isSynced() {
    return this._isSynced;
  }
  get inReplay() {
    return this._inReplay;
  }

  get renderer() {
    return this._renderer;
  }
  get card() {
    return this._board.card;
  }
  get canvas() {
    return this._canvas;
  }

  get board() {
    return this._board;
  }
  get panzoom() {
    return this._panzoom;
  }

  get focused() {
    return this._board.focused;
  }
  set focused(focused) {
    let board       = this._board;
    let old_focused = board.focused;

    if (focused !== old_focused) {
      if (old_focused)
        old_focused.blur();

      if (focused) {
        let viewOnly = !this.canSelect(focused);
        board.focused = focused.focus(viewOnly);
      }
      else
        board.focused = null;

      this.drawCard();
      this.render();
    }

    return this;
  }

  get selected() {
    return this._board.selected;
  }
  set selected(selected) {
    let board        = this._board;
    let old_selected = board.selected;
    let old_viewed   = board.viewed;

    if (selected !== old_selected) {
      if (old_viewed) {
        board.hideMode();
        old_viewed.deactivate();
        board.viewed = null;
      }

      if (old_selected) {
        board.clearMode();
        old_selected.deactivate();
        board.selected = null;

        if (old_selected.assignment.focused) {
          this.focused = null;
          this.focused = old_selected;
        }
      }

      if (selected) {
        board.selected = selected;
        // Draw the card BEFORE selecting the mode to allow board.showTargets()
        // to override the focused unit with the targeted unit.
        this.drawCard();

        if (this._inReplay || !this.isMyTurn) {
          selected.activate();
          this._showActions(!this._isSynced);
        }
        else
          this.selectMode = this._pickSelectMode();
      }
      else {
        this.drawCard();
        this.selectMode = 'move';
      }
    }
    else if (old_viewed) {
      board.hideMode();
      old_viewed.deactivate();
      board.viewed = null;

      if (selected)
        this.selectMode = selected.activated;
      else
        this.selectMode = 'move';

      this.drawCard();
    }

    return this;
  }

  get viewed() {
    return this._board.viewed;
  }
  set viewed(viewed) {
    let board      = this._board;
    let old_viewed = board.viewed;

    if (viewed !== old_viewed) {
      let selected = board.selected;

      if (old_viewed) {
        board.hideMode();
        if (old_viewed === selected)
          // The unit can only be selected AND viewed if it is selected by an
          // opposing team and viewed by you.  So, by unviewing it, it needs to
          // be restored to an 'activated = true' state.
          selected.activated = true;
        else
          old_viewed.deactivate();
        board.viewed = null;
      }

      if (viewed) {
        board.viewed = viewed;
        this.selectMode = this._pickSelectMode();
      }
      else if (selected) {
        if (this._inReplay || !this.isMyTurn) {
          this._showActions(true);
          this.selectMode = 'move';
        }
        else if (selected.activated && selected.activated !== true)
          this.selectMode = selected.activated;
      }
      else
        this.selectMode = 'move';

      this.drawCard();
    }

    return this;
  }

  get selectMode() {
    return this._selectMode;
  }
  set selectMode(selectMode) {
    /*
     * Note: No attempt is made to see if the provided selectMode is the same as
     * the current selectMode.  Certain actions need to be taken when a select
     * mode is assigned, even if it is the same.
     */

    /*
     * Reset temporary zoom, if one was made.
     */
    let transformToRestore = this.transformToRestore;
    if (transformToRestore) {
      this._panzoom.transitionToTransform(transformToRestore);
      this.transformToRestore = null;
    }

    let board    = this._board;
    let viewed   = board.viewed;
    let selected = board.selected;

    if (viewed) {
      board.hideMode();
      viewed.activate(selectMode, true);
    }
    else if (selected && this.isMyTurn && !this._inReplay) {
      if (selectMode === 'target')
        // Clear highlight, but not target tile
        board.hideMode();
      else
        // Clear highlight and target tile
        board.clearMode();

      selected.activate(selectMode);
    }

    if (viewed || (this.isMyTurn && !this._inReplay))
      board.showMode();

    this.render();

    this._emit({
      type:   'selectMode-change',
      ovalue: this._selectMode,
      nvalue: selectMode,
    });

    this._selectMode = selectMode;

    return this;
  }

  get notice() {
    return this._notice;
  }
  set notice(notice) {
    clearTimeout(this._noticeTimeout);
    if (notice === this._notice) return;

    this._notice = notice;
    this.drawCard();

    return this._notice;
  }

  get teams() {
    return this._teams.length ? this._teams : this.state.teams;
  }
  get activeTeams() {
    return this._teams.filter(team => !!team.units.length);
  }
  get winningTeams() {
    return this.teams.filter(team =>
      !!team.units.find(unit => {
        // Wards don't count.
        if (unit.type === 'BarrierWard' || unit.type === 'LightningWard')
          return false;

        // Paralyzed units don't count.
        if (unit.paralyzed)
          return false;

        return true;
      })
    );
  }
  /*
   * Find first team in play order starting with current team that is my team.
   */
  get myTeam() {
    const currentTeamId = this.state.currentTeamId;
    let teams = this.teams;
    teams = teams
      .slice(this.state.currentTeamId)
      .concat(teams.slice(0, this.state.currentTeamId));

    return teams.find(t => this.isMyTeam(t));
  }
  get currentTeam() {
    return this._teams[this.state.currentTeamId];
  }
  get isBotGame() {
    return !!this.state.teams.find(t => !!t.bot);
  }
  get isLocalGame() {
    const myTeams = this.state.teams.filter(t => this.isMyTeam(t));

    return myTeams.length === this.state.teams.length;
  }
  get isViewOnly() {
    const myTeams = this.state.teams.filter(t => this.isMyTeam(t));

    return myTeams.length === 0;
  }
  get isMyTurn() {
    return !this.state.endedAt && this.isMyTeam(this.currentTeam);
  }
  get isFork() {
    return !!this.state.forkOf;
  }
  get ofPracticeGame() {
    if (!this.state.forkOf) return false;

    const playerIds = new Set(this.state.teams.map(t => t.forkOf.playerId));

    return playerIds.size === 1;
  }

  get turnId() {
    return this.cursor.turnId;
  }
  get nextActionId() {
    return this.cursor.nextActionId;
  }
  get units() {
    return this.cursor.units;
  }
  get actions() {
    return this._board.decodeAction(
      this.cursor.actions.slice(0, this.cursor.nextActionId),
    );
  }

  get moved() {
    return !!this.state.actions
      .find(a => a.type === 'move');
  }
  get attacked() {
    return !!this.state.actions
      .find(a => a.type === 'attack' || a.type === 'attackSpecial');
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  isMyTeam(team) {
    if (team === undefined)
      throw new TypeError('Required team argument');

    if (typeof team === 'number')
      team = this.teams[team];

    if (this.playerId)
      return team.playerId === this.playerId;
    else
      return !team.bot;
  }
  hasOneLocalTeam(team) {
    if (team !== undefined && !this.isMyTeam(team)) return false;

    return this.teams.filter(t => this.isMyTeam(t)).length === 1;
  }
  /*
   * Determine team's first playable turn and whether that turn has been made.
   */
  teamHasPlayed(team) {
    if (
      this.state.winnerId === 'truce' ||
      this.state.winnerId === 'draw' ||
      this.state.winnerId === team.id
    ) return true;

    const firstTurnId = this.state.getTeamFirstTurnId(team);

    if (this.state.currentTurnId < firstTurnId)
      return false;
    // Might not be completely accurate for ended games where this team lost.
    if (this.state.currentTurnId > firstTurnId)
      return true;

    return !!this.actions.find(a => a.type !== 'surrender' && !a.forced);
  }

  /*
   * Used to start playing the game... even if it is from the middle of it.
   */
  async start() {
    const state = this.state;
    const board = this._board;

    this.lock();

    await state.whenStarted;

    // Clone teams since board.setState() applies a units property to each.
    const teams = this._teams = state.teams.map(team => ({...team}));

    // Rotate the board such that my first local team is south/red.
    const myTeams = this.teams.filter(t => this.isMyTeam(t));
    let myTeam;
    if (myTeams.length === 1)
      myTeam = myTeams[0];
    else if (myTeams.length > 1) {
      if (state.forkOf) {
        const myOldTeams = myTeams.filter(t => t.forkOf.playerId === this.playerId);
        if (myOldTeams.length === 0)
          myTeam = myTeams.sort((a,b) => a.slot - b.slot)[0];
        else if (myOldTeams.length === 1)
          myTeam = myOldTeams[0];
        else
          myTeam = myOldTeams.sort((a,b) => a.slot - b.slot)[0];
      } else
        myTeam = myTeams.sort((a,b) => a.slot - b.slot)[0];
    }

    let degree = 0;
    if (myTeam) {
      degree = board.getDegree(myTeam.position, 'S');
      board.rotate(degree);
    }

    /*
     * Apply team colors based on the team's (rotated?) position.
     */
    const colorIds = new Map([
      ['N', 'Blue'  ],
      ['E', 'Yellow'],
      ['S', 'Red'   ],
      ['W', 'Green' ],
      ['C', 'White' ], // Chaos starts in a center position
    ]);

    teams.forEach(team => {
      const position = board.getRotation(team.position, degree);

      team.colorId = colorIds.get(position);
    });

    // Wait until the game and first turn starts, if it hasn't already started.
    await state.whenTurnStarted;

    this.cursor = new Cursor(state),
    this.cursor.on('change', this._onCursorChangeListener);

    this._setTurnTimeout();
    this._emit({ type:'state-change' });

    const playerRequest = state.playerRequest;
    if (playerRequest?.status === 'pending')
      this._emit({ type:`playerRequest`, data:playerRequest });

    state.on('*', this._onStateEventListener);
  }
  /*
   * This is used when surrendering serverless games.
   */
  restart() {
    this.lock();

    let state = this.state;

    this.cursor.off('change', this._onCursorChangeListener);
    this.cursor = null;

    state.off('*', this._onStateEventListener);

    this._board.rotation = 'N';
    this.notice = null;

    // Inform game state to restart.
    state.restart();

    return this.start();
  }

  setState() {
    let board = this._board;
    board.setState(this.units, this._teams);

    let actions = this.actions;
    actions.forEach(action => this._applyAction(action));

    this.selectMode = 'move';

    if (actions.length) {
      this.selected = actions[0].unit;
    }
    else if (this._inReplay && this.cursor.actions.length) {
      actions = board.decodeAction(this.cursor.actions);
      this.selected = actions[0].unit;
    }
    else
      this.render();
  }

  async resume() {
    if (this._whilePlaying.state !== 'stopped') {
      this._whilePlaying.state = 'interrupt';
      await this._whilePlaying;
    }

    this._inReplay = false;
    this._emit({ type:'endReplay' });

    if (this.state.endedAt) {
      this.cursor.setToCurrent();
      this.setState();
      this.notice = null;
      this._endGame(true);

      // This triggers the removal of location.hash
      this._isSynced = true;
      this._emit({ type:'startSync' });
    }
    else {
      const turnId = this.isMyTurn && !this.isLocalGame ? -this._teams.length : -1;

      this.play(turnId, 0, 'back');
    }
  }
  async play(turnId, actionId, skipPassedTurns = false) {
    const cursor = this.cursor;

    if (turnId === undefined && actionId === undefined) {
      if (this._whilePlaying.state !== 'stopped')
        return;
      if (this._isSynced && cursor.atCurrent)
        return;
    }

    this._whilePlaying.state = 'playing';
    await this._whilePlaying;

    let stopPlaying;
    const whilePlaying = this._whilePlaying = new Promise(resolve => {
      stopPlaying = () => {
        whilePlaying.state = 'stopped';
        this.lock('readonly');
        resolve();
      };
    });
    const board = this._board;

    // Clear a 'Sending order' notice, if present
    // Or, clear 'Your Turn' notice so that it may be redisplayed after.
    this.notice = null;

    this.viewed = null;

    this.lock();
    if (!this._isSynced) {
      this._isSynced = true;
      this._emit({ type:'startSync' });
    }

    if (turnId !== undefined || actionId !== undefined) {
      await cursor.set(turnId, actionId, skipPassedTurns);
      this.setState();

      // Give the board a chance to appear before playing
      await sleep(100);

      if (whilePlaying.state === 'interrupt')
        return stopPlaying();
    }

    while (!cursor.atCurrent) {
      const movement = await cursor.setNextAction();
      if (!movement) break;

      if (movement === 'back')
        // The undo button can cause the next action to be a previous one
        this.setState();
      else if (movement === 'forward')
        await this._performAction(cursor.thisAction);

      if (whilePlaying.state === 'interrupt')
        return stopPlaying();
    }

    stopPlaying();

    // The game might have ended while playing
    const state = this.state;
    if (state.endedAt) {
      if (this._inReplay)
        await this.pause();

      this._endGame();
    } else if (!this._inReplay)
      if (!cursor.actions.length)
        this._startTurn();
      else if (cursor.actions.last.type !== 'endTurn')
        this._resumeTurn();
  }
  async pause(showActions = false) {
    if (this._whilePlaying.state !== 'stopped') {
      this._whilePlaying.state = 'interrupt';
      await this._whilePlaying;
    }

    this.notice = null;
    this.lock(this.state.endedAt ? 'gameover' : 'readonly');

    if (showActions && !this.actions.length)
      this._showActions(true);

    if (!this._inReplay) {
      this._inReplay = true;
      this._emit({ type:'startReplay' });
    }

    if (this._isSynced) {
      this._isSynced = false;
      this._emit({ type:'endSync' });
    }
  }
  async showTurn(turnId = this.turnId, actionId = 0, skipPassedTurns) {
    await this.pause();
    await this.cursor.set(turnId, actionId, skipPassedTurns);
    this.setState();

    if (this.cursor.atEnd)
      this._endGame(true);
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
        // Use height instead of 100% width to avoid Edge bug.
        canvas.style.height = Math.floor(Tactics.height * width_ratio)+'px';
      else
        canvas.style.height = height+'px';

    let panzoom = this._panzoom;
    panzoom.maxScale = 1 / elementScale;
    panzoom.reset();

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
  render(skipRequest = false) {
    if (this._rendering) return;
    this._rendering = true;

    if (skipRequest)
      this._render();
    else
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
        if (count === 0) {
          start = now;
          setTimeout(() => requestAnimationFrame(loop), throttle);
        }
        else {
          delay = (now - start) - (count * throttle);

          if (delay > throttle) {
            skip = Math.floor(delay / throttle);
            count += skip;

            delay = (now - start) - (count * throttle);
          }

          setTimeout(() => requestAnimationFrame(loop), throttle - delay);
        }

        // Iterate backward since elements may be removed.
        for (i = animators.length-1; i > -1; i--) {
          if (animators[i](skip) === false)
            animators.splice(i, 1);
        }

        // This loop was called by requestAnimationFrame.  Don't call rAF again
        // when rendering by passing true.
        this.render(true);

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
  stopAllAnim() {
    for (let [fps, animators] of Object.entries(this._animators)) {
      animators.length = 0;
    }
  }

  /*
   * Can a unit be selected?  If not, then it can only be viewed.
   */
  canSelect(unit) {
    let selected = this.selected;
    if (selected && selected !== unit && this.state.actions.length)
      return false;

    return !this.isViewOnly
      && !this._board.locked
      && unit.team === this.currentTeam
      && this.isMyTeam(unit.team)
      && !unit.mRecovery
      && !unit.paralyzed;
  }

  /*
   * Can a select mode be selected for the currently viewed or selected unit?
   */
  canSelectMove() {
    let viewed = this.viewed;
    if (viewed)
      return !!viewed.getMoveTiles().length;

    let selected = this.selected;
    if (selected) {
      if (this.moved && this.isMyTeam(selected.team))
        return false;

      return !!selected.getMoveTiles().length;
    }

    return true;
  }
  canSelectAttack() {
    /*
     * You may view attack tiles, assuming there are any.
     */
    let viewed = this.viewed;
    if (viewed)
      return !!viewed.getAttackTiles().length;

    let selected = this.selected;
    if (selected) {
      /*
       * Selected units must be able to attack and not have already attacked.
       */
      if (this.attacked && this.isMyTeam(selected.team))
        return false;

      /*
       * If the selected unit was poisoned at turn start, can't attack.
       */
      let unitState = this.units[selected.team.id].find(u => u.id === selected.id);
      if (unitState.poisoned)
        return false;

      return !!selected.getAttackTiles().length;
    }

    return true;
  }
  canSelectSpecial() {
    let selected = this.selected;
    if (selected && this.isMyTeam(selected.team))
      return selected.canSpecial();

    return false;
  }
  canSelectTurn() {
    let viewed = this.viewed;
    if (viewed)
      return true;

    let selected = this.selected;
    if (selected)
      return selected.directional !== false;

    return true;
  }

  /*
   * Animate the unit getting ready to launch their special attack.
   * Returns a promise decorated with a couple of useful methods.
   */
  readySpecial() {
    let selected = this.selected;
    let anim = selected.animReadySpecial();
    let promise = anim.play();

    // If you release too early, the attack is cancelled.
    // If you release after ~2 secs then the attack is launched. 
    promise.release = () => {
      anim.stop();

      // Make sure the previously selected unit is still selected.
      // It won't be if the opponent reverted before release.
      if (anim.state.ready && this.selected === selected) {
        this._submitAction({type:'attackSpecial'});

        // Set this to false to prevent releasing twice.
        anim.state.ready = false;
      }
    };

    // For the sake of all that's holy, don't attack even if ready!
    promise.cancel = () => {
      anim.stop();
      anim.state.ready = false;
    };

    return promise;
  }

  pass() {
    this._submitAction({ type:'endTurn' });
  }
  surrender() {
    this._submitAction({ type:'surrender' });
  }
  forceSurrender() {
    let currentTeam = this.currentTeam;
    if (this.isMyTeam(currentTeam))
      return;

    this._submitAction({ type:'surrender', teamId:currentTeam.id });
  }

  /*
   * Determine if player's team may request an undo.
   * Even if you can undo, the request may be rejected.
   *
   * If a number is returned then you may undo for X ms.
   */
  canUndo() {
    if (this.isViewOnly)
      return false;

    // Determine the team that is requesting the undo.
    const teams = this.teams;
    let myTeam = this.currentTeam;
    while (!this.isMyTeam(myTeam)) {
      const prevTeamId = (myTeam.id === 0 ? teams.length : myTeam.id) - 1;
      myTeam = teams[prevTeamId];
    }

    return this.state.canUndo(myTeam);
  }
  undo() {
    return this.state.undo();
  }
  canTruce() {
    const playerRequest = this.state.playerRequest;
    if (playerRequest?.rejected.has(`${this.playerId}:truce`))
      return false;

    return true;
  }
  truce() {
    this.state.truce();
  }
  acceptPlayerRequest() {
    this.state.acceptPlayerRequest();
  }
  rejectPlayerRequest() {
    this.state.rejectPlayerRequest();
  }
  cancelPlayerRequest() {
    this.state.cancelPlayerRequest();
  }

  rotateBoard(rotation) {
    const board = this._board;

    board.rotate(rotation);

    if (board.selected) {
      if (this._inReplay)
        this._showActions(true);
      else if (!this.isMyTurn)
        this._showActions();
    }

    this.render();
  }

  zoomToTurnOptions() {
    const selected = this.selected;
    if (!selected) return;

    const panzoom = this._panzoom;

    this.transformToRestore = panzoom.transform;

    // Get the absolute position of the turn options.
    const point = selected.assignment.getTop().clone();
    point.y -= 14;

    // Convert coordinates to percentages.
    point.x = point.x / Tactics.width;
    point.y = point.y / Tactics.height;

    panzoom.transitionPointToCenter(point, panzoom.maxScale);

    return this;
  }

  delayNotice(notice) {
    const delay = 200;

    this.notice = null;
    this._noticeTimeout = setTimeout(() => {
      this.notice = notice;
    }, delay);
  }

  drawCard(unit, notice) {
    this._board.drawCard(unit, notice || this._notice);
    return this;
  }
  lock(lockMode) {
    this._board.lock(lockMode);
    return this;
  }
  unlock() {
    this._board.unlock();
    return this;
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  /*
   * Initiate an action, whether it be moving, attacking, turning, or passing.
   */
  _submitAction(action) {
    if (!action.unit && action.type !== 'endTurn' && action.type !== 'surrender')
      action.unit = this.selected;

    const board = this._board;
    const selected = this.selected;

    if (selected) {
      board.clearMode();
      selected.deactivate();
    }

    const locked = this.locked;

    this.notice = null;
    this.delayNotice('Sending order...');

    this.lock();
    return this.state.submitAction(this._board.encodeAction(action))
      .then(() => {
        if (this._inReplay) {
          // Prevent or clear the 'Sending order' notice
          this.notice = null;
          this.lock(this.state.endedAt ? 'gameover' : 'readonly');
        }
      })
      .catch(error => {
        // Re-select the unit if still selected.  It won't be if a revert has
        // already taken place.
        if (board.selected === selected)
          this._resumeTurn();
        else
          this.lock('readonly');

        if (error.code === 409) {
          // This can happen if the opponent surrendered or hit 'undo' right
          // before submitting this action.  The unit is reselected and board is
          // unlocked just in case it is an undo request that will be rejected.
          this.notice = null;
        } else {
          this.notice = 'Server Error!';
          throw error;
        }
      });
  }
  async _performAction(action) {
    const board = this._board;
    let selected = this.selected;
    const actionType = action.type;

    action = board.decodeAction(action);

    if (actionType === 'endTurn') {
      const doShowDirection = (
        selected &&
        selected.directional !== false &&
        (!this.isMyTeam(action.teamId) || this._inReplay) &&
        (this.state.turnTimeLimit > 30 || this._inReplay)
      );
      if (doShowDirection) {
        // Show the direction the unit turned for 2 seconds.
        board.showDirection(selected);
        await sleep(2000);
      }

      return this._playEndTurn(action);
    } else if (actionType === 'surrender')
      return this._playSurrender(action);

    const actor = action.unit;
    const speed = this.speed;

    // Select the unit that is about to act.
    if (action.type === 'select') {
      board.selected = actor;
      actor.activate();
      this.drawCard();
      return;
    }

    const quick = (
      (!selected || selected === actor) &&
      this.isMyTeam(action.teamId) &&
      !this._inReplay
    );
    if (quick) {
      actor.deactivate();
      await actor[action.type](action, speed);
      await this._playResults(action, speed);
      actor.activate();
      this.drawCard();
      return;
    }

    this._showActions(false, actor);

    if (actionType === 'move') {
      // Show the player where the unit will move.
      board.setHighlight(action.assignment, {
        action: 'move',
        color: MOVE_TILE_COLOR,
      }, true);
      await sleep(2000 / speed);

      actor.deactivate();
      await actor.move(action, speed);
      actor.activate();
    }
    else if (actionType === 'attack') {
      // Show the player the units that will be attacked.
      const target = action.target;
      const targetTiles = actor.getTargetTiles(target);
      const targetUnits = actor.getTargetUnits(target);

      // For counter-attacks, the actor may differ from selected.
      if (selected !== actor) {
        selected.deactivate();
        actor.activate();
      }

      targetTiles.forEach(tile => {
        board.setHighlight(tile, {
          action: 'attack',
          color: ATTACK_TILE_COLOR,
        }, true);
      });

      if (targetUnits.length) {
        targetUnits.forEach(tu => tu.activate());

        if (targetUnits.length === 1) {
          actor.setTargetNotice(targetUnits[0], target);
          this.drawCard(targetUnits[0]);
        }
        else
          this.drawCard(actor);
      }

      await sleep(2000 / speed);

      targetUnits.forEach(tu => {
        tu.deactivate();
        tu.notice = null;
      });

      actor.deactivate();
      await actor.attack(action, speed);
      await this._playResults(action, speed);
      selected.activate();
      this.drawCard();
    }
    else if (actionType === 'turn') {
      actor.deactivate();
      await actor.turn(action, speed);
      actor.activate();
    }
    // Only applicable to Chaos Seed/Dragon
    else if (actionType === 'phase') {
      // Show the user the egg for 1 second before changing color
      this.drawCard(actor);
      await sleep(1000 / speed);

      await actor.phase(action, speed);
      await sleep(1000 / speed);
    }
    // Only applicable to Chaos Seed counter-attack
    else if (actionType === 'heal') {
      // Show the player the unit that will be healed.
      const targetUnit = action.target.assigned;

      if (selected !== actor) {
        selected.deactivate();
        actor.activate();
      }

      targetUnit.activate();
      this.drawCard(targetUnit);

      await sleep(1000 / speed);

      targetUnit.deactivate();
      actor.deactivate();
      await actor.heal(action, speed);
      await this._playResults(action, speed);
    }
    // Only applicable to Chaos Seed counter-attack
    else if (actionType === 'hatch') {
      this.drawCard(actor);
      actor.activate();
      await sleep(2000 / speed);

      actor.deactivate();
      selected.deactivate(); // the target
      await actor.hatch(action, speed);
      await this._playResults(action, speed);
    }
    else {
      this.drawCard(actor);

      // For counter-attacks, the actor may differ from selected.
      if (selected !== actor) {
        selected.deactivate();
        actor.activate();
      }

      await sleep(2000 / speed);

      actor.deactivate();
      await actor[action.type](action, speed);
      await this._playResults(action, speed);
      selected.activate();
      this.drawCard();
    }
  }
  _showActions(all = false, unit) {
    let board = this._board;
    let allActions = board.decodeAction(this.cursor.actions);
    if (!allActions.length)
      return;

    let actions = all ? allActions : this.actions;
    if (unit)
      actions = actions.filter(a => !a.unit || a.unit === unit);
    else
      unit = allActions[0].unit;

    board.clearHighlight();
    board.hideCompass();

    // Possible if no unit argument and this turn was passed.
    if (!unit)
      return;

    if (board.selected !== unit)
      this.drawCard(unit);

    let degree = board.getDegree('N', board.rotation);
    let tracker = {};

    let origin = this.units.flat().find(u => u.id === unit.id).assignment;
    origin = tracker.assignment = board.getTileRotation(origin, degree);

    board.setHighlight(origin, {
      action: 'focus',
      color: FOCUS_TILE_COLOR,
    }, true);

    actions.forEach(action => {
      if (action.unit !== unit) return;

      if (action.type === 'move') {
        tracker.assignment = action.assignment;
        tracker.direction = action.direction;

        board.setHighlight(tracker.assignment, {
          action: 'move',
          color: MOVE_TILE_COLOR,
        }, true);
      }
      else if (action.type === 'attack') {
        tracker.attack = unit.getTargetTiles(action.target, tracker.assignment);
        tracker.direction = action.direction;

        board.setHighlight(tracker.attack, {
          action: 'attack',
          color: ATTACK_TILE_COLOR,
        }, true);
      }
      else if (action.type === 'attackSpecial') {
        tracker.attack = unit.getSpecialTargetTiles(action.target, tracker.assignment);
        tracker.direction = action.direction;

        board.setHighlight(tracker.attack, {
          action: 'attack',
          color: ATTACK_TILE_COLOR,
        }, true);
      }
      else if (action.type === 'turn') {
        tracker.direction = action.direction;
      }
      else if (action.type === 'endTurn') {
        if (unit.directional !== false)
          board.showDirection(unit, tracker.assignment, tracker.direction);
      }
    });
  }
  /*
   * Show the player the results of an attack
   */
  async _playResults(action, speed) {
    if (!action.results)
      return;

    let showResult = async result => {
      if (result.type === 'summon') return;

      let anim = new Tactics.Animation({ speed });
      let changes = Object.assign({}, result.changes);

      // Changed separately
      let mHealth = changes.mHealth;
      delete changes.mHealth;

      let unit = result.unit;
      if (changes.type) {
        // The unit actually refers to the old unit object.
        // Find the new unit object, which should have the same ID.
        unit = unit.team.units.find(u => u.id === unit.id);
        delete changes.type;
      }

      // This can happen when the Chaos Seed hatches and consumes the unit.
      if (!unit.assignment) return;

      if (Object.keys(changes).length)
        unit.change(changes);
      if (result.results)
        this._applyChangeResults(result.results);

      anim.splice(this._animApplyFocusChanges(result));

      if (changes.armored && unit === action.unit) {
        this.drawCard(unit);

        let caption = 'Armor Up!';
        anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }
      else if ('focusing' in changes || changes.barriered === false) {
        let caption = result.notice;
        if (caption)
          anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }
      // Don't show shrub death.  They are broken apart during attack.
      else if (unit.type === 'Shrub' && mHealth === -unit.health)
        return anim.play();
      else if ('armored' in changes)
        return anim.play();

      // Show the effect on the unit
      this.drawCard(unit);
      if (unit.type === 'Furgon' && changes.mRecovery === 6)
        await sleep(2000 / speed);

      if (result.miss) {
        let notice = result.miss.toUpperCase('first')+'!';

        unit.change({ notice });
        let caption = result.notice || notice;
        anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }

      if (changes.paralyzed) {
        let caption = result.notice || 'Paralyzed!';
        anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }

      // Only animate health loss and death if unit is still on the board.
      // A knight consumed by hatched Chaos Dragon would not still be on the board.
      if (mHealth !== undefined && unit.assignment) {
        let increment;
        let options = {};

        if (mHealth > unit.mHealth)
          options.color = '#00FF00';
        else if (mHealth < unit.mHealth && mHealth > -unit.health)
          options.color = '#FFBB44';

        let diff = unit.mHealth - mHealth;

        if (changes.poisoned) {
          let caption = result.notice || 'Poisoned!';
          anim.splice(0, unit.animCaption(caption));
        }
        else {
          let caption = result.notice || Math.abs(
            result.damage === undefined ? diff : result.damage,
          ).toString();
          anim.splice(0, unit.animCaption(caption, options));
        }

        // Animate a change in health over 1 second (12 frames)
        if (mHealth !== unit.mHealth) {
          let progress = unit.mHealth;

          anim.splice(0, [
            {
              script: () => {
                if (Math.abs(diff) < 8) {
                  progress += (diff / Math.abs(diff)) * -1;
                  if (diff < 0)
                    progress = Math.min(mHealth, progress);
                  else
                    progress = Math.max(mHealth, progress);
                }
                else
                  progress += (diff / 8) * -1;

                unit.change({
                  mHealth: Math.round(progress),
                });
              },
              repeat: 8,
            },
            // Pause to reflect upon the new health amount
            {
              script: () => {},
              repeat: 6,
            },
          ]);
        }
      }

      return anim.play();
    };

    /*
     * To shorten playback, play multiple deaths at once.
     * A single death is played normally.
     * All deaths are played last.
     */
    let deadUnits = new Map();
    for (let i = 0; i < action.results.length; i++) {
      let result = action.results[i];

      let unit = result.unit;
      if (!unit) continue;
      // Choas Seed doesn't die.  It hatches.
      if (unit.type === 'ChaosSeed') continue;
      // Shrub doesn't die.  It is broken apart.
      if (unit.type === 'Shrub') continue;
      // Units consumed by Chaos don't die normally.
      if (!unit.assignment) continue;

      let changes = result.changes;
      if (!changes) continue;

      if (changes.mHealth === -unit.health)
        deadUnits.set(unit, result);
    }

    for (let i = 0; i < action.results.length; i++) {
      let result = action.results[i];

      await showResult(result);

      let unit = result.unit;
      if (unit) unit.change({notice: null});
    }

    if (deadUnits.size > 0) {
      let animDie = new Tactics.Animation();

      deadUnits.forEach((result, unit) => {
        animDie.splice(0, unit.animDie());
      });

      if (deadUnits.size > 1) {
        // Use 'drawCard()' instead of 'set notice' so that the notice isn't
        // "sticky" and the selected unit doesn't take precedence.
        this.drawCard(null, 'Multi kill!');

        // Add a few frames to take in the notice
        for (let i = 0; i < 4; i++)
          animDie.addFrame([]);
      }

      await animDie.play();
    }

    this.drawCard();
  }

  _render() {
    const renderer = this._renderer;

    this._board.sortUnits();

    // This is a hammer.  Without it, the mouse cursor will not change to a
    // pointer and back when needed without moving the mouse.
    renderer.plugins.interaction.update();

    renderer.render(this._stage);

    this._rendering = false;
  }

  _startTurn() {
    let team = this.currentTeam;
    let teamMoniker;

    if (team.name && this.teams.filter(t => t.name === team.name).length === 1)
      teamMoniker = team.name;
    else
      teamMoniker = team.colorId;

    if (this.isMyTeam(team)) {
      if (this.hasOneLocalTeam()) {
        this.notice = 'Your Turn!';
        Tactics.playSound('newturn');
      }
      else
        this.notice = `Go ${teamMoniker}!`;

      this.unlock();
    }
    else {
      this.delayNotice(`Go ${teamMoniker}!`);

      this.lock('readonly');
    }

    this.selectMode = 'move';
  }
  _resumeTurn() {
    this.selectMode = this._pickSelectMode();

    // Unlock after select to ensure focused tiles behave according to
    // any highlights applied by selecting the unit and mode.
    if (this.isMyTurn)
      this.unlock();
    else
      this.lock('readonly');
  }
  async _playSurrender(action) {
    let team = this.teams[action.teamId];
    let anim = new Tactics.Animation();
    let deathAnim = new Tactics.Animation();

    this.selected = this.viewed = null;

    this._applyChangeResults(action.results);

    action.results.forEach(result => {
      let unit = result.unit;

      anim.splice(0, this._animApplyFocusChanges(result));
      deathAnim.splice(0, unit.animDie());
    });

    anim.splice(deathAnim);

    // Show the notice for 2 seconds.
    let ts = new Date();
    this.notice = `${team.colorId} Surrenders!`;

    await anim.play();
    await sleep(2000 - (new Date() - ts));

    this.notice = null;
  }
  _playEndTurn(action) {
    // A unit that dies while making its turn will no longer be selected.
    // So, make sure any shown action tiles are cleared.
    if (!this.selected)
      this._board.clearHighlight();

    this.selected = this.viewed = null;

    // Assuming control of a bot team is specific to the chaos game type.
    if (this.state.type === 'chaos')
      if ('newPlayerTeam' in action) {
        let newPlayerTeam = this.teams[action.newPlayerTeam];
        newPlayerTeam.bot = false;
      }

    this._applyChangeResults(action.results);

    return this;
  }
  _endGame(silent = false) {
    const winnerId = this.state.winnerId;

    if (winnerId === 'truce') {
      this.notice = 'Truce!';

      if (!silent)
        Tactics.playSound('victory');
    } else if (winnerId === 'draw') {
      this.notice = 'Draw!';

      if (!silent)
        Tactics.playSound('defeat');
    } else {
      const teams = this.teams;
      const winner = teams[winnerId];
      let winnerMoniker;

      if (winner.name && teams.filter(t => t.name === winner.name).length === 1)
        winnerMoniker = winner.name;
      else
        winnerMoniker = winner.colorId;

      if (this.state.type === 'chaos') {
        if (winner.name === 'Chaos') {
          this.notice = 'Chaos Wins!';
          if (!silent)
            Tactics.playSound('defeat');
        }
        else {
          this.notice = 'You win!';
          if (!silent)
            Tactics.playSound('victory');
        }
      }
      // Applies to bot, opponent, and local games
      else if (this.isMyTeam(winner)) {
        this.notice = 'You win!';
        if (!silent)
          Tactics.playSound('victory');
      }
      else if (this.isViewOnly)
        this.notice = `${winnerMoniker}!`;
      else {
        this.notice = 'You lose!';
        if (!silent)
          Tactics.playSound('defeat');
      }
    }

    if (this.selected)
      this.selected = null;
    else
      this.selectMode = 'move';
    this.lock('gameover');

    return this;
  }

  _pickSelectMode() {
    // Pick what a unit can can[].
    let can = [];
    if (this.canSelectMove())
      can.push('move');
    if (this.canSelectAttack())
      can.push('attack');
    if (this.canSelectTurn())
      can.push('turn');
    can.push('direction');

    let selectMode = this.selectMode;
    if (selectMode === null || !can.includes(selectMode))
      selectMode = can.shift();

    return selectMode;
  }

  /*
   * Turns won't time out if an action was performed within the last 10 seconds.
   *
   * _turnTimeout is true when a timeout has been triggered.
   * _turnTimeout is a number when a timeout has been set, but not reached.
   * _turnTimeout is null when a timout is not necessary.
   */
  _setTurnTimeout() {
    let state = this.state;
    if (!state.turnTimeLimit)
      return;

    this._emit({ type:'resetTimeout' });

    if (state.endedAt) {
      clearTimeout(this._turnTimeout);
      this._turnTimeout = null;
      return;
    }

    if (this.isViewOnly)
      return;

    if (typeof this._turnTimeout === 'number') {
      clearTimeout(this._turnTimeout);
      this._turnTimeout = null;
    }

    let timeout = Infinity;

    if (!this.isMyTurn)
      timeout = this.turnTimeRemaining;

    if (timeout) {
      if (this._turnTimeout === true) {
        this._emit({ type:'cancelTimeout' });
        this._turnTimeout = null;
      }

      // Value must be less than a 32-bit signed integer.
      if (timeout < 0x80000000)
        this._turnTimeout = setTimeout(() => {
          if (state.endedAt) return;

          this._turnTimeout = true;
          this._emit({ type:'timeout' });
        }, timeout);
    }
    else {
      if (this._turnTimeout !== true) {
        this._turnTimeout = true;
        this._emit({ type:'timeout' });
      }
    }
  }
  _applyAction(action) {
    let board = this._board;
    let unit = action.unit;

    if (unit) {
      if (action.assignment)
        board.assign(unit, action.assignment);
      if (action.direction)
        unit.stand(action.direction);
      if (action.colorId)
        unit.color = colorMap.get(action.colorId);
    }

    this._applyChangeResults(action.results, true);

    // Remove dead units.
    board.teamsUnits.flat().forEach(unit => {
      // Chaos Seed doesn't die.  It hatches.
      if (unit.type === 'ChaosSeed') return;

      if (unit.mHealth === -unit.health)
        board.dropUnit(unit);
    });
  }
  _applyChangeResults(results, applyFocusChanges = false) {
    if (!results) return;

    const board = this._board;

    results.forEach(result => {
      const unit = result.unit;

      if (result.type === 'summon') {
        // Add a clone of the unit so that the original unit remains unchanged
        board.addUnit(unit.clone(), this.teams[result.teamId]);
      } else if (result.changes) {
        const changes = result.changes;
        if (changes.direction)
          unit.stand(changes.direction);

        unit.change(result.changes);

        if (applyFocusChanges) {
          if (unit.focusing || unit.paralyzed || unit.poisoned)
            unit.showFocus();
          else
            unit.hideFocus();

          if (unit.barriered)
            unit.showBarrier();
          else
            unit.hideBarrier();
        }
      }

      if (result.results)
        this._applyChangeResults(result.results, applyFocusChanges);
    });
  }
  _animApplyFocusChanges(result) {
    let anim = new Tactics.Animation();
    let unit = result.unit;
    let changes = result.changes || {};

    if ('focusing' in changes || 'paralyzed' in changes || 'poisoned' in changes) {
      let hasFocus   = unit.hasFocus();
      let needsFocus = unit.focusing || unit.paralyzed || unit.poisoned;
      if (!hasFocus && needsFocus)
        anim.splice(0, unit.animFocus());
      else if (hasFocus && !needsFocus)
        anim.splice(0, unit.animDefocus());
    }

    /*
     * Check for barrier changes to ensure that a BW barriering itself doesn't
     * get double barriered.
     */
    if ('barriered' in changes) {
      let hasBarrier   = unit.hasBarrier();
      let needsBarrier = unit.barriered;
      if (!hasBarrier && needsBarrier)
        anim.splice(0, unit.animShowBarrier());
      else if (hasBarrier && !needsBarrier)
        anim.splice(0, unit.animHideBarrier());
    }

    if (result.results)
      result.results.forEach(result => anim.splice(0, this._animApplyFocusChanges(result)));

    return anim;
  }

  _onStateEvent({ type, data }) {
    switch (true) {
      case type === 'change':
        this._setTurnTimeout();

        // Immediately save the new action(s), if any, before they are cleared
        // by a new turn.
        this.cursor.sync();

        this._emit({ type:'state-change' });
        if (this._isSynced)
          this.play();
        break;
      case /^playerRequest\b/.test(type):
        this._emit({ type, data });
        break;
    }
  }
}

emitter(Game);
