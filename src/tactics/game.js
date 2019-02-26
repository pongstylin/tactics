'use strict';

import { EventEmitter } from 'events';
import { PanZoom } from 'util/panzoom.js';

const DEFAULT_PROPERTIES = {
  _rendering: false,
  _animators: {},

  _history:       [],
  _currentTeamId: 0,
  _units:         [],
  _actions:       [],

  _selectMode: 'move',
  _tranformToRestore: null,

  _notice: null,
  _board: null,
};

export class Game {
  constructor(data) {
    this._data = data;

    Object.assign(this, DEFAULT_PROPERTIES);

    /*
     * Crude tracking of the pointer type being used.  Ideally, this should
     * reflect the last pointer type to fire an event on the board.
     */
    if ('ontouchstart' in window)
      this.pointerType = 'touch';
    else
      this.pointerType = 'mouse';

    this._renderer = PIXI.autoDetectRenderer(Tactics.width, Tactics.height);
    this._canvas   = this._renderer.view;
    this._stage    = new PIXI.Container();
    this._panzoom  = PanZoom({
      target: this._canvas,
      locked: true,
    });

    // Let's not go crazy with the move events.
    this._renderer.plugins.interaction.moveWhenInside = true;

    Tactics.game = this;

    this._board = new Tactics.Board();
    this._board
      .on('focus', event => {
        Tactics.sounds.focus.play();
        this.focused = event.unit;
      })
      .on('blur', event => {
        this.focused = null;
      })
      .on('select', event => {
        let unit = event.unit;

        Tactics.sounds.select.play();
        if (this.canSelect(unit))
          this.selected = unit;
        else
          this.viewed = unit;
      })
      .on('deselect', () => {
        if (this.viewed)
          this.viewed = null;
        else if (this.selected && !this._actions.length && this._selectMode !== 'target')
          this.selected = null;
      })
      // 'move' and 'attack' events do not yet come from the board.
      .on('move',    event => this.takeAction(event))
      .on('attack',  event => this.takeAction(event))
      .on('turn',    event => this.takeAction(event))
      .on('endTurn', event => this.takeAction(event))
      .on('card-change', event => this._emit(event))
      .on('lock-change', event => this._emit(event));

    this._emitter = new EventEmitter();
  }

  /*****************************************************************************
   * Public Properties
   ****************************************************************************/
  get card() {
    return this._board.card;
  }
  get canvas() {
    return this._canvas;
  }

  get stage() {
    return this._stage;
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
        this.selectMode = this._pickSelectMode();
      }
      else
        this.selectMode = 'move';

