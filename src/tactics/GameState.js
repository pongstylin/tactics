import EventEmitter from 'events';
import ServerError from 'server/Error.js';
import Board from 'tactics/Board.js';
import botFactory from 'tactics/botFactory.js';
import colorMap from 'tactics/colorMap.js';
import unitDataMap from 'tactics/unitData.js';

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
        _actions: [],
        _emitter: new EventEmitter(),
      }
    );

    board.setState(this.units, this.teams);
    board.decodeAction(actions).forEach(a => this._applyAction(a));
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
    if (!stateData || !stateData.teams)
      throw new TypeError('Required teams');
    else if (stateData.teams.length !== 2 && stateData.teams.length !== 4)
      throw new TypeError('Required 2 or 4 teams');

    let teams = stateData.teams;
    delete stateData.teams;

    stateData = Object.assign(
      // These settings may be overwritten
      {
        randomFirstTurn: true,
        turnTimeLimit: null,
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
    if (typeof stateData.turnStarted === 'string')
      stateData.turnStarted = new Date(stateData.turnStarted);
    if (typeof stateData.ended === 'string')
      stateData.ended = new Date(stateData.ended);

    stateData.actions.forEach(action => {
      if (typeof action.created === 'string')
        action.created = new Date(action.created);
    });

    stateData.turns.forEach(turn => {
      turn.started = new Date(turn.started);
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

        // Shrubs don't count.
        if (unit.type === 'Shrub')
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

    if (slot === undefined || slot === null) {
      // find an empty slot
      slot = teams.findIndex(t => !t);

      // If still not found, can't join!
      if (slot === -1)
        throw new TypeError('No slots are available');
    }
    if (slot >= teams.length)
      throw new TypeError('The slot does not exist');

    // You may join a slot that is already assigned to you.
    // e.g. to add or modify a set.
    if (teams[slot] && teams[slot].playerId !== team.playerId)
      throw new TypeError('The slot is taken');

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
    let positions = teams.length === 2 ? ['N', 'S'] : ['N', 'E', 'S', 'W'];

    team.position = positions[slot];

    this._emit({
      type: 'joined',
      data: {
        slot: slot,
        team: team,
      },
    });
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

    if (this.type === 'chaos')
      teams.unshift({
        originalId: 4,
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
    this.units = teams.map(team => {
      let dragonPower = unitDataMap.get('DragonTyrant').power;
      let mageTypes = ['DragonspeakerMage', 'Pyromancer'];
      let dragons = team.set.filter(u => u.type === 'DragonTyrant');
      let mages = team.set.filter(u => mageTypes.includes(u.type));
      let speakers = mages.filter(u => u.type === 'DragonspeakerMage');
      let dragonDrain = Math.min(dragonPower, Math.round(12 * speakers.length * mages.length));
      let speakerBonus = Math.round(dragonDrain * dragons.length / mages.length);

      return team.set.map(unitSetData => {
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

        if (dragons.length && speakers.length) {
          if (dragons.includes(unitSetData))
            unitState.mPower = -dragonDrain;
          else if (mages.includes(unitSetData))
            unitState.mPower = speakerBonus;
        }

        return unitState;
      });
    });

    board.setState(this.units, teams);

    // Triggering board init event allows units to apply ambient effects, such
    // as Dragonspeaker Mage.
    board.trigger({ type:'init' });
    this.units = board.getState();

    this._bots = teams
      .filter(t => !!t.bot)
      .map(t => botFactory(t.bot, this, t));

    this.started = new Date();
    this.turnStarted = this.started;

    this._emit({
      type: 'startGame',
      data: {
        started: this.started,
        teams: this.teams,
        units: this.units,
      },
    });

    // Pass the first turn if we can't find one playable unit.
    let pass = !this.currentTeam.units.find(u => u.mRecovery === 0);
    if (pass) {
      let action = this._getEndTurnAction(true);
      action.created = this.turnStarted;
      action.teamId = action.teamId || this.currentTeamId;

      this._applyAction(action);
    }

    this._emit({
      type: 'startTurn',
      data: {
        started: this.turnStarted,
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

    this.start();
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
      turnTimeLimit: this.turnTimeLimit,

      started:       this.started,
      ended:         this.ended,

      // Data about the current turn
      turnStarted:   this.turnStarted,
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
        started: this.turnStarted,
        units:   this.units,
        actions: this.actions,
      };
    else if (!this._turns[turnId])
      return null;
    else
      turnData = {...this._turns[turnId]};

    turnData.id = turnId;
    turnData.teamId = turnId % this.teams.length;

    return turnData;
  }
  getTurnActions(turnId) {
    let turnActions;

    if (turnId === this.currentTurnId)
      turnActions = this.actions;
    else if (turnId < this._turns.length)
      turnActions = this._turns[turnId].actions;
    else
      throw new ServerError(409, 'No such turn ID');

    return turnActions;
  }

  submitAction(actions) {
    // Actions may only be submitted between game start and end.
    if (!this.started || this.ended)
      return;

    if (!Array.isArray(actions))
      actions = [actions];

    let board = this._board;
    actions = board.decodeAction(actions);

    let newActions = [];
    let pushAction = action => {
      action.created = new Date();
      action.teamId = action.teamId || this.currentTeamId;

      newActions.push(action);
      this._applyAction(action);
    };
    let endTurn;
    let setEndTurn = forced => {
      endTurn = this._getEndTurnAction(forced);
      return true;
    };

    // Validate actions until the turn ends.
    actions.find(action => {
      if (action.type === 'endTurn')
        return setEndTurn();

      if (action.type === 'surrender') {
        let team = this._validateSurrenderAction(action);

        pushAction({
          type: 'surrender',
          teamId: team.id,
          results: this._getSurrenderResults(team),
          declaredBy: action.declaredBy,
        });

        if (team === this.currentTeam)
          return setEndTurn(team.playerId !== action.declaredBy);
        return;
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

      // Taking an action may break certain status effects.
      let breakAction = unit.getBreakAction(action);
      if (breakAction)
        pushAction(breakAction);

      // Apply unit-specific validation and determine results.
      action = unit.validateAction(action);
      if (!action) return;

      /*
       * Validate the action taking game state into consideration.
       */
      let moved    = this.moved;
      let attacked = this.attacked;

      if (action.type === 'move') {
        // Can't move twice.
        if (moved) return;
      }
      else if (action.type === 'attack' || action.type === 'attackSpecial') {
        // Can't attack twice
        if (attacked) return;

        // Can't attack if poisoned at turn start.
        let unitState = this.units[unit.team.id].find(u => u.id === unit.id);
        if (unitState.poisoned)
          return;
      }

      // Turning in the current direction is the same as ending your turn.
      if (action.type === 'turn' && action.direction === unit.direction)
        return setEndTurn();

      pushAction(action);

      // A turn action immediately ends the turn.
      if (action.type === 'turn')
        return setEndTurn();

      /*
       * If the selected unit is unable to continue, end the turn early.
       *   1) Pyromancer killed himself.
       *   2) Knight attacked Chaos Seed and killed by counter-attack.
       *   3) Assassin blew herself up.
       *   4) Enchantress paralyzed at least 1 unit.
       *   5) Lightning Ward attacked.
       *   6) Furgon did special attack - immediately incurring recovery
       */
      if (action.type === 'attack' || action.type === 'attackSpecial') {
        let selected = this.selected;
        let forceEndTurn = () => {
          if (selected.mHealth <= -selected.health)
            return true;
          if (selected.focusing)
            return true;
          if (selected.mRecovery)
            return true;
          if ((moved || !selected.canMove()) && !selected.canTurn())
            return true;
          if (this.winningTeams.length < 2)
            return true;
        };

        if (forceEndTurn())
          return setEndTurn(true);

        // Can any victims counter-attack?
        return action.results.find(result => {
          let unit = result.unit;
          if (!unit.canCounter()) return;

          let counterAction = unit.getCounterAction(action.unit, result);
          if (!counterAction) return;

          pushAction(counterAction);

          if (forceEndTurn())
            return setEndTurn(true);
        });
      }
    });

    let endGame;

    // Find teams that has a unit that keeps it alive.
    let winners = this.winningTeams;
    if (winners.length === 0) {
      pushAction(this._getEndTurnAction(true));
      this.ended = new Date();
    }
    else if (winners.length === 1) {
      pushAction(this._getEndTurnAction(true));
      this.ended = new Date();
      this.winnerId = winners[0].id;
    }
    else if (endTurn) {
      // Team Chaos needs a chance to phase before ending their turn.
      let currentTeam = this.currentTeam;
      if (currentTeam.name === 'Chaos') {
        let phaseAction = currentTeam.units[0].getPhaseAction();
        if (phaseAction)
          pushAction(phaseAction);
      }

      // Keep ending turns until a team is capable of making their turn.
      let turnEnded = true;
      while (turnEnded) {
        pushAction(endTurn);

        // If all teams pass their turns 3 times, draw!
        let passedTurnLimit = this.teams.length * 3;
        let passedTurnCount = 0;

        // If no teams attack each other for 15 cycles, draw!
        let attackTurnLimit = this.teams.length * 15;
        let attackTurnCount = 0;

        let maxTurnId = this._turns.length - 1;
        let minTurnId = Math.max(-1, maxTurnId - attackTurnLimit);
        TURN:for (let i = maxTurnId; i > minTurnId; i--) {
          let actions = this._turns[i].actions;
          let teamsUnits = this._turns[i].units;

          // If the only action that took place is ending the turn...
          if (actions.length === 1) {
            if (passedTurnCount !== null && ++passedTurnCount === passedTurnLimit)
              break;
          }
          else {
            passedTurnCount = null;

            for (let j = 0; j < actions.length-1; j++) {
              let action = actions[j];
              if (!action.type.startsWith('attack')) continue;

              let attackerTeamId;
              for (let t = 0; t < teamsUnits.length; t++) {
                if (teamsUnits[t].find(u => u.id === action.unit)) {
                  attackerTeamId = t;
                  break;
                }
              }

              for (let k = 0; k < action.results.length; k++) {
                let result = action.results[k];
                // This check ignores summoned units, e.g. shrubs
                if (typeof result.unit !== 'number') continue;

                let defenderTeamId;
                for (let t = 0; t < teamsUnits.length; t++) {
                  if (teamsUnits[t].find(u => u.id === result.unit)) {
                    defenderTeamId = t;
                    break;
                  }
                }

                if (defenderTeamId !== attackerTeamId)
                  break TURN;
              }
            }
          }

          attackTurnCount++;
        }

        if (
          passedTurnCount === passedTurnLimit ||
          attackTurnCount === attackTurnLimit
        ) {
          this.ended = new Date();
          break;
        }

        // End the next turn if we can't find one playable unit.
        turnEnded = !this.currentTeam.units.find(unit => {
          if (unit.mRecovery) return;
          if (unit.paralyzed) return;
          if (unit.type === 'Shrub') return;

          return true;
        });

        if (turnEnded)
          endTurn = this._getEndTurnAction(true);
      }
    }

    if (newActions.length)
      this._emit({
        type: 'action',
        data: board.encodeAction(newActions),
      });

    if (this.ended)
      this._emit({
        type: 'endGame',
        data: { winnerId:this.winnerId },
      });
    else if (endTurn)
      this._emit({
        type: 'startTurn',
        data: {
          started: this.turnStarted,
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
    let teams = this.teams;

    // Can't undo if there are no actions or turns to undo.
    if (this._turns.length === 0 && this._actions.length === 0)
      return false;

    // Local games don't impose restrictions.
    let bot = teams.find(t => !!t.bot);
    let opponent = teams.find(t => t.playerId !== team.playerId);
    if (!bot && !opponent)
      return true;

    // Can't undo if there are no actions to undo.
    if (team === this.currentTeam && this._actions.length === 0)
      return false;

    // Bots will never approve anything that requires approval.
    let approve = bot ? false : 'approve';
    let requireApproval = false;
    let turnId;
    let actions;

    // Determine the turn being undone in whole or in part
    for (turnId = this.currentTurnId; turnId > -1; turnId--) {
      // Can't undo if team has no actionable turns to undo.
      if (turnId < 0)
        return false;

      // Bots do not allow undo after the turn has ended.
      if (bot && turnId < this.currentTurnId)
        return false;

      let turnData = this.getTurnData(turnId);
      actions = turnData.actions;

      // Current turn not actionable if no actions were made.
      if (actions.length === 0)
        continue;

      // Not an actionable turn if the turn was forced to pass.
      if (
        actions.length === 1 &&
        actions[0].type === 'endTurn' &&
        actions[0].forced
      ) continue;

      // Require approval if undoing actions made by the opponent team.
      let turnTeam = teams[turnId % teams.length];
      if (turnTeam.id !== team.id) {
        requireApproval = true;
        continue;
      }

      // Require approval if the turn time limit was reached.
      if (this.turnTimeLimit) {
        let turnTimeout = turnData.started.getTime() + this.turnTimeLimit*1000;
        if (Date.now() > turnTimeout)
          return approve;
      }

      break;
    }

    if (requireApproval)
      return approve;

    // If turn not force ended, then change direction does not require approval.
    if (turnId !== this.currentTurnId && !actions.last.forced)
      return true;

    let lastAction = actions.filter(a => a.type !== 'endTurn').last;

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
    let actions = this._actions;

    // Can't undo if there are no actions or turns to undo.
    if (this._turns.length === 0 && actions.length === 0)
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
      // Can't undo if there are no actions to undo.
      if (team === this.currentTeam && actions.length === 0)
        return false;

      for (let turnId = this.currentTurnId; turnId > -1; turnId--) {
        // Can't undo if team has no actionable turns to undo.
        if (turnId < 0)
          return false;

        // Bots do not allow undo after the turn has ended.
        if (bot && turnId < this.currentTurnId)
          return false;

        let turnData = this.getTurnData(turnId);
        actions = turnData.actions;

        // Current turn not actionable if no actions were made by opponent yet.
        if (actions.length === 0)
          continue;

        // Not an actionable turn if the turn was forced to pass.
        if (
          actions.length === 1 &&
          actions[0].type === 'endTurn' &&
          actions[0].forced
        ) continue;

        // Require approval if undoing actions made by the opponent team.
        let turnTeam = teams[turnId % teams.length];
        if (turnTeam.id !== team.id) {
          if (!approved) return false;
          continue;
        }

        // Require approval if the turn time limit was reached.
        if (!approved && this.turnTimeLimit) {
          let turnTimeout = turnData.started.getTime() + this.turnTimeLimit*1000;
          if (Date.now() > turnTimeout)
            return false;
        }

        // Keep lucky actions if not approved.
        this.revert(turnId, !approved);
        break;
      }
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

    if (actions.length && keepLuckyActions) {
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

    this._emit({
      type: 'revert',
      data: {
        started: this.turnStarted,
        turnId:  this.currentTurnId,
        teamId:  this.currentTeamId,
        actions: this.actions,
        units:   this.units,
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
      turnTimeLimit: this.turnTimeLimit,

      started:  this.started,
      ended:    this.ended,

      turnStarted: this.turnStarted,
      turns:       this._turns,
      units:       this.units,
      actions:     this.actions,

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
  _getEndTurnAction(forced) {
    let action = { type:'endTurn', forced };

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
        let result = { unit, changes:{} };

        // Adjust recovery for the outgoing team.
        if (team === currentTeam) {
          let mRecovery;
          if (unit === selected) {
            // Allow a unit (such as Furgon) to provide custom recovery.
            if (selected.mRecovery === 0) {
              let recovery = selected.recovery;

              if ((moved || !selected.mType) && attacked)
                mRecovery = recovery;
              else if (moved)
                mRecovery = Math.floor(recovery / 2);
              else if (attacked)
                mRecovery = Math.ceil(recovery / 2);

              if (mRecovery === 0)
                mRecovery = undefined;
            }
          }
          else if (unit.mRecovery)
            mRecovery = unit.mRecovery - 1;

          if (mRecovery !== undefined)
            result.changes.mRecovery = mRecovery;
        }

        if (unit.poisoned) {
          let mHealth = unit.mHealth;
          unit.poisoned.forEach(attacker => mHealth -= attacker.power);
          mHealth = Math.max(-unit.health + 1, mHealth);

          if (mHealth !== unit.mHealth)
            result.changes.mHealth = mHealth;
        }

        // Decay blocking modifiers for all applicable units
        if (unit.mBlocking) {
          let mBlocking = unit.mBlocking * (1 - 0.2/decay);
          if (Math.abs(mBlocking) < 2) mBlocking = 0;

          result.changes.mBlocking = mBlocking;
        }

        if (Object.keys(result.changes).length)
          results.push(result);
      });
    });

    this._board.trigger({
      type: 'endTurn',
      currentTeam: this.currentTeam,
      addResults: r => results.push(...r),
    });

    // If the player team was killed, he can take over for a bot team.
    // This behavior is restricted to the Chaos app.
    if (this.type === 'chaos') {
      let activeTeams = this.activeTeams;

      // If we can't find an active player team...
      if (!activeTeams.find(t => t.bot === false)) {
        let botTeam = activeTeams.filter(t => t.name !== 'Chaos').random();
        if (botTeam) {
          botTeam.bot = false;

          let botIndex = this._bots.findIndex(b => b.team === botTeam);
          let bot = this._bots.splice(botIndex, 1)[0];
          bot.destroy();

          action.newPlayerTeam = botTeam.id;
        }
      }
    }

    return action;
  }
  _validateSurrenderAction(action) {
    let team = this.teams[action.teamId];
    if (!team || !team.units.length)
      throw new ServerError(400, 'No such team ID');

    // If surrender is declared by someone other than the team's owner...
    if (action.declaredBy !== team.playerId) {
      // It must be the team's turn.
      if (team !== this.currentTeam)
        throw new ServerError(403, "It is not the team's turn");

      let now = new Date();
      let lastAction = this._actions.last;
      let lastActionAt = lastAction ? lastAction.created.getTime() : 0;
      let actionTimeout = (lastActionAt + 10000) - now;
      let turnTimeout = (this.turnStarted.getTime() + this.turnTimeLimit*1000) - now;
      let timeout = Math.max(actionTimeout, turnTimeout);

      // The team's timeout must be exceeded.
      if (timeout > 0)
        throw new ServerError(403, 'The time limit has not been exceeded');
    }

    return team;
  }
  _getSurrenderResults(team) {
    let board = this._board;

    return team.units.map(unit => {
      let result = { unit, changes: { mHealth:-unit.health } };
      let subResults = [];

      // Most attacks break the focus of focusing units.
      if (unit.focusing)
        subResults.push(...unit.getBreakFocusResult(true));

      // Remove focus from dead units
      if (unit.paralyzed || unit.poisoned || unit.armored || unit.barriered) {
        let focusingUnits = [
          ...(unit.paralyzed || []),
          ...(unit.poisoned  || []),
          ...(unit.armored   || []),
          ...(unit.barriered || []),
        ];

        // All units focusing on this dead unit can stop.
        subResults.push(...focusingUnits.map(fUnit => ({
          unit: fUnit,
          changes: {
            focusing: fUnit.focusing.length === 1
              ? false
              : fUnit.focusing.filter(t => t !== unit),
          }
        })));

        // Stop showing the unit as paralyzed, poisoned, or barriered
        if (unit.paralyzed || unit.poisoned || unit.barriered) {
          let subChanges = {};
          if (unit.paralyzed)
            subChanges.paralyzed = false;
          if (unit.poisoned)
            subChanges.poisoned = false;
          if (unit.barriered)
            subChanges.barriered = false;

          subResults.push({
            unit: unit,
            changes: subChanges,
          });
        }
      }

      if (subResults.length) {
        result.results = subResults;
        board.applyActionResults(subResults);
      }

      return result;
    });
  }

  _applyAction(action) {
    this._actions.push(action);

    this._board.applyAction(action);

    if (action.type === 'endTurn')
      this._pushHistory();
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
      started: this.turnStarted,
      units:   this.units,
      actions: this.actions,
    });

    this.turnStarted = new Date();
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
      // Preserve the original turn start so that a client may successfully
      // resume the game after their opponent reverted to a previous turn.
      turnStarted: turnData.started,
      units:       turnData.units,
      _actions:    [],
    });

    this._board.setState(this.units, this.teams);

    return turnData;
  }

  _emit(event) {
    this._emitter.emit('event', event);
    this._emitter.emit(event.type, event);
  }
}
