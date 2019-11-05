import EventEmitter from 'events';
import PanZoom from 'utils/panzoom.js';
import sleep from 'utils/sleep.js';

import Board, {
  FOCUS_TILE_COLOR,
  MOVE_TILE_COLOR,
  ATTACK_TILE_COLOR,
} from 'tactics/Board.js';

export default class {
  /*
   * Arguments:
   *  state: An object supporting the Game class interface.
   */
  constructor(state, localTeamIds = []) {
    if (!state)
      throw new TypeError('Required game state');

    let renderer = PIXI.autoDetectRenderer(Tactics.width, Tactics.height, { transparent:true });

    // Let's not go crazy with the move events.
    renderer.plugins.interaction.moveWhenInside = true;

    let board = new Board();
    board.initCard();
    board.draw();
    board
      .on('focus', ({ tile, unit }) => {
        Tactics.sounds.focus.play();

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

        Tactics.sounds.select.play();
        if (this.canSelect(unit))
          this.selected = unit;
        else
          this.viewed = unit;
      })
      .on('deselect', () => {
        if (this.viewed)
          this.viewed = null;
        else if (this.selected && !this.state.actions.length && this._selectMode !== 'target')
          this.selected = null;
      })
      // 'move' and 'attack' events do not yet come from the board.
      .on('move',    event => this._submitAction(event))
      .on('attack',  event => this._submitAction(event))
      .on('turn',    event => this._submitAction(event))
      .on('endTurn', event => this._submitAction(event))
      .on('card-change', event => this._emit(event))
      .on('lock-change', event => this._emit(event));

    Object.assign(this, {
      // Crude tracking of the pointer type being used.  Ideally, this should
      // reflect the last pointer type to fire an event on the board.
      pointerType: 'ontouchstart' in window ? 'touch' : 'mouse',

      state:            state,
      undoAccepts:      new Set(),

      _onStateEventListener: this._onStateEvent.bind(this),
      _stateEventStack: null,

      _teams: [],
      _localTeamIds: localTeamIds,
      _turnTimeout: null,

      _renderer: renderer,
      _rendering: false,
      _canvas: renderer.view,
      _stage: new PIXI.Container(),
      _animators: {},

      _selectMode: 'move',
      _tranformToRestore: null,

      _notice: null,
      _board: board,

      _panzoom: PanZoom({
        target: renderer.view,
        locked: true,
      }),

      _emitter: new EventEmitter(),
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
      }

      if (selected) {
        board.selected = selected;
        // Draw the card BEFORE selecting the mode to allow board.showTargets()
        // to override the focused unit with the targeted unit.
        this.drawCard();
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
        if (this.isMyTeam(selected.team))
          this.selectMode = selected.activated;
        else {
          this._showActions();
          this.selectMode = 'move';
        }
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
    else if (selected && this.isMyTurn) {
      if (selectMode === 'target')
        // Clear highlight, but not target tile
        board.hideMode();
      else
        // Clear highlight and target tile
        board.clearMode();

      selected.activate(selectMode);
    }

    if (viewed || this.isMyTurn)
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
    let currentTeamId = this.state.currentTeamId;
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
    let botTeams = this.state.teams.filter(t => !!t.bot);
    if (botTeams.length === 0)
      return false;

    let playerTeams = this.state.teams.filter(t => !t.bot);
    return this._localTeamIds.length === playerTeams.length;
  }
  get isViewOnly() {
    return this._localTeamIds.length === 0;
  }
  get isMyTurn() {
    return this.isMyTeam(this.currentTeam);
  }

  get actions() {
    return this._board.decodeAction(this.state.actions);
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

    return this._localTeamIds.includes(team.originalId);
  }
  hasOneLocalTeam(team) {
    if (team !== undefined && !this.isMyTeam(team)) return false;

    return this._localTeamIds.length === 1;
  }

  /*
   * Used to start playing the game... even if it is from the middle of it.
   */
  start() {
    let state = this.state;

    return new Promise((resolve, reject) => {
      // Let the caller finish what they are doing.
      setTimeout(() => {
        // Clone teams since board.setState() applies a units property to each.
        let teams = this._teams = state.teams.map(team => ({...team}));

        // Rotate the board such that the first local team is south/red.
        let board = this._board;
        let degree = 0;
        if (this._localTeamIds.length) {
          let teamId = Math.min(...this._localTeamIds);
          let team = teams.find(t => t.originalId === teamId);
          degree = board.getDegree(team.position, 'S');

          board.rotate(degree);
        }

        /*
         * Apply team colors based on the team's (rotated?) position.
         */
        let colorIds = new Map([
          ['N', 'Blue'  ],
          ['E', 'Yellow'],
          ['S', 'Red'   ],
          ['W', 'Green' ],
          ['C', 'White' ], // Chaos starts in a center position
        ]);
        teams.forEach(team => {
          let position = board.getRotation(team.position, degree);

          team.colorId = colorIds.get(position);
        });

        /*
         * Before listening to events, determine current state so that only
         * events leading up to this point is played and any following events
         * are handled by the event listener.
         */
        let replayTurnId = state.currentTurnId;
        let replayActionId = state.actions.length;
        let turnStarted = state.turnStarted;

        state.on('event', this._onStateEventListener);

        if (state.ended) {
          board.setState(state.units, teams);
          this.actions.forEach(action => {
            // Allow the user to see the loser's units at time of surrender.
            if (action.type === 'surrender') return;

            this._applyAction(action);
          });
          this.render();

          if (state.winnerId === null)
            this.notice = 'Draw!';
          else {
            let winner = this.teams[state.winnerId];
            let winnerMoniker;

            if (winner.name && teams.filter(t => t.name === winner.name).length === 1)
              winnerMoniker = winner.name;
            else
              winnerMoniker = winner.colorId;

            this.notice = winnerMoniker+'!';
          }

          this.selectMode = 'move';
          this.lock('gameover');
        }
        else
          this._stateEventStack = this._replay(replayTurnId, replayActionId).then(() => {
            if (turnStarted)
              this._startTurn();

            let undoRequest = state.undoRequest;
            if (undoRequest && undoRequest.status === 'pending')
              this._emit({
                type: 'undoRequest',
                data: state.undoRequest,
              });
          });

        resolve();
      }, 100); // A "zero" delay is sometimes not long enough
    });
  }
  /*
   * This is used when surrendering serverless games.
   */
  restart() {
    this.lock();

    let state = this.state;

    // Reset controlled teams.
    if (state.type === 'Chaos')
      this._localTeamIds.length = 1;

    state.off('event', this._onStateEventListener);

    this._board.rotation = 'N';
    this.notice = null;

    // Inform game state to restart.
    state.restart();

    return this.start();
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
    let viewed = this.viewed;
    if (viewed)
      return !!viewed.getAttackTiles().length;

    let selected = this.selected;
    if (selected) {
      if (this.attacked && this.isMyTeam(selected.team))
        return false;

      return !!selected.getAttackTiles().length;
    }

    return true;
  }
  canSelectSpecial() {
    let selected = this.selected;
    if (selected)
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
    let anim = this.selected.animReadySpecial();
    let promise = anim.play();

    // If you release too early, the attack is cancelled.
    // If you release after ~2 secs then the attack is launched. 
    promise.release = () => {
      anim.stop();
      if (anim.state.ready)
        this._submitAction({type:'attackSpecial'});
    };

    // For the sake of all that's holy, don't attack even if ready!
    promise.cancel = () => anim.stop();

    return promise;
  }

  pass() {
    this._submitAction({ type:'endTurn' });
  }
  surrender() {
    this._submitAction({ type:'surrender' });
  }
  forceSurrender() {
    this._submitAction({ type:'surrender', teamId:this.state.currentTeamId });
  }

  /*
   * Determine if player's team may request an undo.
   * Even if you can undo, the request may be rejected.
   */
  canUndo() {
    let state = this.state;
    if (state.ended || this.isViewOnly)
      return false;

    // Determine the team that is requesting the undo.
    let teams  = this.teams;
    let myTeam = this.currentTeam;
    while (!this.isMyTeam(myTeam)) {
      let prevTeamId = (myTeam.id === 0 ? teams.length : myTeam.id) - 1;
      myTeam = teams[prevTeamId];
    }

    let undoRequest = state.undoRequest;
    if (undoRequest)
      if (undoRequest.status === 'rejected')
        if (undoRequest.teamId === myTeam.id)
          return false;

    let actions = state.actions;

    // Can't undo if there are no actions or turns to undo.
    if (state.currentTurnId === 0 && actions.length === 0)
      return false;

    // Local games don't impose restrictions.
    let bot      = teams.find(t => !!t.bot);
    let opponent = teams.find(t => t.playerId !== myTeam.playerId);
    if (!bot && !opponent)
      return true;

    if (myTeam === this.currentTeam) {
      if (actions.length === 0)
        return false;
    }
    // If actions were made since the team's turn, approval is required.
    else {
      // Bot rejects undo if it is not your turn.
      if (bot) return false;

      let turnOffset = (-teams.length + (myTeam.id - this.currentTeam.id)) % teams.length;

      // Can't undo if the team hasn't made a turn yet.
      let turnId = state.currentTurnId + turnOffset;
      if (turnId < 0)
        return false;

      return true;
    }

    if (bot) {
      let lastAction = actions.last;

      // Bot rejects undo if the last action was a counter-attack
      let selectedUnitId = actions[0].unit;
      if (selectedUnitId !== lastAction.unit)
        return false;

      // Bot rejects undo if the last action required luck
      let isLucky = lastAction.results && !!lastAction.results.find(r => 'luck' in r);
      if (isLucky)
        return false;
    }

    return true;
  }
  undo() {
    return this.state.undo();
  }
  acceptUndo() {
    this.state.acceptUndo();
  }
  rejectUndo() {
    this.state.rejectUndo();
  }
  cancelUndo() {
    this.state.cancelUndo();
  }

  rotateBoard(rotation) {
    this._board.rotate(rotation);
    this.render();
  }

  zoomToTurnOptions() {
    let selected = this.selected;
    if (!selected) return;

    let panzoom = this._panzoom;

    this.transformToRestore = panzoom.transform;

    // Get the absolute position of the turn options.
    let point = selected.assignment.getTop().clone();
    point.y -= 14;

    // Convert coordinates to percentages.
    point.x = point.x / Tactics.width;
    point.y = point.y / Tactics.height;

    panzoom.transitionPointToCenter(point, panzoom.maxScale);

    return this;
  }

  delayNotice(notice) {
    let delay = 200;

    this.notice = null;
    this._noticeTimeout = setTimeout(() => {
      this.notice = notice;
    }, delay);
  }

  drawCard(unit) {
    this._board.drawCard(unit, this._notice);
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
  _revert(turnData) {
    let board = this._board;

    this.selected = this.viewed = null;

    board.setState(turnData.units, this._teams);

    let actions = turnData.actions.map(actionData => {
      let action = board.decodeAction(actionData);
      this._applyAction(action);
      return action;
    });

    this._startTurn();

    if (actions.length)
      if (this.isMyTeam(turnData.teamId))
        this.selected = actions[0].unit;
      else {
        let selected = board.selected = actions[0].unit.activate();
        this.drawCard();

        this._showActions(actions);
      }

    this._emit({ type:'revert' });
    this.render();
  }

  /*
   * Initiate an action, whether it be moving, attacking, turning, or passing.
   */
  _submitAction(action) {
    if (!action.unit && action.type !== 'endTurn' && action.type !== 'surrender')
      action.unit = this.selected;

    this.selected = null;
    this.delayNotice('Sending order...');

    this.lock();
    return this.state.submitAction(this._board.encodeAction(action))
      .catch(error => {
        // The user may submit an action that ends the game, but the endGame
        // event is delayed until after the user submits another action.
        if (error.code === 403 && error.message === 'The game has ended')
          return;

        throw error;
      });
  }
  _performActions(actions) {
    // Clear or cancel the 'Sending order' notice
    this.notice = null;

    // The actions array can be empty due to the _replay() method.
    if (actions.length === 0) return Promise.resolve();

    let board = this._board;
    actions = board.decodeAction(actions);

    let selected = this.selected;
    let promise = actions.reduce(
      (promise, action) => promise.then(() => {
        // Actions initiated by local players get a short performance.
        if (this.isMyTeam(action.teamId))
          return this._performAction(action);

        if (action.type === 'endTurn') {
          this.selected = selected = null;
          board.clearHighlight();

          return this._performAction(action);
        }
        else if (action.type === 'surrender')
          return this._performAction(action);

        if (!selected) {
          // Show the player the unit that is about to act.
          board.selected = selected = action.unit;
          if (action.type !== 'phase')
            selected.activate();
          board.setHighlight(selected.assignment, {
            action: 'focus',
            color: FOCUS_TILE_COLOR,
          }, true);
          this.drawCard();
        }

        return new Promise(resolve => {
          let actionType = action.type;

          if (actionType === 'move') {
            // Show the player where the unit will move.
            board.setHighlight(action.assignment, {
              action: 'move',
              color: MOVE_TILE_COLOR,
            }, true);

            // Wait 2 seconds then move.
            setTimeout(() => {
              selected.deactivate();
              this._performAction(action).then(() => {
                selected.activate();
                resolve();
              });
            }, 2000);
          }
          else if (actionType === 'attack') {
            // For counter-attacks, the attacker may differ from selected.
            let attacker = action.unit;

            // Show the player the units that will be attacked.
            let target = action.target;
            let target_tiles = attacker.getTargetTiles(target);
            let target_units = attacker.getTargetUnits(target);

            target_tiles.forEach(tile => {
              board.setHighlight(tile, {
                action: 'attack',
                color: ATTACK_TILE_COLOR,
              }, true);
            });

            if (target_units.length) {
              target_units.forEach(tu => tu.activate());

              if (target_units.length === 1) {
                attacker.setTargetNotice(target_units[0], target);
                this.drawCard(target_units[0]);
              }
              else
                this.drawCard(attacker);
            }

            // Only possible for counter-attacks
            if (selected !== attacker) {
              selected.deactivate();
              attacker.activate();
            }

            // Wait 2 seconds then attack.
            setTimeout(() => {
              target_units.forEach(tu => {
                tu.deactivate();
                tu.notice = null;
              });

              attacker.deactivate();
              this._performAction(action).then(() => {
                selected.activate();
                resolve();
              });
            }, 2000);
          }
          else if (actionType === 'turn') {
            // Show the direction the unit turned for 2 seconds.
            selected.deactivate();
            this._performAction(action).then(() => {
              board.showDirection(selected);
              selected.activate();
            });

            setTimeout(() => {
              board.hideTurnOptions();
              resolve();
            }, 2000);
          }
          // Only applicable to Chaos Seed/Dragon
          else if (actionType === 'phase') {
            // Show the user the egg for 1 second before changing color
            this.drawCard(action.unit);

            // Changing color takes about 1 second.
            setTimeout(() => this._performAction(action), 1000);

            // Show the user the new color for 1 second.
            setTimeout(resolve, 3000);
          }
          // Only applicable to Chaos Seed counter-attack
          else if (actionType === 'heal') {
            // Show the player the unit that will be healed.
            let target_unit = action.target.assigned;
            target_unit.activate();
            this.drawCard(target_unit);

            // Wait 1 second then attack.
            setTimeout(() => {
              target_unit.deactivate();

              this._performAction(action).then(resolve);
            }, 1000);
          }
          else {
            let attacker = action.unit;

            this.drawCard(attacker);
            attacker.activate();

            // Wait 2 seconds then do it.
            setTimeout(() => {
              attacker.deactivate();
              this._performAction(action).then(resolve);
            }, 2000);
          }
        });
      }),
      Promise.resolve(),
    );

    // Change a readonly lock to a full lock
    this.viewed = null;
    this.lock();

    return promise.then(() => {
      // If the action didn't result in ending the turn, then set mode.
      let lastAction = actions[actions.length-1];
      if (lastAction.type !== 'endTurn' && this.isMyTeam(lastAction.teamId)) {
        this.unlock();
        this.selected = actions[0].unit;
      }
      else
        // Change a full lock to a readonly lock
        this.lock('readonly');
    });
  }
  // Act out the action on the board.
  _performAction(action) {
    if (action.type === 'endTurn')
      return this._endTurn(action);
    else if (action.type === 'surrender') {
      if (this.winningTeams.length > 2)
        return this._playSurrender(action);
      return Promise.resolve();
    }

    let unit = action.unit;

    return unit[action.type](action)
      .then(() => this._playResults(action.results));
  }
  _showActions(actions = this.actions) {
    let board = this._board;
    let selected = this.selected;
    let degree = board.getDegree('N', board.rotation);
    let origin = this.state.units.flat().find(u => u.id === selected.id).assignment;

    board.setHighlight(board.getTileRotation(origin, degree), {
      action: 'focus',
      color: FOCUS_TILE_COLOR,
    }, true);

    actions.forEach(action => {
      if (action.unit !== selected) return;

      if (action.type === 'move')
        board.setHighlight(action.assignment, {
          action: 'move',
          color: MOVE_TILE_COLOR,
        }, true);
      else if (action.type === 'attack') {
        let target_tiles = selected.getTargetTiles(action.target);

        target_tiles.forEach(tile => {
          board.setHighlight(tile, {
            action: 'attack',
            color: ATTACK_TILE_COLOR,
          }, true);
        });
      }
    });
  }
  /*
   * Show the player the results of an attack
   */
  _playResults(results) {
    if (!results)
      return;
    if (!Array.isArray(results))
      results = [results];

    let showResult = result => {
      let anim = new Tactics.Animation();
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

      this.drawCard(unit);

      if (Object.keys(changes).length)
        unit.change(changes);
      if (result.results)
        this._applyChangeResults(result.results);

      anim.splice(this._animApplyFocusChanges(result));

      if (result.miss) {
        let notice = !result.luck && unit.directional === false
          ? 'Immune!' : 'Miss!';

        unit.change({ notice });
        let caption = result.notice || notice;
        return unit.animCaption(caption).play();
      }

      if ('focusing' in changes) {
        let caption = result.notice;
        if (caption)
          anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }

      if (changes.paralyzed) {
        let caption = result.notice || 'Paralyzed!';
        anim.splice(0, unit.animCaption(caption));

        return anim.play();
      }

      if (changes.poisoned) {
        let caption = result.notice || 'Poisoned!';
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
        else if (mHealth < unit.mHealth && mHealth !== -unit.health)
          options.color = '#FFBB44';

        let diff = unit.mHealth - mHealth;

        // Die if the unit is dead and isn't a hatching Chaos Seed
        if (mHealth === -unit.health && unit.name !== 'Chaos Seed' && unit.assignment) {
          let caption = result.notice || 'Nooo...';
          anim
            .splice(0, unit.animCaption(caption, options))
            .splice(unit.animDeath());
        }
        else {
          let caption = result.notice || Math.abs(diff).toString();
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
              repeat: 4,
            },
          ]);
        }

        return anim.play();
      }
    };

    return results.reduce(
      (promise, result) => promise
        .then(() => showResult(result))
        .then(() => {
          let unit = result.unit;
          if (unit) unit.change({notice: null});
        }),
      Promise.resolve(),
    ).then(() => this.drawCard());
  }
  _playSurrender(action) {
    let team = this.teams[action.teamId];
    let anim = new Tactics.Animation();
    let notice = `${team.name}\nSurrenders!`;

    anim.addFrame(() => this.notice = notice);

    action.results.forEach(result => {
      let unit = result.unit;

      anim.splice(0, unit.animDeath());
    });

    // Show the notice for 2 seconds.
    let timeout = 2000 - (anim.frames.length * anim.fps);

    return anim.play().then(() => new Promise((resolve, reject) => {
      // Give the user some time to take in the notice.
      setTimeout(() => {
        this.notice = null;
        resolve();
      }, timeout);
    }));
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

  /*
   * Play back all activity leading up to this point.
   *
   * FIXME: Race condition where the player reverts actions.
   */
  async _replay(stopTurnId, stopActionId) {
    let state = this.state;
    let teams = this._teams;
    let turnId = Math.max(0, stopTurnId - (teams.length-1));
    let turnData = await state.getTurnData(turnId);
    let actions = turnData.actions;

    this._board.setState(turnData.units, teams);
    this.render();
    await sleep(1000);

    do {
      if (turnId === stopTurnId) {
        await this._performActions(actions.slice(0, stopActionId));
        break;
      }

      await this._performActions(actions);
      actions = await state.getTurnActions(++turnId);
    } while (turnId <= stopTurnId);
  }
  _startTurn(teamId = this.state.currentTeamId) {
    // conditionally set, or unset, the timeout
    this._setTurnTimeout();

    let teams = this.teams;
    let team = teams[teamId];
    let teamMoniker;

    if (team.name && teams.filter(t => t.name === team.name).length === 1)
      teamMoniker = team.name;
    else
      teamMoniker = team.colorId;

    if (this.isMyTeam(team)) {
      if (this.hasOneLocalTeam()) {
        this.notice = 'Your Turn!';
        Tactics.sounds.newturn.play();
      }
      else
        this.notice = `Go ${teamMoniker}!`;

      this.selectMode = this._pickSelectMode();
      this.unlock();
    }
    else {
      this.delayNotice(`Go ${teamMoniker}!`);
      this.lock('readonly');
    }

    this._emit({
      type: 'startTurn',
      teamId: teamId,
    });

    return this;
  }
  _endTurn(action) {
    // Assuming control of a bot team is specific to the chaos game type.
    if (this.state.type === 'chaos')
      if ('newPlayerTeam' in action) {
        let newPlayerTeam = this.teams[action.newPlayerTeam];
        this._localTeamIds.push(newPlayerTeam.originalId);
      }

    this._applyChangeResults(action.results);

    // Get the new board state to keep track of a unit's origin next turn.
    this.state.units = this._board.getState();

    return this;
  }
  _endGame(winnerId) {
    clearTimeout(this._turnTimeout);
    this._turnTimeout = null;

    if (winnerId === null) {
      this.notice = 'Draw!';

      Tactics.sounds.defeat.play();
    }
    else {
      let teams = this.teams;
      let winner = teams[winnerId];
      let winnerMoniker;

      if (winner.name && teams.filter(t => t.name === winner.name).length === 1)
        winnerMoniker = winner.name;
      else
        winnerMoniker = winner.colorId;

      if (this.hasOneLocalTeam(winner))
        this.notice = 'You win!';
      else
        this.notice = `${winnerMoniker}!`;

      if (this.isMyTeam(winnerId))
        Tactics.sounds.victory.play();
      else
        Tactics.sounds.defeat.play();
    }

    this.selected = null;
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
    if (state.ended)
      return;
    if (this.isViewOnly)
      return;

    if (typeof this._turnTimeout === 'number') {
      clearTimeout(this._turnTimeout);
      this._turnTimeout = null;
    }

    let timeout = Infinity;

    if (!this.isMyTurn) {
      let now = new Date();
      let lastAction = state.actions.last;
      let lastActionAt = lastAction ? lastAction.created.getTime() : 0;
      let actionTimeout = (lastActionAt + 10000) - now;
      let turnTimeout = (state.turnStarted.getTime() + state.turnTimeLimit*1000) - now;

      timeout = Math.max(actionTimeout, turnTimeout);
    }

    if (timeout > 0) {
      if (this._turnTimeout === true) {
        this._emit({ type:'cancelTimeout' });
        this._turnTimeout = null;
      }

      // Value must be less than a 32-bit signed integer.
      if (timeout < 0x80000000)
        this._turnTimeout = setTimeout(() => {
          if (state.ended) return;

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

    this._applyChangeResults(action.results);

    // Remove dead units.
    board.teamsUnits.flat().forEach(unit => {
      // Chaos Seed doesn't die.  It hatches.
      if (unit.type === 'ChaosSeed') return;

      if (unit.mHealth === -unit.health)
        board.dropUnit(unit);
    });
  }
  _applyChangeResults(results) {
    if (!results) return;

    results.forEach(result => {
      let unit    = result.unit;
      let changes = result.changes;

      if (changes) {
        if (changes.direction)
          unit.stand(changes.direction);

        unit.change(result.changes);
      }

      if (result.results)
        this._applyChangeResults(result.results);
    });
  }
  _animApplyFocusChanges(result) {
    let anim       = new Tactics.Animation();
    let unit       = result.unit;
    let hasFocus   = unit.hasFocus();
    let needsFocus = unit.focusing || unit.paralyzed || unit.poisoned;

    if (!hasFocus && needsFocus)
      anim.splice(0, unit.animFocus(0.5));
    else if (hasFocus && !needsFocus)
      anim.splice(0, unit.animDefocus());

    if (result.results)
      result.results.forEach(result => anim.splice(0, this._animApplyFocusChanges(result)));

    return anim;
  }

  /*
   * This method ensures state events are processed synchronously.
   * Otherwise, 'startTurn' or 'endGame' may trigger while performing actions.
   */
  _onStateEvent({ type, data }) {
    // Event handlers are expected to either return a promise that resolves when
    // handling is complete or nothing at all.
    let eventHandler;
    if (type === 'startTurn')
      eventHandler = () => this._startTurn(data.teamId);
    else if (type === 'action')
      eventHandler = () => {
        this._setTurnTimeout();
        return this._performActions(data);
      };
    else if (type === 'revert')
      eventHandler = () => this._revert(data);
    else if (type === 'undoRequest')
      eventHandler = () => this._emit({ type, data });
    else if (type === 'undoAccept')
      eventHandler = () => this._emit({ type, data });
    else if (type === 'undoReject')
      eventHandler = () => this._emit({ type, data });
    else if (type === 'undoCancel')
      eventHandler = () => this._emit({ type, data });
    else if (type === 'undoComplete')
      eventHandler = () => this._emit({ type, data });
    else if (type === 'endGame')
      eventHandler = () => this._endGame(data.winnerId);

    this._stateEventStack = this._stateEventStack.then(eventHandler);
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