      this.drawCard();
    }
    else if (old_viewed) {
      board.hideMode();
      old_viewed.deactivate();
      board.viewed = null;

      this.selectMode = selected.activated;
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
      if (old_viewed) {
        board.hideMode();
        old_viewed.deactivate();
        board.viewed = null;
      }

      let selected = board.selected;

      if (viewed) {
        board.viewed = viewed;
        this.selectMode = this._pickSelectMode();
      }
      else
        this.selectMode = selected ? selected.activated : 'move';

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

    let team     = this.currentTeam;
    let board    = this._board;
    let selected = board.selected;
    let viewed   = board.viewed;

    if (viewed)
      if (!team.bot)
        viewed.activate(selectMode, true);
      else
        viewed.activate();
    else if (selected)
      if (!team.bot)
        selected.activate(selectMode);
      else
        selected.activate();

    // I got tired of seeing button borders and glow changes during bot turns.
    if (!team.bot)
      this._emit({
        type:   'selectMode-change',
        ovalue: this._selectMode,
        nvalue: selectMode,
      });

    this._selectMode = selectMode;
    board.showMode();
    this.render();

    return this;
  }

  get teams() {
    return this._teams;
  }
  get activeTeams() {
    return this._teams.filter(team => !!team.units.length);
  }

  get currentTeamId() {
    return this._currentTeamId;
  }
  get currentTeam() {
    return this._teams[this._currentTeamId];
  }

  get moved() {
    return !!this._actions
      .find(a => a.type === 'move');
  }
  get attacked() {
    return !!this._actions
      .find(a => a.type === 'attack' || a.type === 'attackSpecial');
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  /*
   * Allow touch devices to upscale to normal size.
   */
  resize() {
    let canvas = this._canvas;
    canvas.style.width  = null;
    canvas.style.height = null;

    let container = canvas.parentNode;
    let width     = container.clientWidth;
    let height    = container.clientHeight;

    if (window.innerHeight < height) {
      let rect = canvas.getBoundingClientRect();

      height  = window.innerHeight;
      height -= rect.top;
      //height -= window.innerHeight - rect.bottom;
      //console.log(window.innerHeight, rect.bottom);
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

  load() {
    let resources = [];
    let loaded = 0;
    let loader = PIXI.loader;
    let loadedUnitTypes = [];
    let effects = {};

    let progress = () => {
      let percent = (++loaded / resources.length) * 100;

      if (percent === 100) {
        this._board.draw(this._stage);

        // Preload the Trophy data URLs
        let trophy = new Tactics.Unit(19);
        trophy.drawAvatar();
      }

      this._emit({
        type: 'progress',
        percent: percent,
      });
    };

    Tactics.images.forEach(image_url => {
      let url = 'https://legacy.taorankings.com/images/'+image_url;

      resources.push(url);
      loader.add({url: url});
    });

    Object.keys(Tactics.sounds).forEach(name => {
      let sound = Tactics.sounds[name];
      if (typeof sound === 'string')
        sound = {file: sound};

      let url = 'https://tactics.taorankings.com/sounds/'+sound.file;

      Tactics.sounds[name] = new Howl({
        src:        [url+'.mp3', url+'.ogg'],
        sprite:      sound.sprite,
        volume:      sound.volume || 1,
        rate:        sound.rate || 1,
        onload:      () => progress(),
        onloaderror: () => {},
      });

      resources.push(url);
    });

    Object.keys(Tactics.effects).forEach(name => {
      let effect_url = Tactics.effects[name].frames_url;

      if (!(effect_url in effects)) {
        resources.push(effect_url);

        effects[effect_url] = $.getJSON(effect_url).then(renderData => {
          progress();
          return renderData;
        });
      }
  
      effects[effect_url].then(renderData => {
        Object.assign(Tactics.effects[name], renderData);
        return renderData;
      });
    });

    let trophy_url = Tactics.units[19].frames_url;
    resources.push(trophy_url);

    $.getJSON(trophy_url).then(renderData => {
      Object.assign(Tactics.units[19], renderData);
      progress();
    });

    this._data.teams.forEach(team => {
      let unitsData = team.units.slice();

      // The Chaos Dragon is not yet a member of a team, but must be loaded.
      if (team.name === 'Chaos')
        unitsData.push({type:'ChaosDragon'});

      unitsData.forEach(unitData => {
        let unitType = unitData.type;
        let unitId   = Tactics.units.findIndex(u => u.name.replace(/ /g, '') === unitType);
        let unit     = Tactics.units[unitId];
        let sprites  = [];

        if (loadedUnitTypes.indexOf(unitType) > -1)
          return;
        loadedUnitTypes.push(unitType);

        if (unit.sounds) {
          Object.keys(unit.sounds).forEach(name => {
            let sound = unit.sounds[name];
            if (typeof sound === 'string')
              sound = {file: sound};

            let url = 'https://tactics.taorankings.com/sounds/'+sound.file;

            unit.sounds[name] = new Howl({
              src:        [url+'.mp3', url+'.ogg'],
              sprite:      sound.sprite,
              volume:      sound.volume || 1,
              rate:        sound.rate || 1,
              onload:      () => progress(),
              onloaderror: () => {},
            });

            resources.push(url);
          });
        }

        if (unit.effects) {
          Object.keys(unit.effects).forEach(name => {
            let effect_url = unit.effects[name].frames_url;

            if (!(effect_url in effects)) {
              resources.push(effect_url);

              effects[effect_url] = $.getJSON(effect_url).then(renderData => {
                progress();
                return renderData;
              });
            }
  
            effects[effect_url].then(renderData => {
              Object.assign(unit.effects[name], renderData);
              return renderData;
            });
          });
        }

        if (unit.frames_url) {
          let frames_url = unit.frames_url;
          resources.push(frames_url);

          $.getJSON(frames_url).then(renderData => {
            Object.assign(unit, renderData);
            progress();
          });
        }
        // Legacy
        else if (unit.frames) {
          unit.frames.forEach(frame => {
            if (!frame) return;

            frame.c.forEach(sprite => {
              let url = 'https://legacy.taorankings.com/units/'+unitId+'/image'+sprite.id+'.png';
              if (resources.indexOf(url) !== -1)
                return;

              resources.push(url);
              loader.add({url: url});
            });
          });
        }
        // Legacy
        else {
          sprites.push.apply(sprites, Object.values(unit.stills));

          if (unit.walks)
            sprites.push.apply(sprites, [].concat.apply([], Object.values(unit.walks)));

          if (unit.attacks)
            sprites.push.apply(sprites, [].concat.apply([], Object.values(unit.attacks)));

          if (unit.blocks)
            sprites.push.apply(sprites, [].concat.apply([], Object.values(unit.blocks)));

          sprites.forEach(sprite => {
            Object.keys(sprite).forEach(name => {
              let image = sprite[name];
              if (!image.src) return;

              let url = 'https://legacy.taorankings.com/units/'+unitId+'/'+name+'/image'+image.src+'.png';
              if (resources.indexOf(url) !== -1)
                return;

              resources.push(url);
              loader.add({url: url});
            });
          });
        }
      });
    });

    loader
      .on('progress',progress)
      .load();
  }
  randomStart() {
    let teams = this._data.teams;

    if (teams.length === 5) {
      // Chaos should always go first.
      let teamChaos = teams.shift();
      teams.spin();
      teams.unshift(teamChaos);
    }
    else
      teams.spin();

    return this.start();
  }
  start() {
    return new Promise((resolve, reject) => {
      // Let the caller finish what they are doing.
      setTimeout(() => {
        this._teams = this._data.teams.map((team, id) =>
          Object.assign({}, team, {
            id:          id,
            bot:         team.bot ? new Tactics.Bot(team.bot) : null,
            units:       [], // this._board.setState() replaces this property.
            passedTurns: 0,
          })
        );

        // Reset game and turn state
        this._history       = [];
        this._currentTeamId = 0;
        this._units         = this._data.teams.map(t => t.units);
        this._actions       = [];

        this._board.setState(this._units, this._teams);
        this._startTurn();

        // Allow data URI's to load
        setTimeout(() => {
          this.render();
          resolve();
        });
      }, 100); // A "zero" delay is sometimes not long enough
    });
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
    if (selected && selected !== unit && this._actions.length)
      return false;

    return unit.team.id === this._currentTeamId && !unit.mRecovery && !unit.paralyzed;
  }

  /*
   * Can a select mode be selected for the currently viewed or selected unit?
   */
  canSelectMove() {
    let viewed = this.viewed;
    if (viewed)
      return !!viewed.getMoveTiles().length;

    let selected = this.selected;
    if (selected)
      return !this.moved && selected.getMoveTiles().length;

    return true;
  }
  canSelectAttack() {
    let viewed = this.viewed;
    if (viewed)
      return !!viewed.getAttackTiles().length;

    let selected = this.selected;
    if (selected)
      return !this.attacked && selected.getAttackTiles().length;

    return true;
  }
  canSelectSpecial() {
    let selected = this.selected;
    if (selected)
      return selected.canSpecial();

    return false;
  }
  canSelectTurn() {
    let unit = this.viewed || this.selected;
    if (unit)
      return unit.directional !== false;

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
        this.takeAction({type:'attackSpecial'});
    };

    // For the sake of all that's holy, don't attack even if ready!
    promise.cancel = () => anim.stop();

    return promise;
  }

  /*
   * Initiate an action, whether it be moving, attacking, turning, or passing.
   */
  takeAction(action) {
    let team     = this.currentTeam;
    let selected = this.selected;

    if (selected) {
      this._board.clearMode();
      selected.deactivate();

      if (!action.type.startsWith('end'))
        action.unit = selected.assignment;
    }

    this.lock();
    return this._submitActions([action]).then(actions => {
      let promise = actions.reduce(
        (promise, action) => promise.then(() => this._performAction(action)),
        Promise.resolve(),
      );

      // If the action didn't result in ending the turn or game, then set mode.
      if (!actions.length || !actions[actions.length-1].type.startsWith('end'))
        if (!team.bot)
          promise = promise.then(() => {
            // The board must be unlocked before selecting a mode.
            // Otherwise, attempts to draw a card (e.g. to show a target) will be reset.
            this.unlock();
            this.selectMode = this._pickSelectMode();
          });

      return promise.then(() => actions);
    });
  }

  pass() {
    this.viewed = null;
    this._board.eraseCard();

    this.takeAction({type:'endTurn'});
  }

  pushHistory() {
    // If any units are selected or viewed, deactivate them.
    this.viewed = this.selected = null;

    this._history.push(JSON.stringify({
      teamId:  this._currentTeamId,
      units:   this._units,
      actions: this._actions,
    }));

    this._currentTeamId = this._teams.getNextIndex(this._currentTeamId, team => !!team.units.length);
    this._units         = this._board.getState();
    this._actions       = [];

    return this;
  }
  popHistory() {
    let history = this._history;
    if (history.length === 0) return;

    // If any units are selected or viewed, deactivate them.
    this.viewed = this.selected = null;

    let turnData = JSON.parse(history.pop());

    Object.assign(this, {
      _currentTeamId: turnData.teamId,
      _units:         turnData.units,
      _actions:       [],
    });

    // Recalculate passed turn count for the team that popped a turn.
    let team = this.currentTeam;
    team.passedTurns = 0;

    for (let i = history.length-1; i > -1; i--) {
      if (history[i].teamId !== team.id)
        continue;

      // Stop searching once an action is made (aside from endTurn or endGame).
      if (history[i].actions.length > 1)
        break;

      team.passedTurns++;

      // Stop searching once 2 passed turns are detected.
      if (team.passedTurns === 2)
        break;
    }

    return this._board.setState(this._units, this._teams);
  }

  resetTurn() {
    this.viewed = this.selected = null;

    this._board.setState(this._units, this._teams);
    this._actions.length = 0;
  }

  canUndo() {
    let teams   = this._teams;
    let actions = this._actions;

    if (teams.length === 2 && !teams[0].bot && !teams[1].bot)
      return !!actions.length || !!this._history.length;
    else {
      if (actions.length === 0) return false;

      let lastLuckyActionIndex = actions.findLastIndex(action =>
        action.results && !!action.results.find(result => 'luck' in result)
      );

      return lastLuckyActionIndex < (actions.length - 1);
    }

    return false;
  }
  undo() {
    let teams   = this._teams;
    let actions = this._actions;

    if (teams.length === 2 && !teams[0].bot && !teams[1].bot) {
      // Be very permissive for the classic app
      if (actions.length)
        this.resetTurn();
      else
        this.popHistory();

      this._startTurn();
    }
    else {
      // Only undo actions that did not involve luck.
      if (actions.length === 0) return;

      let lastLuckyActionIndex = actions.findLastIndex(action =>
        action.results && !!action.results.find(result => 'luck' in result)
      );

      if (lastLuckyActionIndex === (actions.length - 1))
        return;

      // Re-apply actions that required luck.
      let luckyActions = actions.slice(0, lastLuckyActionIndex + 1);

      // Reset all actions.
      this.resetTurn();

      if (luckyActions.length) {
        luckyActions.forEach(action => {
          let unit = action.unit.assigned;

          actions.push(action);

          if (action.type === 'move')
            unit.assign(action.tile);

          this._applyChangeResults(action.results);
        });

        this.selected = actions[0].unit.assigned;
      }
    }

    this.render();
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
   * Exclusively used by the Chaos Seed/Dragon
   ****************************************************************************/
  _calcTeams() {
    let choices = [];

    this.activeTeams.forEach(team => {
      if (team.name === 'Chaos') return;

      let thp = 50 * 3;
      let chp = 0;

      team.units.forEach(unit => chp += unit.health + unit.mHealth);

      choices.push({
        id:     team.id,
        score:  chp / thp,
        random: Math.random(),
      });
    });

    return choices;
  }
  getWinningTeams() {
    let teams = this._calcTeams();

    teams.sort((a, b) => (b.score - a.score) || (b.size - a.size) || (a.random - b.random));

    return teams;
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _render() {
    let renderer = this._renderer;

    this._board.sortUnits();

    // This is a hammer.  Without it, the mouse cursor will not change to a
    // pointer and back when needed without moving the mouse.
    renderer.plugins.interaction.update();

    renderer.render(this._stage);
    this._rendering = false;
  }

  // This will ultimately call a server, when appropriate.
  _submitActions(actions) {
    return Promise.resolve(this._validateActions(actions));
  }

  _validateActions(actions) {
    let validated = [];
    let selected;
    let moved     = this.moved;
    let attacked  = this.attacked;
    let turned    = false;

    let firstUnitAction = this._actions.find(a => 'unit' in a);
    if (firstUnitAction)
      selected = firstUnitAction.unit.assigned;

    // Watch unit changes to detect endTurn and endGame events.
    let unitWatch = [];

    // Validate actions until we find an endTurn event.
    let turnEnded = !!actions.find(action => {
      if (action.type === 'endTurn') {
        action.results = this._getEndTurnResults(unitWatch, moved, attacked);
        validated.push(action);
        return true;
      }

      /*
       * Validate and populate the action
       */
      let unit = action.unit.assigned;

      // Only the first unit to take action may take another.
      if (selected && unit !== selected) return;

      // Recovering or paralyzed units can't take action.
      if (unit.mRecovery || unit.paralyzed) return;

      // Apply unit-specific validation and determine results.
      action = unit.validateAction(action);
      if (!action) return;

      // Prevent multiple actions of a type within a turn.
      if      (action.type === 'move'          && moved   ) return;
      else if (action.type === 'attack'        && attacked) return;
      else if (action.type === 'attackSpecial' && attacked) return;

      // Focusing units must break focus before taking action.
      if (unit.focusing)
        validated.push({
          type:    'breakFocus',
          unit:    unit.assignment,
          results: unit.getBreakFocusResults(),
        });

      validated.push(action);

      if (!selected)
        selected = unit;

      if (action.type === 'move')
        moved = true;
      else if (action.type === 'attack' || action.type === 'attackSpecial')
        attacked = true;
      else if (action.type === 'turn')
        turned = true;

      /*
       * Keep track of unit status changes that can trigger end turn or game.
       */
      let watchChanges = results => results.forEach(result => {
        let subResults = result.results || [];

        let changes = result.changes;
        if (!changes) return watchChanges(subResults);

        let unit  = result.unit.assigned;
        let watch = unitWatch.find(uw => uw.unit === unit);
        if (!watch)
          unitWatch.push(watch = {
            unit:      unit,
            mHealth:   unit.mHealth,
            focusing:  unit.focusing,
            paralyzed: unit.paralyzed,
          });

        // Dead units can cause the turn or game to end.
        if ('mHealth' in changes)
          watch.mHealth = changes.mHealth;

        // Focusing units can cause the turn to end.
        if ('focusing' in changes)
          watch.focusing = changes.focusing;

        // Paralyzed units can cause the game to end.
        if ('paralyzed' in changes)
          watch.paralyzed = changes.paralyzed;

        watchChanges(subResults);
      });

      if (action.results)
        watchChanges(action.results);

      // A turn action immediately ends the turn.
      if (action.type === 'turn') {
        validated.push({
          type:    'endTurn',
          results: this._getEndTurnResults(unitWatch, moved, attacked),
        });
        return true;
      }

      /*
       * If the selected unit is unable to continue, end the turn early.
       *   1) Pyromancer killed himself.
       *   2) Knight attacked Chaos Seed and killed by counter-attack.
       *   3) Assassin blew herself up.
       *   4) Enchantress paralyzed at least 1 unit.
       */
      if (action.type === 'attack' || action.type === 'attackSpecial') {
        let endTurn = () => {
          let watch = unitWatch.find(uw => uw.unit === selected);
          if (!watch || (watch.mHealth > -selected.health && !watch.focusing))
            return;

          validated.push({
            type:    'endTurn',
            results: this._getEndTurnResults(unitWatch, moved, attacked),
          });

          return true;
        };

        if (endTurn())
          return true;

        // Can any victims counter-attack?
        return action.results.find(result => {
          let unit = result.unit.assigned;
          if (!unit.canCounter()) return;

          let counterAction = unit.getCounterAction(action.unit.assigned, result);
          if (!counterAction) return;

          validated.push(counterAction);

          watchChanges(counterAction.results);

          return endTurn();
        });
      }
    });

    if (turnEnded) {
      let currentTeam = this.currentTeam;
      if (moved || attacked || turned)
        currentTeam.passedTurns = 0;
      else
        currentTeam.passedTurns++;

      // Team Chaos needs a chance to phase before ending their turn.
      if (currentTeam.name === 'Chaos') {
        let action = {
          type: 'phase',
          unit: currentTeam.units[0].assignment,
        };

        validated.splice(validated.length-1, 0, action);
      }
    }

    // Determine if the game has ended.
    let teams = this.activeTeams;
    let totalPassedTurns = teams.reduce(
      (sum, team) => sum + Math.min(3, team.passedTurns),
      0,
    );
    let winners;

    if (totalPassedTurns === (teams.length * 3))
      // All teams passed at least 3 times, draw!
      winners = [];
    else
      // Find teams that has a unit that keeps it alive.
      winners = teams.filter(team =>
        !!team.units.find(unit => {
          // Wards don't count.
          if (unit.type === 4 || unit.type === 5)
            return false;

          let watch = unitWatch.find(uw => uw.unit === unit);
          if (!watch)
            watch = {
              mHealth:   unit.mHealth,
              focusing:  unit.focusing,
              paralyzed: unit.paralyzed,
            };

          // Dead units don't count.
          if (watch.mHealth <= -unit.health)
            return false;

          // Paralyzed units don't count.
          if (watch.paralyzed)
            return false;

          return true;
        })
      );

    let endGame;
    if (winners.length === 0)
      endGame = {
        type: 'endGame',
      };
    else if (winners.length === 1)
      endGame = {
        type: 'endGame',
        winnerId: winners[0].id,
      };

    if (endGame)
      if (turnEnded)
        // Replace the endTurn event with an endGame event.
        validated[validated.length-1] = endGame;
      else
        validated.push(endGame);

    return validated;
  }

  // Act out the action on the board.
  _performAction(action) {
    this._actions.push(action);

    if (action.type === 'endTurn')
      return this._endTurn(action);
    else if (action.type === 'endGame')
      return this._endGame(action);

    let unit = action.unit.assigned;

    return unit[action.type](action)
      .then(() => this._playResults(action.results));
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
      let unit = result.unit.assigned;

      // This can happen when the Chaos Seed hatches and consumes the unit.
      if (!unit) return;

      this.drawCard(unit);

      let changes = Object.assign({}, result.changes);

      // Changed separately
      let mHealth = changes.mHealth;
      delete changes.mHealth;

      unit.change(changes);
      if (result.results)
        this._applyChangeResults(result.results);

      anim.splice(this._animApplyFocusChanges(result));

      if (result.miss) {
        unit.change({notice: 'Miss!'});
        let caption = result.notice || 'Miss!';
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

      if (mHealth !== undefined) {
        let increment;
        let options = {};

        if (mHealth > unit.mHealth)
          options.color = '#00FF00';
        else if (mHealth < unit.mHealth && mHealth !== -unit.health)
          options.color = '#FFBB44';

        let diff = unit.mHealth - mHealth;

        // Die if the unit is dead.
        if (mHealth === -unit.health && unit.type !== 15) {
          let caption = result.notice || (unit.paralyzed ? '.......' : 'Nooo...');
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
      (promise, result) => promise.then(() =>
        showResult(result))
          .then(() => {
            let unit = result.unit.assigned;
            if (unit) unit.change({notice: null});
          }),
      Promise.resolve(),
    ).then(() => this.drawCard());
  }

  /*
   * End turn results include:
   *   The selected unit mRecovery is incremented based on their actions.
   *   Other units' mRecovery on the outgoing team is decremented.
   *   All units' mBlocking are reduced by 20% per turn cycle.
   */
  _getEndTurnResults(unitWatch, moved, attacked) {
    let selected    = this.selected;
    let teams       = this.activeTeams;
    let currentTeam = this.currentTeam;
    let results     = [];

    // Per turn mBlocking decay rate is based on the number of active teams.
    // It is calculated such that a full turn cycle is still a 20% reduction.
    let decay = teams.length;

    teams.forEach(team => {
      team.units.forEach(unit => {
        // Skip units that are about to die.
        let watch = unitWatch.find(uw => uw.unit === unit);
        if (watch && watch.mHealth === -unit.health) return;

        // Adjust recovery for the outgoing team.
        if (team === currentTeam) {
          let mRecovery;
          if (unit === selected) {
            let recovery = selected.recovery;

            if (moved && attacked)
              mRecovery = recovery;
            else if (moved)
              mRecovery = Math.floor(recovery / 2);
            else if (attacked)
              mRecovery = Math.ceil(recovery / 2);

            if (mRecovery === 0)
              mRecovery = undefined;
          }
          else if (unit.mRecovery)
            mRecovery = unit.mRecovery - 1;

          if (mRecovery !== undefined)
            results.push({
              unit:    unit.assignment,
              changes: { mRecovery:mRecovery },
            });
        }

        // Decay blocking modifiers for all applicable units
        if (unit.mBlocking) {
          let mBlocking = unit.mBlocking * (1 - 0.2/decay);
          if (Math.abs(mBlocking) < 2) mBlocking = 0;

          results.push({
            unit:    unit.assignment,
            changes: { mBlocking:mBlocking },
          });
        }
      });
    });

    return results;
  }

  _startTurn() {
    let team = this.currentTeam;

    if (team.bot) {
      this.lock();

      // Give the page a chance to render the effect of locking the board.
      setTimeout(() => team.bot.startTurn(team));
    }
    else {
      if (team.name)
        this._notice = 'Go '+team.name+" team!";
      else
        this._notice = 'Your Turn!';

      this.selectMode = 'move';
      this.unlock();
      this.drawCard();
    }

    return this;
  }
  _endTurn(action) {
    this._notice = null;
    this._applyChangeResults(action.results);

    // If the player team was killed, he can take over for a bot team.
    // This behavior is restricted to the Chaos app.
    if (this._teams.length === 5) {
      let playerTeam = this._teams.find(t => t.bot === null);
      if (playerTeam.units.length === 0) {
        let botTeam = this.activeTeams.filter(t => t.name !== 'Chaos').random();
        botTeam.bot = null;
      }
    }

    this.pushHistory();
    this._startTurn();

    return this;
  }
  _endGame(action) {
    let winner = this._teams[action.winnerId];
    if (winner) {
      if (winner.name === null)
        this._notice = 'You win!';
      else
        this._notice = winner.name+' Wins!';
    }
    else
      this._notice = 'Draw!';

    this.pushHistory();
    this.lock('gameover');
    this.drawCard();

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
    if (selectMode === null || can.indexOf(selectMode) === -1)
      selectMode = can.shift();

    return selectMode;
  }

  _applyAction(action) {
    let unit = action.unit.assigned;

    if (action.type === 'move')
      unit.assign(action.tile);
    if (action.direction)
      unit.direction = action.direction;

    this._applyChangeResults(action.results);
  }
  _applyChangeResults(results) {
    if (!results) return;

    results.forEach(result => {
      let unit    = result.unit.assigned;
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
    let unit       = result.unit.assigned;
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

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
