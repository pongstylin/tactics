import Team from 'models/Team.js';
import ServerError from 'server/Error.js';
import Board from 'tactics/Board.js';
import botFactory from 'tactics/botFactory.js';
import emitter from 'utils/emitter.js';
import serializer from 'utils/serializer.js';

export default class GameState {
  /*****************************************************************************
   * Constructors
   ****************************************************************************/
  /*
   * The default constructor is intended for internal use only.
   */
  constructor(stateData) {
    const board = new Board();

    // Clone the stateData since we'll be modifying it.
    stateData = Object.assign({}, stateData);

    const actions = stateData.actions || [];
    delete stateData.actions;

    Object.assign(this,
      {
        turns: [],
        winnerId: null,
      },
      stateData,
      {
        _bots:       [],
        _board:      board,
        _newActions: [],
        _actions:    [],
      }
    );

    if (stateData.startedAt) {
      board.setState(this.units, this.teams);
      board.decodeAction(actions).forEach(a => this._applyAction(a));
    }
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

    let teamsData = stateData.teams;
    delete stateData.teams;

    stateData = Object.assign(
      // These settings may be overwritten
      {
        randomFirstTurn: true,
        randomHitChance: true,
        strictUndo: false,
        strictFork: false,
        autoSurrender: false,
        rated: false,
        turnTimeLimit: null,
        turnTimeBuffer: null,
      },
      stateData,
      {
        startedAt: null,
        endedAt: null,
        teams: new Array(teamsData.length).fill(null),
        units: [],
      }
    );

    let gameState = new GameState(stateData);

    teamsData.forEach((teamData, slot) => {
      if (teamData)
        gameState.join(Team.create({
          ...teamData,
          slot,
          joinedAt: new Date(),
        }));
    });

    return gameState;
  }
  static fromJSON(stateData) {
    if (stateData.turnTimeBuffer) {
      for (const turn of stateData.turns) {
        if (turn.timeBuffer === undefined)
          turn.timeBuffer = 0;
      }
    }

    return new GameState(stateData);
  }

