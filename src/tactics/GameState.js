'use strict';

import EventEmitter from 'events';
import Board from 'tactics/Board.js';
import botFactory from 'tactics/botFactory.js';
import colorMap from 'tactics/colorMap.js';
import unitsData, { unitTypeToIDMap } from 'tactics/unitsData.js';

export default class GameState {
  /*****************************************************************************
   * Constructors
   ****************************************************************************/
  /*
   * The default constructor is intended for internal use only.
   */
  constructor(gameData) {
    let board = new Board();
    let history = gameData.history || [];
    delete gameData.history;

    Object.assign(this, gameData, {
      winnerId: null,

      _history: history,
      _board:   board,
      _emitter: new EventEmitter(),
    });

    if (this.units)
      board.setState(this.units, this.teams);

    this.whenReady = new Promise(resolve => { this._ready = resolve });
  }

  /*
   * This constructor must be used to create NEW games.
   *
   * At the minimum, a teams array must be provided with at least 2 elements.
   * The elements of the teams array may be blank with the expectation that they
   * will be filled later via the 'join' method.  Once all team slots are
   * filled, the game is started.
   */
  static create(gameData) {
    if (!gameData || !gameData.teams || gameData.teams.length < 2)
      throw new TypeError('Required teams length');

    let teams = gameData.teams;
    delete gameData.teams;

    gameData = Object.assign(
      // These settings may be overwritten
      {
        randomFirstTurn: true,
      },
      gameData,
      {
        created:  new Date(),
        started:  null,
        ended:    null,
        teams:    new Array(teams.length),
        units:    [],
        _actions: [],
      }
    );

    let gameState = new GameState(gameData);

    teams.forEach((team, slot) => {
      if (team) gameState.join(team, slot);
    });

    return gameState;
  }

  /*
   * This constructor must be used to load EXISTING games.
   *
   * The existing game may or may not have been started yet.
   */
  static load(gameData) {
    let state = new GameState(gameData);

    if (typeof gameData.created === 'string')
      gameData.created = new Date(gameData.created);
    if (typeof gameData.started === 'string')
      gameData.started = new Date(gameData.started);
    if (typeof gameData.ended === 'string')
      gameData.ended = new Date(gameData.ended);

    if (gameData.started)
      state._ready();

    return state;
  }

  /*****************************************************************************
   * Public Property Accessors
   ****************************************************************************/
  get board() {
    return this._board;
  }
  get currentTurnId() {
    return this._history.length;
  }
  get currentTeamId() {
    return this.currentTurnId % this.teams.length;
  }
  get currentTeam() {
    return this.teams[this.currentTeamId];
  }
  get activeTeams() {
    return this.teams.filter(t => !!t.units.length);
  }
  get winningTeams() {
    return this.teams.filter(team =>
      !!team.units.find(unit => {
        // Wards don't count.
        if (unit.type === 4 || unit.type === 5)
          return false;

        // Paralyzed units don't count.
        if (unit.paralyzed)
          return false;

        return true;
      })
    );
  }

  get selected() {
    let firstUnitAction = this._actions.find(a => 'unit' in a);
    return firstUnitAction && firstUnitAction.unit;
  }

