import emitter from 'utils/emitter.js';

import { gameConfig } from 'config/client.js';
import Cursor from 'tactics/GameStateCursor.js';
import PanZoom from 'utils/panzoom.js';
import sleep from 'utils/sleep.js';

import Board, {
  FOCUS_TILE_COLOR,
  MOVE_TILE_COLOR,
  ATTACK_TILE_COLOR,
} from 'tactics/Board.js';
import { colorFilterMap } from 'tactics/colorMap.js';

export default class Game {
  /*
   * Arguments:
   *  state: An object supporting the GameState class interface.
   */
  constructor(state, playerId = null) {
    if (!state)
      throw new TypeError('Required game state');

    const board = new Board();
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
      .on('move',        event => this._submitAction(event))
      .on('attack',      event => this._submitAction(event))
      .on('attackSpecial', event => this._submitAction(event))
      .on('turn',        event => this._submitAction(event))
      .on('endTurn',     event => this._submitAction(event))
      .on('card-change', event => this._emit(event))
      .on('lock-change', event => this._emit(event));

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

      _renderer: null,
      _rendering: false,
      _canvas: null,
      _stage: new PIXI.Container(),
      _animators: {},

      _selectMode: 'move',
      _tranformToRestore: null,

      _notice: null,
      _board: board,

      _panzoom: null,
    });
  }

  async init() {
    const renderer = this._renderer = await PIXI.autoDetectRenderer({
      width: Tactics.width,
      height: Tactics.height,
      backgroundAlpha: 0,
    });
    const canvas = this._canvas = renderer.canvas;

    const board = this.board;
    await board.initCard();
    board.draw();
    this._stage.addChild(board.pixi);

    /*
     * Disable tile selection while pinching is in progress
     */
    this._panzoom = PanZoom({ target:canvas })
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

    return Tactics.game = this;
  }

  /*****************************************************************************
   * Public Properties
   ****************************************************************************/
  get collection() {
    return this.state.collection;
  }
  get whenStarted() {
    return this.state.whenStarted;
  }
  get currentTurnTimeLimit() {
    return this.state.currentTurnTimeLimit;
  }
  get timeLimitName() {
    return this.state.timeLimitName;
  }
  get timeLimit() {
    return this.state.timeLimit;
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
      return this.state.timeLimit?.base === 30 ? 2 : 1;
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
        focused.focus(viewOnly);
        board.focused = focused;
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
    const board        = this._board;
    const old_selected = board.selected;
    const old_viewed   = board.viewed;

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

        if (old_selected.assignment.focused && old_selected.assignment.is_interactive()) {
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
        } else
          this.selectMode = this._pickSelectMode();
      } else {
        this.drawCard();
        this.selectMode = 'move';
      }
    } else if (old_viewed) {
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
    } else if (selected && this.isMyTurn && !this._inReplay) {
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
    return this.state.currentTeamId === null ? null : this._teams[this.state.currentTeamId];
  }
  get isBotGame() {
    return !!this.state.teams.find(t => !!t?.bot);
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
  get isSimulation() {
    return this.state.isSimulation;
  }
  get isPracticeMode() {
    return this.state.isPracticeMode;
  }
  get ofSinglePlayer() {
    if (!this.state.forkOf) return false;

    const myTeams = this.state.teams.filter(t => t.forkOf.playerId === this.playerId);

    return myTeams.length === this.state.teams.length;
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
      this.cursor.units,
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
    if (team === null)
      return false;

    if (typeof team === 'number')
      team = this.teams[team];

    if (this.playerId === null)
      return !team.bot;
    else
      return team.playerId === this.playerId;
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

    const initialTurnId = this.state.getTeamInitialTurnId(team);

    if (this.state.currentTurnId < initialTurnId)
      return false;
    // Might not be completely accurate for ended games where this team lost.
    if (this.state.currentTurnId > initialTurnId)
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
    const teams = this._teams = state.teams.map(t => t.clone());

    // Rotate the board such that my first local team is in the configured location.
    const myTeams = this.teams.filter(t => this.isMyTeam(t));
    let myTeam;
    if (myTeams.length === 1)
      myTeam = myTeams[0];
    else if (myTeams.length > 1) {
      if (state.forkOf) {
        const myOldTeams = myTeams.filter(t => t.forkOf.playerId === this.playerId);
        if (myOldTeams.length === 1)
          myTeam = myOldTeams[0];
        else if (myOldTeams.length > 1)
          myTeam = myOldTeams.sort((a,b) => a.joinedAt - b.joinedAt)[0];
      } else
        // joinedAt might be the same for all teams, so slot is used for local games.
        myTeam = myTeams.sort((a,b) => a.slot - b.slot)[0];
    }

    if (myTeam)
      board.rotate(board.getDegree(myTeam.position, gameConfig.rotation));

    /*
     * Apply teams' color based on their position.
     */
    const degree = board.getDegree('S', myTeam ? myTeam.position : 'S');
    const teamColorIds = gameConfig.teamColorIds;
    const colorIds = new Map([
      ['N', teamColorIds[0] ],
      ['E', teamColorIds[1] ],
      ['S', teamColorIds[2] ],
      ['W', teamColorIds[3] ],
      ['C', 'White' ], // Chaos starts in a center position
    ]);

    teams.forEach(team => {
      const position = board.getRotation(team.position, degree);

      team.colorId ??= colorIds.get(position);
    });

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

  /*
   * Used to jump to a cursor:
   *   resume()
   */
  setState() {
    const board = this._board;
    board.setState(this.units, this._teams);

    for (const team of this._teams)
      team.isCurrent = team.id === this.cursor.teamId;

    // Do not use this.actions or expect bugs
    let actions = this.cursor.actions.slice(0, this.cursor.nextActionId);
    actions.forEach(a => this._applyAction(board.decodeAction(a)));

    this.selectMode = 'move';

    if (actions.length) {
      const selectAction = board.decodeAction(actions[0]);
      if (selectAction.unit?.assignment)
        this.selected = selectAction.unit;
    } else if (this._inReplay && this.cursor.actions.length) {
      const selectAction = board.decodeAction(this.cursor.actions[0]);
      if (selectAction.unit?.assignment)
        this.selected = selectAction.unit;
    } else
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
    } else {
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
      else if (cursor.actions.last.type === 'endTurn')
        this._endTurn();
      else
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
  async showTurn(turnId = this.turnId, actionId = 0, skipAutoPassedTurns) {
    await this.pause();
    await this.cursor.set(turnId, actionId, skipAutoPassedTurns);
    this.setState();

    if (this.cursor.atEnd)
      this._endGame(true);
  }

  /*
   * Allow touch devices to upscale to normal size.
   */
  resize() {
    const canvas = this._canvas;
    canvas.style.width  = '';
    canvas.style.height = '';

    const container = canvas.parentNode;
    const width     = container.clientWidth;
    let height    = container.clientHeight;
    // window.innerHeight is buggy on iOS Safari during orientation change
    const vpHeight  = document.body.offsetHeight;

    if (vpHeight < height) {
      const rect = canvas.getBoundingClientRect();

      height  = vpHeight;
      height -= rect.top;
      //height -= vpHeight - rect.bottom;
      //console.log(vpHeight, rect.bottom);
    } else
      height -= canvas.offsetTop;

    const width_ratio  = width  / Tactics.width;
    const height_ratio = height / Tactics.height;
    const elementScale = Math.min(1, width_ratio, height_ratio);

    if (elementScale < 1)
      if (width_ratio < height_ratio)
        // Use height instead of 100% width to avoid Edge bug.
        canvas.style.height = Math.floor(Tactics.height * width_ratio)+'px';
      else
        canvas.style.height = height+'px';

    const panzoom = this._panzoom;
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
      if (selected.initialState.poisoned)
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
    if (!this.state.startedAt)
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

  delayNotice(notice, priority = false) {
    const delay = 200;

    this.notice = null;
    this._noticeTimeout = setTimeout(() => {
      if (priority)
        this.drawCard(null, notice);
      else
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
    this.delayNotice('Sending order...', true);

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
    const actionType = action.type;
    const speed = this.speed;

    action = board.decodeAction(action);

    if (actionType === 'endTurn') {
      const doShowDirection = (
        board.selected &&
        board.selected.directional !== false &&
        (!this.isMyTeam(action.teamId) || this._inReplay) &&
        (this.state.timeLimit?.base > 30 || this._inReplay)
      );
      if (doShowDirection) {
        // Show the direction the unit turned for 2 seconds.
        board.showDirection(board.selected);
        await sleep(2000 / speed);
      }

      return this._playEndTurn(action);
    } else if (actionType === 'surrender')
      return this._playSurrender(action);
    else if (actionType === 'endGame')
      return;

    const actor = action.unit;

    // Select the initial actor
    if (!board.selected) {
      board.selected = actor;
      if (action.type !== 'phase')
        actor.activate();
      this.drawCard();
    }

    if (action.type === 'select')
      return;

    // View the current actor
    if (board.selected !== actor) {
      await board.selected.deactivate();
      board.viewed = actor;
      this.drawCard();
    } else if (board.viewed) {
      await board.viewed.deactivate();
      board.viewed = null;
      this.drawCard();
    }

    /*
     * For actions initiated by the viewing player, perform the quick version.
     */
    const quick = (
      (!board.selected || board.selected === actor) &&
      this.isMyTeam(action.teamId) &&
      !this._inReplay
    );
    if (quick) {
      await actor.deactivate();
      await actor[action.type](action, speed);
      await this._playResults(action, speed, actionType === 'move');
      board.viewed?.deactivate();
      board.viewed = null;
      board.selected?.activate();
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

      await actor.deactivate();
      await actor.move(action, speed);
      await this._playResults(action, speed, true);
    } else if (actionType === 'attack') {
      // Show the player the units that will be attacked.
      const target = action.target;
      const targetTiles = actor.getTargetTiles(target);
      const targetUnits = actor.getTargetUnits(target);

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
        } else
          this.drawCard(actor);
      }

      await sleep(2000 / speed);

      await Promise.all(targetUnits.map(tu => {
        tu.notice = null;
        return tu.deactivate();
      }));

      await actor.deactivate();
      await actor.attack(action, speed);
      await this._playResults(action, speed);
    } else if (actionType === 'turn') {
      await actor.deactivate();
      await actor.turn(action, speed);
    // Only applicable to Chaos Seed/Dragon
    } else if (actionType === 'phase') {
      // Show the user the egg for 1 second before changing color
      this.drawCard(actor);
      await sleep(1000 / speed);

      await actor.phase(action, speed);
      await sleep(1000 / speed);
    // Only applicable to Chaos Seed counter-attack
    } else if (actionType === 'heal') {
      // Show the player the unit that will be healed.
      const targetUnit = action.target.assigned;

      if (board.selected !== actor) {
        await board.selected.deactivate();
        actor.activate();
      }

      targetUnit.activate();
      this.drawCard(targetUnit);

      await sleep(1000 / speed);

      await Promise.all([ targetUnit.deactivate(), actor.deactivate() ]);
      await actor.heal(action, speed);
      await this._playResults(action, speed);
    } else if (actionType === 'transform') {
      this.drawCard(actor);
      actor.activate();
      await sleep(2000 / speed);
      await actor.deactivate();

      await actor.transform(action, speed);

      // View the new me
      board.viewed = action.target.assigned;
      board.drawCard();
      await this._playResults(action, speed);
      await sleep(2000 / speed);
    } else {
      this.drawCard(actor);

      // For counter-attacks, the actor may differ from selected.
      if (board.selected !== actor) {
        await board.selected.deactivate();
        actor.activate();
      }

      await sleep(2000 / speed);

      await actor.deactivate();
      await actor[action.type](action, speed);
      await this._playResults(action, speed);
    }

    board.viewed?.deactivate();
    board.viewed = null;
    board.selected?.activate();
    this.drawCard();
  }
  _showActions(all = false, unit) {
    let board = this._board;
    let allActions = board.decodeAction(this.cursor.actions, this.cursor.units);
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
      } else if (action.type === 'attack') {
        tracker.attack = unit.getTargetTiles(action.target, tracker.assignment);
        tracker.direction = action.direction;

        board.setHighlight(tracker.attack, {
          action: 'attack',
          color: ATTACK_TILE_COLOR,
        }, true);
      } else if (action.type === 'attackSpecial') {
        tracker.attack = unit.getSpecialTargetTiles(action.target, tracker.assignment);
        tracker.direction = action.direction;

        board.setHighlight(tracker.attack, {
          action: 'attack',
          color: ATTACK_TILE_COLOR,
        }, true);
      } else if (action.type === 'turn') {
        tracker.direction = action.direction;
      } else if (action.type === 'endTurn') {
        if (unit.directional !== false)
          board.showDirection(unit, tracker.assignment, tracker.direction);
      }
    });
  }
  /*
   * Show the player the results of an attack
   */
  async _playResults(action, speed, combined = false) {
    if (!action.results)
      return;

    if (combined) {
      const anim = new Tactics.Animation({ speed });
      anim.splice(this._animApplyChangeResults(action.results));
      await anim.play();
      return;
    }

    const showResult = async result => {
      // The 2nd condition is meant to skip changing a Shrub to a Rageweed.
      if (result.type === 'summon' || action.unit.type === 'Furgon' && result.unit !== action.unit) return;

      const anim = new Tactics.Animation({ speed });
      const changes = Object.assign({}, result.changes);

      // Changed separately
      const mHealth = changes.mHealth;
      if (mHealth !== undefined)
        delete changes.mHealth;

      // Apply a disposition at the end of a health change, if any
      const disposition = mHealth === undefined ? undefined : changes.disposition;
      if (disposition !== undefined)
        delete changes.disposition;

      let unit = result.unit;
      if (changes.type) {
        // The unit actually refers to the old unit object.
        // Find the new unit object, which should have the same ID.
        unit = unit.team.units.find(u => u.id === unit.id);
        delete changes.type;
      }

      // This can happen when the Chaos Seed hatches and consumes the unit.
      if (!unit.assignment) return;

      const mArmorChange = changes.mArmor === undefined ? 0 : changes.mArmor - unit.mArmor;

      anim.splice(this._animApplyChangeResults([ result ], { andDie:false }));

      if (mArmorChange > 0 && unit === action.unit) {
        anim.splice(0, () => this.drawCard(unit));

        const caption = 'Armor Up!';
        anim.splice(0, unit.animCaption(caption));

        return anim.play();
      } else if ('focusing' in changes || changes.barriered === false) {
        const caption = result.notice;
        if (caption)
          anim.splice(0, unit.animCaption(caption));

        return anim.play();
      } else if (unit.type === 'Shrub' && unit.disposition === 'dead')
        // Don't show shrub death.  They are broken apart during attack.
        return anim.play();
      else if ('armored' in changes)
        return anim.play();

      // Show the effect on the unit after changes are applied in the first frame.
      anim.splice(0, () => this.drawCard(unit));

      if (result.miss) {
        const notice = result.miss.toUpperCase('first')+'!';

        unit.change({ notice });
        const caption = result.notice || notice;
        anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }

      if (changes.paralyzed) {
        const caption = result.notice || 'Paralyzed!';
        anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }

      // Only animate health loss and death if unit is still on the board.
      // A knight consumed by hatched Chaos Dragon would not still be on the board.
      if (mHealth !== undefined && unit.assignment) {
        const options = {};

        if (mHealth > unit.mHealth)
          options.color = '#00FF00';
        else if (mHealth < unit.mHealth && mHealth > -unit.health)
          options.color = '#FFBB44';

        const diff = unit.mHealth - mHealth;

        if (changes.poisoned) {
          const caption = result.notice || 'Poisoned!';
          anim.splice(0, unit.animCaption(caption));
        } else {
          const caption = result.notice || Math.abs(
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
                } else
                  progress += (diff / 8) * -1;

                const changes = {
                  mHealth: Math.round(progress),
                  disposition: null,
                };
                if (disposition !== undefined && Math.round(progress) === mHealth)
                  changes.disposition = disposition;
                unit.change(changes);
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

      await anim.play();

      // Show how the Furgon is exhausted after unleashing his rage
      if (unit.type === 'Furgon' && changes.mRecovery === 6) {
        this.drawCard(unit);
        await sleep(2000 / speed);
      }
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

      if (changes.disposition === 'dead')
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

    renderer.events.updateCursor();
    renderer.render(this._stage);

    this._rendering = false;
  }

  _startTurn() {
    const team = this.currentTeam;
    let teamMoniker;

    if (team.name && this.teams.filter(t => t.name === team.name).length === 1)
      teamMoniker = team.name;
    else
      teamMoniker = team.colorId;

    if (this.isMyTeam(team)) {
      if (this.hasOneLocalTeam()) {
        this.notice = 'Your Turn!';
        Tactics.playSound('newturn');
      } else
        this.notice = `Go ${teamMoniker}!`;

      this.unlock();
    } else {
      this.delayNotice(`Go ${teamMoniker}!`);
      this.lock('readonly');
    }

    this.selectMode = 'move';
  }
  _endTurn() {
    // Pretend the next turn started even if delayed
    const teams = this.teams;
    const team = this.currentTeam;

    if (this.isMyTeam(team)) {
      const nextTeamId = (team.id + 1) % teams.length;
      const nextTeam = teams[nextTeamId];

      let teamMoniker;
      if (nextTeam.name && teams.filter(t => t.name === nextTeam.name).length === 1)
        teamMoniker = nextTeam.name;
      else
        teamMoniker = nextTeam.colorId;

      this.delayNotice(`Go ${teamMoniker}!`);
      this.lock('readonly');
    }
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
    const team = this.teams[action.teamId];

    this.selected = this.viewed = null;

    // Show the notice for 2 seconds.
    const ts = new Date();
    this.notice = `${team.colorId} Surrenders!`;

    await this._animApplyChangeResults(action.results).play();
    await sleep(2000 - (new Date() - ts));

    this.notice = null;
  }
  async _playEndTurn(action) {
    // A unit that dies while making its turn will no longer be selected.
    // So, make sure any shown action tiles are cleared.
    if (!this.selected)
      this._board.clearHighlight();

    this.selected = this.viewed = null;

    // Assuming control of a bot team is specific to the chaos game type.
    if (this.state.type === 'chaos')
      if ('newPlayerTeam' in action) {
        const newPlayerTeam = this.teams[action.newPlayerTeam];
        newPlayerTeam.bot = false;
      }

    await this._playResults(action, this.speed, true);

    this._board.setInitialState();

    const teamId = (this.cursor.teamId + 1) % this.teams.length;
    for (const team of this._teams)
      team.isCurrent = team.id === teamId;

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
      // Applies to bot, opponent, and local games
      } else if (this.isMyTeam(winner)) {
        this.notice = 'You win!';
        if (!silent)
          Tactics.playSound('victory');
      } else if (this.isViewOnly)
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
   * _turnTimeout is true when a timeout has been triggered.
   * _turnTimeout is a number when a timeout has been set, but not reached.
   * _turnTimeout is null when a timeout is not necessary.
   */
  _setTurnTimeout() {
    const state = this.state;
    if (!state.timeLimit)
      return;

    this._emit({ type:'resetTimeout' });

    if (state.currentTurnTimeLimit === null) {
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
          if (state.currentTurnTimeLimit === null) return;

          this._turnTimeout = true;
          this._emit({ type:'timeout' });
        }, timeout);
    } else {
      if (this._turnTimeout !== true) {
        this._turnTimeout = true;
        this._emit({ type:'timeout' });
      }
    }
  }
  async _applyAction(action) {
    const board = this._board;
    const unit = action.unit;

    if (unit) {
      if (action.assignment)
        board.assign(unit, action.assignment);
      if (action.direction)
        unit.stand(action.direction);
      if (action.colorId)
        unit.color = colorFilterMap.get(action.colorId);
    }

    await this._animApplyChangeResults(action.results, { instant:true }).play();
  }
  _animApplyChangeResults(results, options) {
    const anim = new Tactics.Animation();
    if (!results || results.length === 0) return anim;

    const board = this._board;
    const allResults = results.slice();
    const unitsChanges = [];

    for (let i = 0; i < allResults.length; i++) {
      const result = allResults[i];
      const unit = result.unit;

      if (result.type === 'summon')
        // Add a clone of the unit so that the original unit remains unchanged
        board.addUnit(unit.clone(), this.teams[result.teamId]);
      else if (result.changes && !result.changes.type) {
        const unitChanges = unitsChanges.find(uc => uc.unit === unit);
        if (unitChanges)
          Object.assign(unitChanges.changes, result.changes);
        else
          unitsChanges.push({ unit, changes:result.changes });
      }

      // Process sub results before subsequent results (just in case this matters)
      if (result.results)
        allResults.splice(i + 1, 0, ...result.results);
    }

    // Process each unit in order of appearance (just in case this matters)
    for (const unitChanges of unitsChanges)
      anim.splice(0, unitChanges.unit.animChange(unitChanges.changes, options));

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