  /*****************************************************************************
   * Public Property Accessors
   ****************************************************************************/
  get board() {
    return this._board;
  }
  get currentTurnId() {
    return this.turns.length;
  }
  get currentTurn() {
    return {
      startedAt: this.turnStartedAt,
      units: this.units,
      actions: this.actions,
      timeBuffer: this.currentTeam.turnTimeBuffer,
    };
  }
  get currentTurnTimeLimit() {
    return this.getTurnTimeLimit();
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
    return this._actions.find(a => a.type === 'select')?.unit;
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
  join(team) {
    let teams = this.teams;

    if (this.startedAt)
      throw new TypeError('Game already started');

    if (!(team instanceof Team))
      throw new TypeError('Expected Team object');

    team.useRandom = this.randomHitChance;

    let slot = team.id ?? team.slot;
    teams[slot] = team;

    this._emit({
      type: 'joined',
      data: { team:team.getData() },
    });
  }

  /*
   * Start the game.
   */
  start() {
    const teams = this.teams;
    const board = this._board;

    // Units are already present for forked games.
    if (this.units.length === 0) {
      /*
       * Turn order is always clockwise, but first turn can be random.
       */
      if (this.randomFirstTurn) {
        // Rotate team order 0-3 times.
        const index = Math.floor(Math.random() * teams.length);
        teams.unshift(...teams.splice(index, teams.length - index));
      }

      /*
       * Position teams on the board according to original team order.
       * Team order is based on the index (id) of the team in the teams array.
       * Team order is clockwise starting in the North.
       *  2 Players: 0:North, 1:South
       *  4 Players: 0:North, 1:East, 2:South, 3:West
       */
      const positions = teams.length === 2 ? ['N', 'S'] : ['N', 'E', 'S', 'W'];

      teams.forEach((team, teamId) => {
        team.id = teamId;
        team.position = positions[teamId];
      });

      if (this.type === 'chaos') {
        teams.unshift(Team.create({
          slot: 4,
          name: 'Chaos',
          colorId: 'White',
          bot: 'Chaos',
          set: {
            units: [{
              type: 'ChaosSeed',
              assignment: [5, 5],
            }],
          },
          position: 'C',
          joinedAt: new Date(),
        }));

        teams.forEach((team, teamId) => {
          team.id = teamId;
        });
      }

      let unitId = 1;

      // Place the units according to team position.
      this.units = teams.map(team => {
        return team.set.units.map(unitSetData => {
          let degree = board.getDegree('N', team.position);
          let tile   = board.getTileRotation(unitSetData.assignment, degree);

          let unitState = {
            id: unitId++,
            ...unitSetData,
            assignment: [tile.x, tile.y],
          };

          if (unitState.direction)
            unitState.direction = board.getRotation(unitState.direction, degree);

          return unitState;
        });
      });
    }

    board.setState(this.units, teams);
    this.units = board.getState();

    this._bots = teams
      .filter(t => !!t.bot)
      .map(t => botFactory(t.bot, this, t));

    if (!this.startedAt) {
      // The game and first turn starts at the same time.  This guarantee enables
      // use to determine if a given turn is the first playable turn by comparing
      // the turn start date with the game start date.  This is currently used for
      // triggering "Your Turn" notifications at the right times.
      this.startedAt = new Date();
      this.turnStartedAt = this.startedAt;

      if (this.turnTimeBuffer)
        for (const team of this.teams)
          team.turnTimeBuffer = 0;

      // First turn must be passed, but at least recovery drops.
      // The second turn might be passed, too, if all units are in recovery.
      // Even after auto passing, the game and next turn starts at the same time.
      this.autoPass();

      this._emit({
        type: 'startGame',
        data: {
          startedAt: this.startedAt,
          teams: this.teams.map(t => t.getData(true)),
          units: this.units,
        },
      });

      this.startTurn();
    }
  }

  /*
   * This method is used when transmitting game state from the server to client.
   * It does not include all of the data that is serialized by toJSON().
   */
  getData() {
    return {
      type:  this.type,
      randomFirstTurn: this.randomFirstTurn,
      randomHitChance: this.randomHitChance,
      strictUndo: this.strictUndo,
      strictFork: this.strictFork,
      autoSurrender: this.autoSurrender,
      rated: this.rated,
      turnTimeLimit: this.turnTimeLimit,
      turnTimeBuffer: this.turnTimeBuffer,
      currentTurnTimeLimit: this.currentTurnTimeLimit,

      teams: this.teams.map(t => t && t.getData(!!this.startedAt)),

      startedAt: this.startedAt,

      // Data about the current turn
      currentTurnId: this.currentTurnId,
      currentTeamId: this.currentTeamId,
      turnStartedAt: this.turnStartedAt,
      units:         this.units,
      actions:       this.actions,

      endedAt: this.endedAt,
      winnerId: this.winnerId,
    };
  }
  /*
   * Sometimes a player may only view an earlier state
   */
  getDataForPlayer(playerId = 'anonymous') {
    const data = this.getData();
    // Everybody sees the game start and end
    // Everybody sees everything in unrated games.
    if (!this.startedAt || this.endedAt || !this.rated)
      return data;

    /*
     * The current turn is the last turn that wasn't forced to pass.
     */
    const teams = this.teams;
    let currentTurn = this.getTurnData();
    while (
      currentTurn.actions.length === 1 &&
      currentTurn.actions[0].type === 'endTurn' &&
      currentTurn.actions[0].forced
    )
      currentTurn = this.getTurnData(currentTurn.id - 1);

    // Current player sees everything
    if (playerId === teams[currentTurn.teamId].playerId)
      return data;

    const isOpponent = teams.findIndex(t => t.playerId === playerId) > -1;

    if (!isOpponent) {
      // Observer(s) don't see recent turns
      const minTurnId = this.getFirstTurnId() - 1;
      const turnId = Math.max(minTurnId, currentTurn.id - teams.length);
      currentTurn = this.getTurnData(turnId);
    }

    if (currentTurn.id !== this.currentTurnId) {
      data.currentTurnId = currentTurn.id;
      data.currentTeamId = currentTurn.teamId;
      data.turnStartedAt = currentTurn.startedAt;
      data.currentTurnTimeLimit = null;
      data.units = currentTurn.units;
      data.actions = currentTurn.actions;
    }

    // Opponents can only see actions that can't be undone without approval
    if (isOpponent)
      data.actions.length = this.getPreservedActionId(currentTurn.id);

    return data;
  }
  getTurnData(turnId = this.currentTurnId) {
    let turnData;

    if (turnId === this.currentTurnId)
      turnData = {
        startedAt: this.turnStartedAt,
        units: this.units,
        actions: this._actions,
      };
    else if (!this.turns[turnId])
      return null;
    else {
      turnData = {...this.turns[turnId]};
      delete turnData.timeBuffer;
    }

    turnData.id = turnId;
    turnData.teamId = turnId % this.teams.length;

    return turnData;
  }
  getTurnActions(turnId) {
    let turnActions;

    if (turnId === this.currentTurnId)
      turnActions = this._actions;
    else if (turnId < this.currentTurnId)
      turnActions = this.turns[turnId].actions;
    else
      throw new ServerError(409, 'No such turn ID');

    return turnActions;
  }

  _pushActions(actions) {
    // Actions may only be submitted between game start and end.
    if (!this.startedAt)
      throw new Error(400, 'Game has not started yet');
    if (this.endedAt)
      throw new Error(409, 'Game has already ended');

    if (!Array.isArray(actions))
      actions = [ actions ];

    const board = this._board;
    actions = board.decodeAction(actions);

    let endTurn;
    const setEndTurn = forced => {
      endTurn = this._getEndTurnAction(forced);
      return true;
    };

    // Validate actions until the turn ends.
    actions.find(action => {
      if (action.type === 'endTurn')
        return setEndTurn(action.forced);

      if (action.type === 'surrender') {
        const team = this._validateSurrenderAction(action);

        this._pushAction({
          type: 'surrender',
          teamId: team.id,
          results: this._getSurrenderResults(team),
          declaredBy: action.declaredBy,
          forced: team.playerId !== action.declaredBy,
        });

        if (team === this.currentTeam)
          return setEndTurn(true);
        return;
      }

      const actions = this._actions;
      if (actions.length && actions.last.type === 'endTurn')
        throw new ServerError(400, 'Actions found after endTurn');

      /*
       * Validate and populate the action
       */
      // Only a unit that exists may take action.
      const unit = action.unit;
      if (!unit)
        throw new ServerError(400, 'Action found with no unit');

      // Only a unit from the current team may take action.
      if (unit.team !== this.currentTeam)
        throw new ServerError(400, 'Actor is on the wrong team');

      // Only the first unit to take action may take another.
      const selected = this.selected;
      if (selected && unit !== selected)
        throw new ServerError(400, 'Actor is not the selected unit');

      // Recovering or paralyzed units can't take action.
      if (unit.mRecovery || unit.paralyzed)
        throw new ServerError(400, 'Actor is unable to act');

      if (actions.length === 0)
        this._pushAction({ type:'select', unit });

      // Taking an action may break certain status effects.
      const breakAction = unit.getBreakAction(action);
      if (breakAction)
        this._pushAction(breakAction);

      // Apply unit-specific validation and determine results.
      action = unit.validateAction(action);
      if (!action)
        throw new ServerError(403, 'Action is not allowed');

      /*
       * Validate the action taking game state into consideration.
       */
      const moved    = this.moved;
      const attacked = this.attacked;

      if (action.type === 'move') {
        // Can't move twice.
        if (moved)
          throw new ServerError(403, 'Too many move actions');
      } else if (action.type === 'attack' || action.type === 'attackSpecial') {
        // Can't attack twice
        if (attacked)
          throw new ServerError(403, 'Too many attack actions');

        // Can't attack if poisoned at turn start.
        const unitState = this.units[unit.team.id].find(u => u.id === unit.id);
        if (unitState.poisoned)
          throw new ServerError(403, 'Poisoned units cannot attack');
      }

      // Turning in the current direction is the same as ending your turn.
      if (action.type === 'turn' && action.direction === unit.direction)
        return setEndTurn();

      this._pushAction(action);

      // A turn action immediately ends the turn.
      if (action.type === 'turn')
        return setEndTurn(true);

      /*
       * If the unit is unable to continue, end the turn early.
       *   1) Pyromancer killed himself.
       *   2) Knight attacked Chaos Seed and killed by counter-attack.
       *   3) Assassin blew herself up.
       *   4) Enchantress paralyzed at least 1 unit.
       *   5) Lightning Ward attacked.
       *   6) Furgon did special attack - immediately incurring recovery
       */
      if (action.type === 'attack' || action.type === 'attackSpecial') {
        const forceEndTurn = () => {
          if (unit.mHealth === -unit.health)
            return true;
          if (unit.focusing)
            return true;
          if (unit.mRecovery)
            return true;
          if ((this.moved || !unit.canMove()) && !unit.canTurn())
            return true;
          if (this.winningTeams.length < 2)
            return true;
        };

        if (forceEndTurn())
          return setEndTurn(true);

        // Can any victims counter-attack?
        return action.results.find(result => {
          const unit = result.unit;
          if (!unit.canCounter()) return;

          const counterAction = unit.getCounterAction(action.unit, result);
          if (!counterAction) return;

          this._pushAction(counterAction);

          if (forceEndTurn())
            return setEndTurn(true);
        });
      }
    });

    return endTurn;
  }
  _pushAction(action) {
    const actions = this._actions;

    // Auto passed turns start and end at the same time.  This guarantee enables
    // use to determine if a given turn is the first playable turn by comparing
    // the turn start date with the game start date.  This is currently used for
    // triggering "Your Turn" notifications at the right times.
    if (actions.length === 0 && action.type === 'endTurn' && action.forced)
      action.createdAt = this.turnStartedAt;
    else {
      action.createdAt = new Date();

      if (actions.last?.type === 'endTurn')
        this._pushHistory(actions.last.forced ? actions.last.createdAt : action.createdAt);
    }

    action.teamId = action.teamId ?? this.currentTeamId;

    if (action.forced === false)
      delete action.forced;

    this._newActions.push(action);
    this._applyAction(action);
  }
  submitAction(actions) {
    this._newActions = [];
    let endTurn;

    /*
     * If the full transaction isn't a success, rollback any changes that were pending.
     */
    try {
      endTurn = this._pushActions(actions);
    } catch(error) {
      if (this._newActions.length)
        this.revert(this.currentTurnId, this._actions.length - this._newActions.length, true);

      throw error;
    }

    // Find teams that has a unit that keeps it alive.
    const winners = this.winningTeams;
    let endGame;
    if (winners.length === 0) {
      if (endTurn)
        this._pushAction(endTurn);
      endGame = 'draw';
    } else if (winners.length === 1) {
      if (endTurn)
        this._pushAction(endTurn);
      endGame = winners[0].id;
    } else if (endTurn) {
      // Team Chaos needs a chance to phase before ending their turn.
      const currentTeam = this.currentTeam;
      if (currentTeam.name === 'Chaos') {
        const phaseAction = currentTeam.units[0].getPhaseAction();
        if (phaseAction)
          this._pushAction(phaseAction);
      }

      this._pushAction(endTurn);
      endGame = this.autoPass();
    }

    if (!this._newActions.length)
      return;

    const event = {
      type: 'action',
      data: this._board.encodeAction(this._newActions),
    };
    this._emit(event);

    if (endGame !== undefined)
      this.end(endGame);
    else {
      // At the very least, echo actions back to submitter.
      this.sync(event);

      // Rated games hide undoable actions from opponents
      //   If strict mode, all actions are seen by opponent(s) after a timeout
      //   If turn ended, start turn after a timeout
      if (this.rated && (this.strictUndo || endTurn))
        this.willSync();
    }
  }
  /*
   * Keep ending turns until a team is capable of making their turn.
   * ...or the game ends due to draw.
   */
  autoPass() {
    let {
      passedTurnLimit,
      passedTurnCount,
      attackTurnLimit,
      attackTurnCount
    } = this.calcDrawCounts();

    // First turn is always auto passed (unless it is the Chaos challenge)
    if (this.currentTurnId === 0 && this.type !== 'chaos')
      this._pushAction(this._getEndTurnAction(true));

    let turnEnded = true;
    while (turnEnded) {
      if (passedTurnCount === passedTurnLimit || attackTurnCount === attackTurnLimit)
        return 'draw';

      const currentTurnId = this._actions.last?.type === 'endTurn' ? this.currentTurnId + 1 : this.currentTurnId;
      const currentTeamId = currentTurnId % this.teams.length;
      const currentTeam = this.teams[currentTeamId];

      // End the next turn if we can't find one playable unit.
      turnEnded = !currentTeam.units.find(unit => {
        if (unit.mRecovery) return;
        if (unit.paralyzed) return;
        if (unit.type === 'Shrub') return;

        return true;
      });

      if (turnEnded) {
        if (currentTurnId > this.currentTurnId)
          this._pushHistory();
        this._pushAction(this._getEndTurnAction(true));
        passedTurnCount++;
        attackTurnCount++;
      }
    }
  }

  calcDrawCounts() {
    // If all teams pass their turns 3 times, draw!
    const passedTurnLimit = this.teams.length * 3;
    let passedTurnCount = 0;
    let stopCountingPassedTurns = false;

    // If no teams attack each other for 15 cycles, draw!
    const attackTurnLimit = this.teams.length * 15;
    let attackTurnCount = 0;

    /*
     * Determine current draw counts from the game history.
     * The min turnId is 0 not -1.  The always passed 1st turn doesn't count.
     */
    const maxTurnId = this.currentTurnId - 1;
    const minTurnId = Math.max(0, maxTurnId - attackTurnLimit);
    TURN:for (let i = maxTurnId; i > minTurnId; i--) {
      const actions = this.turns[i].actions;
      const teamsUnits = this.turns[i].units;

      // If the only action that took place is ending the turn...
      if (actions.length === 1) {
        if (!stopCountingPassedTurns && ++passedTurnCount === passedTurnLimit)
          break;
      } else {
        stopCountingPassedTurns = true;

        for (let j = 0; j < actions.length-1; j++) {
          const action = actions[j];
          if (!action.type.startsWith('attack')) continue;

          let attackerTeamId;
          for (let t = 0; t < teamsUnits.length; t++) {
            if (teamsUnits[t].find(u => u.id === action.unit)) {
              attackerTeamId = t;
              break;
            }
          }

          for (let k = 0; k < action.results.length; k++) {
            const result = action.results[k];
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

    return { passedTurnLimit, passedTurnCount, attackTurnLimit, attackTurnCount };
  }
  getFirstTurnId() {
    return Math.min(...this.teams.map(t => this.getTeamFirstTurnId(t)));
  }
  getTeamFirstTurnId(team) {
    const numTeams = this.teams.length;
    const waitTurns = Math.min(...team.set.units.map(u => u.mRecovery ?? 0));
    const skipTurns = numTeams === 2 && team.id === 0 ? 1 : 0;

    return team.id + (numTeams * Math.max(waitTurns, skipTurns));
  }
  getTurnTimeLimit(turnId = this.currentTurnId) {
    if (!this.startedAt || this.endedAt || !this.turnTimeLimit)
      return null;

    let turnTimeLimit = this.turnTimeLimit;
    if (this.turnTimeBuffer) {
      const teams = this.teams;
      const teamId = turnId % teams.length;
      const firstTurnId = this.getTeamFirstTurnId(teams[teamId]);
      if (turnId === firstTurnId)
        return this.turnTimeBuffer;

      const turnTimeBuffer = turnId === this.currentTurnId ? this.currentTeam.turnTimeBuffer : this.turns[turnId].timeBuffer;
      turnTimeLimit += turnTimeBuffer;
    }

    return turnTimeLimit;
  }
  getTurnTimeRemaining(turnId = this.currentTurnId, now = Date.now()) {
    if (!this.startedAt || this.endedAt)
      return false;
    if (!this.turnTimeLimit)
      return Infinity;

    const turnTimeLimit = this.getTurnTimeLimit(turnId);
    const turnTimeout = +this.turnStartedAt + turnTimeLimit*1000 - now;

    return Math.max(0, turnTimeout);
  }

  teamHasPlayed(team) {
    if ([ 'truce', 'draw', team.id ].includes(this.winnerId))
      return true;

    const firstTurnId = this.getTeamFirstTurnId(team);
    if (this.currentTurnId < firstTurnId)
      return false;

    /*
     * If the game ended on the turn after this team's first turn, then it
     * is possible that this team surrendered.  If so, turn not played.
     */
    const actions = this.currentTurnId === firstTurnId
      ? this.actions
      : this.turns[firstTurnId].actions;
    const playedAction = actions.find(a => a.type !== 'surrender' && !a.forced);
    if (!playedAction)
      return false;

    return true;
  }

  /*
   * Determine if provided team may request an undo.
   * Also indicate if approval should be required of opponents.
   */
  canUndo(team = this.currentTeam, now = Date.now()) {
    const teams = this.teams;
    const currentTurnId = this.currentTurnId;
    const actions = this._actions;

    // Practice games don't impose restrictions.
    const bot = teams.find(t => !!t.bot);
    const opponent = teams.find(t => t.playerId !== team.playerId);
    if (!bot && !opponent)
      return !!(currentTurnId > 1 || actions.length > 0);

    // Bots will never approve anything that requires approval.
    // Approval is also disabled for blitz games with auto surrender.
    const approve = bot || this.turnTimeLimit === 30 && this.autoSurrender ? false : 'approve';
    const firstTurnId = this.getTeamFirstTurnId(team);

    // Can't undo if we haven't had a turn yet.
    if (firstTurnId > currentTurnId)
      return false;

    // Can't undo if we haven't made an action yet.
    if (firstTurnId === currentTurnId && actions.length === 0)
      return false;

    // Only unrated games can undo after the game ends.
    if (this.endedAt)
      return this.rated ? false : approve;

    // Only unrated games can undo after the turn ends.
    const prevTeamId = (this.currentTeamId + teams.length - 1) % teams.length;
    if (team.id === prevTeamId)
      return this.rated ? false : actions.length === 0 ? true : approve;
    else if (team.id !== this.currentTeamId)
      return this.rated ? false : approve;
    else if (actions.length === 0)
      return this.rated ? false : approve;

    // Require approval if undoing a lucky or old action
    const preservedActionId = this.getPreservedActionId(currentTurnId, now);
    if (preservedActionId === actions.length)
      return actions.last?.type === 'endTurn' ? false : approve;

    return true;
  }

  /*
   * Initiate an undo action by provided team (defaults to current turn's team)
   */
  undo(team = this.currentTeam, approved = false, now = Date.now()) {
    const teams = this.teams;
    const currentTurnId = this.currentTurnId;
    let actions = this._actions;

    const bot = teams.find(t => !!t.bot);
    const opponent = teams.find(t => t.playerId !== team.playerId);
    const firstTurnId = this.getTeamFirstTurnId(team);

    // Can't undo if we haven't had a turn yet.
    if (firstTurnId > currentTurnId)
      return false;

    // Can't undo if we haven't made an action yet.
    if (firstTurnId === currentTurnId && actions.length === 0)
      return false;

    // Practice games don't impose restrictions.
    if (!bot && !opponent) {
      for (let turnId = this.currentTurnId; turnId > -1; turnId--) {
        actions = this.getTurnActions(turnId);

        // Not an actionable turn if the turn was forced to pass.
        if (actions.length === 0)
          continue;

        // Not an actionable turn if the turn was forced to pass.
        if (
          actions.length === 1 &&
          actions[0].type === 'endTurn' &&
          actions[0].forced
        ) continue;

        this.revert(turnId);
        break;
      }
    } else {
      for (let turnId = this.currentTurnId; turnId > -1; turnId--) {
        actions = this.getTurnActions(turnId);

        // Current turn not actionable if no actions were made by opponent yet.
        if (actions.length === 0)
          continue;

        // Not an actionable turn if the turn was forced to pass.
        if (
          actions.length === 1 &&
          actions[0].type === 'endTurn' &&
          actions[0].forced
        ) continue;

        // Not an actionable turn if it isn't the team's turn
        const teamId = turnId % teams.length;
        if (teamId !== team.id)
          continue;

        /*
         * Some actions should not be undone unless approved.
         */
        const actionId = approved ? 0 : this.getPreservedActionId(turnId, now);

        this.revert(turnId, actionId);
        break;
      }
    }
  }
  getPreservedActionId(turnId = this.currentTurnId, now = Date.now()) {
    const actions = this.getTurnActions(turnId);
    if (actions.length === 0)
      return 0;
    if (this.rated && this.getTurnTimeRemaining(turnId, now) === 0)
      return actions.length;

    const selectedUnitId = actions[0].unit;
    const forcedEndTurn = actions.last.type === 'endTurn' && actions.last.forced;

    let actionId = actions.findLastIndex(action => (
      // Preserve any old action in strict mode
      this.strictUndo && (action.type === 'select' || now - action.createdAt > 5000) ||
      // Preserve an old end turn action in rated games
      this.rated && action.type === 'endTurn' && now - action.createdAt > 5000 ||
      // Preserve counter-attacks
      action.unit !== undefined && action.unit !== selectedUnitId ||
      // Preserve luck-involved attacks
      !!action.results && !!action.results.find(r => 'luck' in r)
    )) + 1;

    // If the only action that can be undone is a forced endTurn, then nothing can be undone
    if (actions.length > 1 && actionId === actions.length - 1 && forcedEndTurn)
      actionId++;

    // In strict undo mode, you may only undo one action (forced endTurn doesn't count)
    if (this.strictUndo && actionId < actions.length)
      return forcedEndTurn ? actions.length - 2 : actions.length - 1;

    return actionId;
  }
  startTurn() {
    this._pushHistory();

    const event = {
      type: 'startTurn',
      data: {
        turnId: this.currentTurnId,
        teamId: this.currentTeamId,
        startedAt: this.turnStartedAt,
        timeLimit: this.currentTurnTimeLimit,
      },
    };

    this._emit(event);
    this.sync(event);
  }
  end(winnerId) {
    this.endedAt = new Date();
    this.winnerId = winnerId;

    const event = {
      type: 'endGame',
      data: { winnerId },
    };

    this._emit(event);
    this.sync(event);
  }
  sync(originalEvent) {
    const actions = this._actions;
    if (actions.length && actions.last.type === 'endTurn' && (!this.rated || this.getPreservedActionId() === actions.length))
      return this.startTurn();

    this._emit({ type:'sync', data:originalEvent });
  }
  /*
   * This is only called after an action is submitted.
   * The game is assumed to be rated.
   * Strict mode is assumed to be enabled or the turn ended.
   */
  willSync() {
    const actions = this._actions;
    if (actions.length === 0)
      return;

    const now = Date.now();
    const actionTimeout = Math.max(0, 5000 - (now - actions.last.createdAt));
    const turnTimeout = this.getTurnTimeRemaining(this.currentTurnId, now);

    // Let opponents know an action has occurred 5 seconds after it was submitted.
    // Start a turn 5 seconds after the previous one ends.
    if (turnTimeout || actionTimeout)
      this._emit({ type:'willSync', data:Math.min(actionTimeout, turnTimeout) });
  }
  revert(turnId, actionId = 0, silent = false) {
    const board = this._board;
    let actions;
    if (turnId === this.currentTurnId)
      actions = this._resetTurn();
    else
      actions = this._popHistory(turnId).actions.slice(0, -1);

    if (actionId)
      for (let i = 0; i < actionId; i++) {
        const action = actions[i];
        if (!action) break;

        this._applyAction(board.decodeAction(action));
      }

    // Forking and reverting an ended game makes it no longer ended.
    this.endedAt = null;
    this.winnerId = null;

    if (silent) return;

    const event = {
      type: 'revert',
      data: {
        turnId: this.currentTurnId,
        teamId: this.currentTeamId,
        startedAt: this.turnStartedAt,
        timeLimit: this.currentTurnTimeLimit,
        actions: this.actions,
        units: this.units,
      },
    };

    this._emit(event);
    this.sync(event);

    // Just in case the previous action is still fresh
    if (this.rated && this.strictUndo)
      this.willSync();
  }

  /*
   * Intended for serializing game data for persistent storage.
   */
  toJSON() {
    const turns = this.turns.slice().map(t => ({ ...t }));
    if (this.turnTimeBuffer) {
      for (const turn of turns) {
        if (turn.timeBuffer === 0)
          delete turn.timeBuffer;
      }
    }

    return {
      type: this.type,
      randomFirstTurn: this.randomFirstTurn,
      randomHitChance: this.randomHitChance,
      strictUndo: this.strictUndo,
      strictFork: this.strictFork,
      autoSurrender: this.autoSurrender,
      rated: this.rated,
      turnTimeLimit: this.turnTimeLimit,
      turnTimeBuffer: this.turnTimeBuffer,

      teams: this.teams,

      startedAt: this.startedAt,

      turnStartedAt: this.turnStartedAt,
      turns,
      units: this.units,
      actions: this.actions,

      endedAt: this.endedAt,
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
    const action = { type:'endTurn', forced };

    const selected    = this.selected;
    const moved       = this.moved;
    const attacked    = this.attacked;
    const teams       = this.teams;
    const currentTeam = this.currentTeam;
    const results     = action.results = [];

    // Per turn mBlocking decay rate is based on the number of teams.
    // It is calculated such that a full turn cycle is still a 20% reduction.
    const decay = teams.length;

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
      addResults: addedResults => {
        for (const addedResult of addedResults) {
          const result = results.find(r => r.unit === addedResult.unit);
          if (result)
            result.changes.merge(addedResult.changes);
          else
            results.push(addedResult);
        }
      },
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
    if (action.declaredBy === 'system')
      return this.currentTeam;

    const teams = this.teams;
    if (action.teamId === undefined) {
      if (action.declaredBy !== 'system') {
        for (let i = 0; i < teams.length; i++) {
          const teamId = (this.currentTeamId + i) % teams.length;
          if (teams[teamId].playerId !== action.declaredBy)
            continue;

          action.teamId = teamId;
          break;
        }
      } else
        action.teamId = this.currentTeamId;
    }

    const team = teams[action.teamId];
    if (!team || !team.units.length)
      throw new ServerError(400, 'No such team ID');

    // If surrender is declared by someone other than the team's owner...
    if (action.declaredBy !== team.playerId) {
      // It must be the team's turn.
      if (team !== this.currentTeam)
        throw new ServerError(403, "It is not the team's turn");

      // The team's timeout must be exceeded.
      if (this.turnTimeLimit && this.getTurnTimeRemaining() > 0)
        throw new ServerError(403, 'The time limit has not been exceeded');
    }

    return team;
  }
  _getSurrenderResults(team) {
    const board = this._board;

    return team.units.map(unit => {
      const result = { unit, changes:{ mHealth:-unit.health } };
      const subResults = [];

      // Most attacks break the focus of focusing units.
      if (unit.focusing)
        subResults.push(...unit.getBreakFocusResult(true));

      // Remove focus from dead units
      if (unit.paralyzed || unit.poisoned || unit.armored || unit.barriered) {
        const focusingUnits = [
          ...(unit.paralyzed || []),
          ...(unit.poisoned  || []),
          ...(unit.armored   || []),
          ...(unit.barriered || []),
        ];

        // All units focusing on this dead unit can stop.
        for (const fUnit of focusingUnits) {
          if (fUnit === unit)
            continue;

          const subResult = {
            unit: fUnit,
            changes: {
              focusing: fUnit.focusing.length === 1
                ? false
                : fUnit.focusing.filter(u => u !== unit),
            }
          };

          const index = subResults.findIndex(r => r.unit === fUnit);
          if (index > -1)
            subResults[index].changes.merge(subResult.changes);
          else
            subResults.push(subResult);
        }

        // Stop showing the unit as paralyzed, poisoned, or barriered
        if (unit.paralyzed || unit.poisoned || unit.barriered) {
          const subChanges = {};
          if (unit.paralyzed)
            subChanges.paralyzed = false;
          if (unit.poisoned)
            subChanges.poisoned = false;
          if (unit.barriered)
            subChanges.barriered = false;

          const subResult = {
            unit: unit,
            changes: subChanges,
          };

          const index = subResults.findIndex(r => r.unit === unit);
          if (index > -1)
            subResults[index].changes.merge(subResult.changes);
          else
            subResults.push(subResult);
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
  }

  _resetTurn() {
    // Get and return the (encoded) actions that were reset.
    const actions = this.actions;

    this._board.setState(this.units, this.teams);
    this._actions.length = 0;

    return actions;
  }
  _pushHistory(nextTurnStartsAt = new Date()) {
    const turn = this.currentTurn;

    if (this.turnTimeBuffer && (turn.actions.length > 1 || !turn.actions.last.forced)) {
      const turnStartedAt = turn.startedAt;
      const turnEndedAt = turn.actions.last.createdAt;
      const team = this.currentTeam;
      const firstTurnId = this.getTeamFirstTurnId(team);

      if (this.currentTurnId > firstTurnId) {
        const turnTimeBuffer = this.turnTimeBuffer;
        const turnTimeLimit = this.turnTimeLimit;
        const elapsed = Math.floor((turnEndedAt - turnStartedAt) / 1000);
        if (elapsed > turnTimeLimit)
          team.turnTimeBuffer = 0;
        else
          team.turnTimeBuffer = Math.min(turnTimeBuffer, team.turnTimeBuffer + Math.max(0, (turnTimeLimit / 2) - elapsed));
      }
    }

    this.turns.push(turn);
    this.turnStartedAt = nextTurnStartsAt;
    this.units = this._board.getState();
    this._actions.length = 0;

    return this;
  }
  /*
   * By default, reverts game state to the beginning of the previous turn.
   * 'turnId' can be used to revert to any previous turn by ID.
   */
  _popHistory(turnId) {
    const turns = this.turns;
    if (turns.length === 0) return;

    if (turnId === undefined)
      turnId = turns.length - 1;

    const turnData = turns[turnId];

    // Truncate the turn history.
    turns.length = turnId;

    Object.assign(this, {
      // Preserve the original turn start so that a client may successfully
      // resume the game after their opponent reverted to a previous turn.
      turnStartedAt: turnData.startedAt,
      units: turnData.units,
      _actions: [],
    });

    if (this.turnTimeBuffer) {
      this.currentTeam.turnTimeBuffer = turnData.timeBuffer;

      /*
       * Sync up other teams' turn time buffers just in case more than one turn
       * was popped.
       */
      const numTeams = this.teams.length;
      for (let tId = Math.max(0, turnId - numTeams + 1); tId < turnId; tId++) {
        this.teams[tId % numTeams].turnTimeBuffer = turns[tId].timeBuffer;
      }
    }

    this._board.setState(this.units, this.teams);

    return turnData;
  }
}

emitter(GameState);

serializer.addType({
  name: 'GameState',
  constructor: GameState,
  schema: {
    type: 'object',
    required: [
      'type', 'teams', 'startedAt', 'endedAt', 'turns', 'turnStartedAt',
      'units', 'actions',
    ],
    properties: {
      type: { type:'string' },
      randomFirstTurn: { type:'boolean' },
      randomHitChance: { type:'boolean' },
      strictUndo: { type:'boolean' },
      strictFork: { type:'boolean' },
      autoSurrender: { type:'boolean' },
      rated: { type:'boolean' },
      turnTimeLimit: { type:[ 'number', 'null' ] },
      turnTimeBuffer: { type:[ 'number', 'null' ] },
      teams: {
        type: 'array',
        minItems: 2,
        items: {
          oneOf: [
            { type:'null' },
            { $ref:'Team' },
          ],
        },
      },
      startedAt: { type:[ 'string', 'null' ], subType:'Date' },
      endedAt: { type:[ 'string', 'null' ], subType:'Date' },
      turns: {
        type: 'array',
        items: {
          type: 'object',
          required: [ 'startedAt', 'units', 'actions' ],
          properties: {
            startedAt: { type:'string', subType:'Date' },
            units: { $ref:'#/definitions/units' },
            actions: {
              type: 'array',
              items: { $ref:'#/definitions/action' },
              minItems: 1,
            },
          },
        },
      },
      turnStartedAt: { type:[ 'string', 'null' ], subType:'Date' },
      units: { $ref:'#/definitions/units' },
      actions: {
        type: 'array',
        items: { $ref:'#/definitions/action' },
        minItems: 1,
      },
      winnerId: {
        type: 'string',
        oneOf: [
          { format:'uuid' },
          { enum:[ 'draw', 'truce' ] },
        ],
      },
    },
    additionalProperties: false,
    definitions: {
      units: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'array',
          items: { type:'object' },
        },
      },
      action: {
        type: 'object',
        required: [ 'type' ],
        properties: {
          type: { type:'string' },
          unit: { type:'number' },
          results: {
            type: 'array',
            items: { type:'object' },
          },
          teamId: { type:'number' },
          forced: { type:'boolean', const:true },
          createdAt: { type:'string', subType:'Date' },
        },
        additionalProperties: true,
      },
    },
  },
});