  get actions() {
    return this._board.encodeAction(this._actions);
  }
  get moved() {
    return !!this._actions.find(a => a.type === 'move');
  }
  get attacked() {
    return !!this._actions.find(a => a.type === 'attack' || a.type === 'attackSpecial');
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  /* Add a team to the game.
   *
   * Arguments:
   *  team = Team Object
   *  slot = (optional) slot Number
   *
   * Team Object Example:
   *  {
   *    // The name of the team.  Typically the name of the player.
   *    name: TeamName,
   *
   *    // The team color represented as a number, e.g. 0xFF0000.
   *    // May be automatically assigned or reassigned.
   *    color: TeamColor,
   *
   *    // List of Units
   *    set: [
   *      {
   *        // Type of Unit, e.g. DarkMagicWitch.
   *        type: UnitType,
   *
   *        // Location of Unit.  Typically required to be north of the center row.
   *        // Unit location may be adjusted depending on team placement on board.
   *        tile: [x, y],
   *      },
   *      ...
   *    ],
   *  }
   */
  join(team, slot) {
    let teams = this.teams;

    if (this.started)
      throw new TypeError('Game already started');

    if (slot === undefined)
      slot = teams.findIndex(t => !t);
    if (slot in teams)
      throw new TypeError('The slot does not exist');
    if (teams[slot])
      throw new TypeError('The slot is taken');

    if (!team.set)
      throw new TypeError('A set is required for the team');

    team.joined = new Date();
    team.originalID = slot;
    teams[slot] = team;

    // If all slots are filled, start the game.
    if (teams.findIndex(t => !t) === -1)
      this.start();
  }

  /*
   * Start the game.
   */
  start() {
    let teams = this.teams;

    /*
     * Turn order is always clockwise, but first turn can be random.
     */
    if (this.randomFirstTurn) {
      // Rotate team order 0-3 times.
      let index = Math.floor(Math.random() * teams.length);
      teams.unshift(...teams.splice(index, teams.length - index));
    }

    // Position units on the board according to team placement.
    //  Team ID 0: North
    //  Team ID 1: South
    //  Team ID 2: West
    //  Team ID 3: East
    if (this.type === 'Chaos')
      teams.unshift({
        originalID: 0,
        name: 'Chaos',
        colorId: 'White',
        bot: 'Chaos',
        set: [{
          type: 'ChaosSeed',
          tile: [5, 5],
        }],
      });

    teams.forEach((team, teamID) => { team.id = teamID });

    let board   = this._board;
    let degrees = teams.length === 2 ? [0, 180] : [0, 90, 180, 270];
    let unitID  = 1;

    this.units = teams.map(team => team.set.map(unitSetData => {
      // Team placement is based on the original team order.
      let degree   = degrees[team.originalID];
      let tile     = board.getTileRotation(unitSetData.tile, degree);
      let unitData = unitsData[unitTypeToIDMap.get(unitSetData.type)];

      let unitState = {
        id:   unitID++,
        type: unitSetData.type,
        tile: [tile.x, tile.y],
      };

      if (unitData.directional !== false)
        unitState.direction = board.getRotation('S', degree);

      return unitState;
    }));

    board.setState(this.units, teams);

    this.started = new Date();
    this._ready();

    this._bots = teams
      .filter(t => !!t.bot)
      .map(t => botFactory(t.bot, this, t));

    this._emit({
      type: 'startTurn',
      teamId: this.currentTeamId,
    });

    return this;
  }
  restart() {
    let teams = this.teams;

    // In the event that we're restarting the game, remove team Chaos.
    if (teams[0].name === 'Chaos') {
      teams.shift();

      // Reset bot teams that were taken over by the player.
      this.teams.forEach(team => {
        if (team.colorId !== 'Red')
          team.bot = true;
      });
    }

    this._actions.length = 0;
    this._history.length = 0;
    this.ended = null;
    this.winnerId = null;

    this._bots.forEach(b => b.destroy());

    return this.start();
  }

  getTurnData(turnId) {
    let turnData;

    if (turnId === this.currentTurnId)
      turnData = {
        units: this.units,
        actions: this.actions,
      };
    else
      turnData = this._history[turnId];

    return Promise.resolve(turnData);
  }
  getTurnActions(turnId) {
    let turnActions;

    if (turnId === this.currentTurnId)
      turnActions = this.actions;
    else
      turnActions = this._history[turnId].actions;

    return Promise.resolve(turnActions);
  }

  postAction(actions) {
    // Actions may only be submitted between game start and end.
    if (!this.started || this.ended)
      return;

    if (!Array.isArray(actions))
      actions = [actions];

    actions = this._board.decodeAction(actions);

    let new_actions = [];
    let pushAction = action => {
      action.created = new Date();
      action.teamId = this.currentTeamId;

      new_actions.push(action);
      this._actions.push(action);
      this._applyAction(action);
    };

    // Validate actions until we find an endTurn event.
    let turnEnded = !!actions.find(action => {
      if (action.type === 'endTurn')
        return true;

      /*
       * Validate and populate the action
       */
      let selected = this.selected;

      // Only a unit that exists may take action.
      let unit = action.unit;
      if (!unit) return;

      // Only a unit from the current team may take action.
      if (unit.team !== this.currentTeam) return;

      // Only the first unit to take action may take another.
      if (selected && unit !== selected) return;

      // Recovering or paralyzed units can't take action.
      if (unit.mRecovery || unit.paralyzed) return;

      // Apply unit-specific validation and determine results.
      action = unit.validateAction(action);
      if (!action) return;

      // Prevent multiple actions of a type within a turn.
      let moved    = this.moved;
      let attacked = this.attacked;

      if      (action.type === 'move'          && moved   ) return;
      else if (action.type === 'attack'        && attacked) return;
      else if (action.type === 'attackSpecial' && attacked) return;

      // Focusing units must break focus before taking action.
      if (unit.focusing)
        pushAction({
          type:    'breakFocus',
          unit:    unit,
          results: unit.getBreakFocusResults(),
        });

      // Turning in the current direction is the same as ending your turn.
      if (action.type === 'turn' && action.direction === unit.direction)
        return true;

      pushAction(action);

      // A turn action immediately ends the turn.
      if (action.type === 'turn')
        return true;

      /*
       * If the selected unit is unable to continue, end the turn early.
       *   1) Pyromancer killed himself.
       *   2) Knight attacked Chaos Seed and killed by counter-attack.
       *   3) Assassin blew herself up.
       *   4) Enchantress paralyzed at least 1 unit.
       */
      if (action.type === 'attack' || action.type === 'attackSpecial') {
        let selected = this.selected;
        let endTurn = () => {
          if (selected.mHealth === -selected.health)
            return true;
          if (selected.focusing)
            return true;
          if (this.winningTeams.length < 2)
            return true;
        };

        if (endTurn())
          return true;

        // Can any victims counter-attack?
        return action.results.find(result => {
          let unit = result.unit;
          if (!unit.canCounter()) return;

          let counterAction = unit.getCounterAction(action.unit, result);
          if (!counterAction) return;

          pushAction(counterAction);

          return endTurn();
        });
      }
    });

    let endGame;

    // Find teams that has a unit that keeps it alive.
    let winners = this.winningTeams;
    if (winners.length === 0)
      this.ended = new Date();
    else if (winners.length === 1) {
      this.ended = new Date();
      this.winnerId = winners[0].id;
    }
    else if (turnEnded) {
      // Team Chaos needs a chance to phase before ending their turn.
      let currentTeam = this.currentTeam;
      if (currentTeam.name === 'Chaos') {
        let phaseAction = currentTeam.units[0].getPhaseAction();
        if (phaseAction)
          pushAction(phaseAction);
      }

      // Keep ending turns until a team is capable of making their turn.
      while (turnEnded) {
        pushAction(this._getEndTurnAction());

        let passedTurnLimit = this.teams.length * 3;
        let passedTurnCount = 0;
        for (let i=this._history.length-1; i > -1; i--) {
          let actions = this._history[i].actions;
          if (actions.length > 1) break;

          passedTurnCount++;
        }

        if (passedTurnCount === passedTurnLimit) {
          this.ended = new Date();
          break;
        }

        // End the next turn if we can't find one playable unit.
        turnEnded = !this.currentTeam.units.find(unit => {
          if (unit.mRecovery) return;
          if (unit.paralyzed) return;

          return true;
        });
      }

      // Restore this value
      turnEnded = true;
    }

    if (new_actions.length)
      this._emit({
        type: 'action',
        actions: this._board.encodeAction(new_actions),
      });

    if (this.ended)
      this._emit({
        type: 'endGame',
        winnerId: this.winnerId,
      });
    else if (turnEnded)
      this._emit({
        type: 'startTurn',
        teamId: this.currentTeamId,
      });

    return this;
  }

  undo() {
    let teams   = this.teams;
    let actions = this._actions;

    if (teams.length === 2 && !teams[0].bot && !teams[1].bot) {
      // Be very permissive for the classic app
      if (actions.length)
        this._resetTurn();
      else
        this._popHistory();
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
      this._resetTurn();

      if (luckyActions.length)
        luckyActions.forEach(action => {
          let unit = action.unit;

          actions.push(action);

          if (action.type === 'move')
            unit.assign(action.tile);

          this._applyChangeResults(action.results);
        });
    }

    this._emit({
      type:    'reset',
      actions: actions,
      units:   this._board.getState(),
    });
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
  /*
   * End turn results include:
   *   The selected unit mRecovery is incremented based on their actions.
   *   Other units' mRecovery on the outgoing team is decremented.
   *   All units' mBlocking are reduced by 20% per turn cycle.
   */
  _getEndTurnAction() {
    let action = { type:'endTurn' };

    let selected    = this.selected;
    let moved       = this.moved;
    let attacked    = this.attacked;
    let teams       = this.teams;
    let currentTeam = this.currentTeam;
    let results     = action.results = [];

    // Per turn mBlocking decay rate is based on the number of teams.
    // It is calculated such that a full turn cycle is still a 20% reduction.
    let decay = teams.length;

    teams.forEach(team => {
      team.units.forEach(unit => {
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
              unit:    unit,
              changes: { mRecovery:mRecovery },
            });
        }

        // Decay blocking modifiers for all applicable units
        if (unit.mBlocking) {
          let mBlocking = unit.mBlocking * (1 - 0.2/decay);
          if (Math.abs(mBlocking) < 2) mBlocking = 0;

          results.push({
            unit:    unit,
            changes: { mBlocking:mBlocking },
          });
        }
      });
    });

