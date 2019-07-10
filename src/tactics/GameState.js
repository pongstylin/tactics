'use strict';

import EventEmitter from 'events';
import Board from 'tactics/Board.js';
import botFactory from 'tactics/botFactory.js';
import colorMap from 'tactics/colorMap.js';
import unitDataMap from 'tactics/unitData.js';

const GAME_TYPES = new Set([
  'classic', // Must be a 2-player game with classic, a.k.a. default gray, sets.
  'chaos',   // Knights of Order vs the Seed of Chaos
]);

export default class GameState {
  /*****************************************************************************
   * Constructors
   ****************************************************************************/
  /*
   * The default constructor is intended for internal use only.
   */
  constructor(stateData) {
    let board = new Board();

    // Clone the stateData since we'll be modifying it.
    stateData = Object.assign({}, stateData);

    let turns = stateData.turns || [];
    delete stateData.turns;

    let actions = stateData.actions || [];
    delete stateData.actions;

    Object.assign(this,
      {
        winnerId: null,
      },
      stateData,
      {
        _bots:    [],
        _turns:   turns,
        _board:   board,
        _emitter: new EventEmitter(),
      }
    );

    board.setState(this.units, this.teams);

    this._actions = board.decodeAction(actions);
  }

  /*
   * This constructor must be used to create NEW games.
   *
   * At the minimum, a teams array must be provided with at least 2 elements.
   * The elements of the teams array may be blank with the expectation that they
   * will be filled later via the 'join' method.  Once all team slots are
   * filled, the game is started.
   */
  static create(stateData) {
    if (stateData.type) {
      if (!GAME_TYPES.has(stateData.type))
        throw new TypeError('Invalid game type');

      if (stateData.type === 'classic')
        stateData.teams = [null, null];
    }

    if (!stateData || !stateData.teams || stateData.teams.length < 2)
      throw new TypeError('Required teams length');

    let teams = stateData.teams;
    delete stateData.teams;

    stateData = Object.assign(
      // These settings may be overwritten
      {
        randomFirstTurn: true,
      },
      stateData,
      {
        started: null,
        ended:   null,
        teams:   new Array(teams.length),
        units:   [],
      }
    );

    let gameState = new GameState(stateData);

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
  static load(stateData) {
    if (typeof stateData.started === 'string')
      stateData.started = new Date(stateData.started);
    if (typeof stateData.ended === 'string')
      stateData.ended = new Date(stateData.ended);

    stateData.actions.forEach(action => {
      if (typeof action.created === 'string')
        action.created = new Date(action.created);
    });

    stateData.turns.forEach(turn => {
      turn.actions.forEach(action => {
        if (typeof action.created === 'string')
          action.created = new Date(action.created);
      });
    });

    return new GameState(stateData);
  }

  /*****************************************************************************
   * Public Property Accessors
   ****************************************************************************/
  get board() {
    return this._board;
  }
  get currentTurnId() {
    return this._turns.length;
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
        if (unit.type === 'BarrierWard' || unit.type === 'LightningWard')
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
    if (slot >= teams.length)
      throw new TypeError('The slot does not exist');
    if (teams[slot])
      throw new TypeError('The slot is taken');

    if (this.type === 'classic')
      team.set = [
        // Back Row
        {assignment:[5, 0], type:'Cleric'},
        // Middle Row
        {assignment:[2, 1], type:'DarkMagicWitch'},
        {assignment:[3, 1], type:'Pyromancer'},
        {assignment:[7, 1], type:'Pyromancer'},
        {assignment:[8, 1], type:'Enchantress'},
        // Front Row
        {assignment:[1, 2], type:'Assassin'},
        {assignment:[4, 2], type:'Knight'},
        {assignment:[5, 2], type:'Knight'},
        {assignment:[6, 2], type:'Knight'},
        {assignment:[9, 2], type:'Scout'},
      ];
    else if (!team.set)
      throw new TypeError('A set is required for the team');

    team.joined = new Date();
    team.originalId = slot;
    teams[slot] = team;

    /*
     * Position teams on the board according to original team order.
     * Team order is based on the index (id) of the team in the teams array.
     * Team order is clockwise starting in the North.
     *  2 Players: 0:North, 1:South
     *  4 Players: 0:North, 1:East, 2:South, 3:West
     */
    let positions = new Map([[0,'N'], [90,'W'], [180,'S'], [270,'E']]);
    let degrees   = teams.length === 2 ? [0, 180] : [0, 90, 180, 270];
    let degree    = degrees[slot];

    team.position = positions.get(degree);

    this._emit({
      type: 'joined',
      data: {
        slot: slot,
        team: team,
      },
    });

    // If all slots are filled, start the game.
    if (teams.findIndex(t => !t) === -1)
      this._start();
  }

  /*
   * Start the game.
   */
  _start() {
    let teams = this.teams;

    /*
     * Turn order is always clockwise, but first turn can be random.
     */
    if (this.randomFirstTurn) {
      // Rotate team order 0-3 times.
      let index = Math.floor(Math.random() * teams.length);
      teams.unshift(...teams.splice(index, teams.length - index));
    }

    if (this.type === 'Chaos')
      teams.unshift({
        originalId: 0,
        name: 'Chaos',
        colorId: 'White',
        bot: 'Chaos',
        set: [{
          type: 'ChaosSeed',
          assignment: [5, 5],
        }],
        position: 'C',
      });

    teams.forEach((team, teamId) => { team.id = teamId });

    let board  = this._board;
    let unitId = 1;

    // Place the units according to team position.
    this.units = teams.map(team => team.set.map(unitSetData => {
      let degree   = board.getDegree('N', team.position);
      let tile     = board.getTileRotation(unitSetData.assignment, degree);
      let unitData = unitDataMap.get(unitSetData.type);

      let unitState = {
        id: unitId++,
        type: unitSetData.type,
        assignment: [tile.x, tile.y],
      };

      if (unitData.directional !== false)
        unitState.direction = board.getRotation('S', degree);

      // Apply a 1-turn wait to units in the team that goes first.
      if (team.id === 0 && unitData.waitFirstTurn)
        unitState.mRecovery = 1;

      return unitState;
    }));

    board.setState(this.units, teams);

    this.started = new Date();

    this._bots = teams
      .filter(t => !!t.bot)
      .map(t => botFactory(t.bot, this, t));

    this._emit({
      type: 'startGame',
      data: {
        started: this.started,
        teams: this.teams,
        units: this.units,
      },
    });
    this._emit({
      type: 'startTurn',
      data: {
        turnId: this.currentTurnId,
        teamId: this.currentTeamId,
      },
    });
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
    this._turns.length = 0;
    this.ended = null;
    this.winnerId = null;

    this._bots.forEach(b => b.destroy());
    this._bots.length = 0;

    this._start();
  }

  /*
   * This method is used when transmitting game state from the server to client.
   * It does not include all of the data that is serialized by toJSON().
   */
  getData() {
    /*
     * Hide the team's unit set.  This is particularly useful when the game has
     * not started yet.  Don't want snooping on a team's set before joining.
     */
    let teams = this.teams.map(team => {
      if (team) {
        team = {...team};
        delete team.units;
      }

      return team;
    });

    return {
      type:  this.type,
      teams: teams,

      randomFirstTurn: this.randomFirstTurn,

      started:       this.started,
      ended:         this.ended,

      currentTurnId: this.currentTurnId,
      currentTeamId: this.currentTeamId,
      units:         this.units,
      actions:       this.actions,

      winnerId:      this.winnerId,
    };
  }
  getTurnData(turnId) {
    let turnData;

    if (turnId === this.currentTurnId)
      turnData = {
        units:   this.units,
        actions: this.actions,
      };
    else
      turnData = this._turns[turnId];

    return turnData;
  }
  getTurnActions(turnId) {
    let turnActions;

    if (turnId === this.currentTurnId)
      turnActions = this.actions;
    else
      turnActions = this._turns[turnId].actions;

    return turnActions;
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
      action.teamId = action.teamId || this.currentTeamId;

      new_actions.push(action);
      this._applyAction(action);
    };

    // Validate actions until we find an endTurn event.
    let turnEnded = !!actions.find(action => {
      if (action.type === 'endTurn')
        return true;

      if (action.type === 'surrender') {
        let team = this.teams[action.teamId];
        if (!team || !team.units.length) return;

        pushAction({
          type: 'surrender',
          teamId: action.teamId,
          results: this._getSurrenderResults(team),
        });

        return true;
      }

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
        for (let i=this._turns.length-1; i > -1; i--) {
          let actions = this._turns[i].actions;
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
        data: this._board.encodeAction(new_actions),
      });

    if (this.ended)
      this._emit({
        type: 'endGame',
        data: { winnerId:this.winnerId },
      });
    else if (turnEnded)
      this._emit({
        type: 'startTurn',
        data: {
          turnId: this.currentTurnId,
          teamId: this.currentTeamId,
        },
      });
  }

  /*
   * Determine if provided team may request an undo.
   * Also indicate if approval should be required of opponents.
   */
  canUndo(team = this.currentTeam) {
    let teams   = this.teams;
    let turns   = this._turns;
    let actions = this.actions; // encoded, on purpose

    // Can't undo if there are no actions or turns to undo.
    if (turns.length === 0 && actions.length === 0)
      return false;

    // Local games don't impose restrictions.
    let bot = teams.find(t => !!t.bot);
    let opponent = teams.find(t => t.playerId !== team.playerId);
    if (!bot && !opponent)
      return true;

    // Bots will never approve anything that requires approval.
    let approve = bot ? false : 'approve';

    // If actions were made since the team's turn, approval is required.
    if (team !== this.currentTeam) {
      let turnOffset = (-teams.length + (team.id - this.currentTeamId)) % teams.length;

      // Can't undo if the team hasn't made a turn yet.
      let turnId = turns.length + turnOffset;
      if (turnId < 0)
        return false;

      // Need approval if multiple turns would be undone (for 4-player games)
      if (turnOffset < -1)
        return approve;

      // Need approval if the current team has already submitted actions.
      if (actions.length)
        return approve;

      // These actions will be inspected to determine if approval is required.
      actions = turns[turnId].actions.filter(a => a.type !== 'endTurn');
    }

    // Can't undo unless there are actions to undo.
    // Can't undo if the turn was passed (or forced to pass).
    if (actions.length === 0)
      return false;

    let lastAction = actions[actions.length - 1];

    // Requires approval if the last action was a counter-attack
    let selectedUnitId = actions[0].unit;
    if (selectedUnitId !== lastAction.unit)
      return approve;

    // Requires approval if the last action required luck
    let isLucky = lastAction.results && !!lastAction.results.find(r => 'luck' in r);
    if (isLucky)
      return approve;

    return true;
  }

  /*
   * Initiate an undo action by provided team (defaults to current turn's team)
   */
  undo(team = this.currentTeam, approved = false) {
    let teams   = this.teams;
    let turns   = this._turns;
    let actions = this._actions;

    // Can't undo if there are no actions or turns to undo.
    if (turns.length === 0 && actions.length === 0)
      return false;

    // Local games don't impose restrictions.
    let bot      = teams.find(t => !!t.bot);
    let opponent = teams.find(t => t.playerId !== team.playerId);

    if (!bot && !opponent) {
      if (actions.length)
        this.revert(this.currentTurnId);
      else
        this.revert(this.currentTurnId - 1);
    }
    else {
      let turnOffset = (-teams.length + (team.id - this.currentTeamId)) % teams.length;
      let turnId     = turns.length + turnOffset;

      // Keep lucky actions if not approved.
      this.revert(turnId, !approved);
    }

    // Just in case the game ended right before undo was submitted.
    this.ended = null;
    this.winnerId = null;
  }
  revert(turnId, keepLuckyActions = false) {
    let board = this._board;
    let actions;
    if (turnId === this.currentTurnId)
      actions = this._resetTurn();
    else
      actions = this._popHistory(turnId).actions.slice(0, -1);

    if (keepLuckyActions) {
      let selectedUnitId = actions[0].unit;
      let lastLuckyActionIndex = actions.findLastIndex(action =>
        // Restore counter-attacks
        action.unit !== selectedUnitId ||
        // Restore luck-involved attacks
        action.results && !!action.results.find(r => 'luck' in r)
      );

      // Re-apply actions that required luck.
      let luckyActions = board.decodeAction(actions.slice(0, lastLuckyActionIndex + 1));
      if (luckyActions.length)
        luckyActions.forEach(action => this._applyAction(action));
    }

    let lastActions = null;
    let turns = this._turns;
    if (turns.length)
      lastActions = turns[turns.length-1].actions;

    this._emit({
      type: 'revert',
      data: {
        turnId:      this.currentTurnId,
        teamId:      this.currentTeamId,
        actions:     this.actions,
        lastActions: lastActions,
        units:       board.getState(),
      },
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

  /*
   * Intended for serializing game data for persistent storage.
   */
  toJSON() {
    let teams = this.teams.map(team => {
      if (team) {
        team = {...team};
        delete team.units;
      }

      return team;
    });

    return {
      type:     this.type,
      teams:    teams,

      randomFirstTurn: this.randomFirstTurn,

      started:  this.started,
      ended:    this.ended,

      turns:    this._turns,
      units:    this.units,
      actions:  this.actions,

      winnerId: this.winnerId,
    };
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
  _getSurrenderResults(team) {
    let results = [];

    team.units.forEach(unit => {
      results.push({
        unit:    unit,
        changes: { mHealth:-unit.health },
      });
    });

    return results;
  }

  _applyAction(action) {
    this._actions.push(action);

    let unit = action.unit;

    if (unit) {
      if (action.assignment)
        unit.assign(action.assignment);
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
      if (unit.type === 'ChaosSeed') return;

      if (unit.mHealth === -unit.health)
        board.dropUnit(unit);
    });

    if (action.type === 'endTurn')
      this._pushHistory();
  }
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
              id:         unit.id,
              type:       changes.type,
              assignment: assignment,
              direction:  unit.direction,
              color:      unit.color,
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
    // Get and return the (encoded) actions that were reset.
    let actions = this.actions;

    this._board.setState(this.units, this.teams);
    this._actions.length = 0;

    return actions;
  }
  _pushHistory() {
    let board = this._board;

    this._turns.push({
      units:   this.units,
      actions: this.actions,
    });

    this.units = board.getState();
    this._actions.length = 0;

    return this;
  }
  /*
   * By default, reverts game state to the beginning of the previous turn.
   * 'turnId' can be used to revert to any previous turn by ID.
   */
  _popHistory(turnId) {
    let turns = this._turns;
    if (turns.length === 0) return;

    if (turnId === undefined)
      turnId = turns.length - 1;

    let turnData = turns[turnId];

    // Truncate the turn history.
    turns.length = turnId;

    Object.assign(this, {
      units:    turnData.units,
      _actions: [],
    });

    this._board.setState(this.units, this.teams);

    return turnData;
  }

  _emit(event) {
    // Some event listeners will cause more events to be emitted.
    // Use setTimeout to ensure all listeners receive events in the correct sequence.
    setTimeout(() => this._emitter.emit(event.type, event));
  }
}