    // If the player team was killed, he can take over for a bot team.
    // This behavior is restricted to the Chaos app.
    if (this.type === 'Chaos') {
      let activeTeams = this.activeTeams;

      // If we can't find an active player team...
      if (!activeTeams.find(t => t.bot === false)) {
        let botTeam = activeTeams.filter(t => t.name !== 'Chaos').random();
        botTeam.bot = false;

        let botIndex = this._bots.findIndex(b => b.team === botTeam);
        let bot = this._bots.splice(botIndex, 1)[0];
        bot.destroy();

        action.newPlayerTeam = botTeam.id;
      }
    }

    return action;
  }

  _applyAction(action) {
    let unit = action.unit;
    if (unit) {
      if (action.type === 'move')
        unit.assign(action.tile);
      if (action.direction)
        unit.direction = action.direction;
      if (action.colorId)
        unit.color = colorMap.get(action.colorId);
    }

    this._applyChangeResults(action.results);

    // Remove dead units.
    let board = this._board;
    board.teamsUnits.flat().forEach(unit => {
      // Chaos Seed doesn't die.  It hatches.
      if (unit.type === 15) return;

      if (unit.mHealth === -unit.health)
        board.dropUnit(unit);
    });

    if (action.type === 'endTurn')
      this._pushHistory();
  }
  /*
   * Note: This method is duplicated with the Game class.
   */
  _applyChangeResults(results) {
    if (!results) return;

    results.forEach(result => {
      let unit    = result.unit;
      // Use a shallow clone to protect against modification.
      let changes = Object.assign({}, result.changes);

      if (Object.keys(changes).length) {
        // For a change in type, we need to replace the unit instance.
        // Only Chaos Seed changes type to a Chaos Dragon.
        // By default, only the old unit id, direction, assignment, and color is inherited.
        if (changes.type) {
          // Dropping a unit clears the assignment.  So get it first.
          let assignment = unit.assignment;

          unit = this._board
            .dropUnit(unit)
            .addUnit({
              id:        unit.id,
              type:      changes.type,
              tile:      assignment,
              direction: unit.direction,
              color:     unit.color,
            }, unit.team);
          delete changes.type;
        }

        if (Object.keys(changes).length)
          unit.change(changes);
      }

      if (result.results)
        this._applyChangeResults(result.results);
    });
  }

  _resetTurn() {
    this._board.setState(this.units, this.teams);
    this._actions.length = 0;
  }
  _pushHistory() {
    let board = this._board;

    this._history.push({
      units:   this.units,
      actions: this.actions,
    });

    this.units = board.getState();
    this._actions.length = 0;

    return this;
  }
  _popHistory() {
    let history = this._history;
    if (history.length === 0) return;

    let turnData = history.pop();

    Object.assign(this, {
      units:    turnData.units,
      _actions: [],
    });

    return this._board.setState(this.units, this.teams);
  }

  _emit(event) {
    // Some event listeners will cause more events to be emitted.
    // Use setTimeout to ensure all listeners receive events in the correct sequence.
    setTimeout(() => this._emitter.emit(event.type, event));
  }
}
