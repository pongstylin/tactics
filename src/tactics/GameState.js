import { applyTurnTimeLimit, getTurnTimeLimit } from '#config/timeLimit.js';
import Team from '#models/Team.js';
import Turn from '#models/Turn.js';
import ServerError from '#server/Error.js';
import Board from '#tactics/Board.js';
import botFactory from '#tactics/botFactory.js';
import emitter from '#utils/emitter.js';
import serializer from '#utils/serializer.js';

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

    Object.assign(this,
      {
        turns: [],
      },
      stateData,
      {
        _bots:       [],
        _board:      board,
        _newActions: [],
        _actions:    [],
      }
    );

    if (this.turns.length) {
      board.setState(this.units, this.teams);
      board.decodeAction(this.actions).forEach(a => this._applyAction(a));
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

    const teamsData = stateData.teams;
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
        timeLimit: null,
      },
      stateData,
      {
        teams: new Array(teamsData.length).fill(null),
      }
    );

    const gameState = new GameState(stateData);

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
    stateData.turns = stateData.turns.map((data, id) => new Turn({
      id,
      team: stateData.teams[id % stateData.teams.length],
      data,
      isCurrent: id === (stateData.turns.length - 1),
    }));

    const state = new GameState(stateData);

    if (state.timeLimit)
      for (const turn of state.turns)
        turn.timeLimit = getTurnTimeLimit[state.timeLimit.type].call(state, turn);

    return state;
  }

  /*****************************************************************************
   * Public Property Accessors
   ****************************************************************************/
  get board() {
    return this._board;
  }

  get startedAt() {
    return this.turns[0]?.startedAt ?? null;
  }

  get effectiveCurrentTurnId() {
    const currentTurn = this.currentTurn;
    return currentTurn.isEnded ? currentTurn.id + 1 : currentTurn.id;
  }

  get initialTurnId() {
    return Math.min(...this.teams.map(t => this.getTeamInitialTurnId(t)));
  }
  get currentTurnId() {
    return this.turns.last?.id ?? null;
  }
  get currentTurn() {
    return this.turns.last ?? null;
  }
  get currentTeamId() {
    return this.turns.last?.team.id ?? null;
  }
  get currentTeam() {
    return this.turns.last?.team ?? null;
  }
  get turnStartedAt() {
    return this.turns.last?.startedAt ?? null;
  }
  get turnEndedAt() {
    return this.turns.last?.endedAt ?? null;
  }
  get currentTurnTimeLimit() {
    return this.getTurnTimeLimit();
  }
  get actions() {
    return this.turns.last?.actions ?? null;
  }
  get moved() {
    return !!this.actions.find(a => a.type === 'move');
  }
  get attacked() {
    return !!this.actions.find(a => a.type === 'attack' || a.type === 'attackSpecial');
  }
  get units() {
    return this.turns.last?.units ?? null;
  }

  get previousTurnId() {
    return this.turns.length - 2;
  }
  get previousTurn() {
    return this.turns[this.previousTurnId] ?? null;
  }
  get previousTeamId() {
    return this.previousTurnId % this.teams.length;
  }
  get previousTeam() {
    return this.teams[this.previousTeamId];
  }

  get lockedTurnId() {
    if (!this.startedAt)
      return null;

    const minLockedTurnId = this.initialTurnId;

    // Only rated games can have a fluid locked turn ID.
    if (this.rated) {
      const maxLockedTurnId = this.turns.length - 1;
      for (let turnId = maxLockedTurnId; turnId > minLockedTurnId; turnId--)
        if (this.turns[turnId].isLocked)
          return turnId;
    }

    return minLockedTurnId;
  }

  get endedAt() {
    return this.turns.last?.gameEndedAt ?? null;
  }
  get winnerId() {
    const lastAction = this.turns.last?.actions.last;
    return lastAction?.type === 'endGame' ? lastAction.winnerId : null;
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
  get isPracticeGame() {
    const teams = this.teams;
    const hasBot = teams.findIndex(t => !!t.bot) > -1;
    const isMultiplayer = new Set(teams.map(t => t.playerId)).size > 1;

    return !hasBot && !isMultiplayer;
  }

  get selected() {
    return this._actions.find(a => a.type === 'select')?.unit ?? null;
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
    let currentTurn = this.currentTurn;

    // A turn is already present for forked games.
    if (!currentTurn) {
      /*
       * Turn order is always clockwise, but first turn can be random.
       */
      if (this.randomFirstTurn) {
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

      for (const [ teamId, team ] of teams.entries()) {
        team.id = teamId;
        team.position = positions[teamId];
      }

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
      } else {
        // First team must skip their first turn.
        for (const unit of teams[0].set.units)
          if (!unit.mRecovery)
            unit.mRecovery = 1;
      }

      let unitId = 1;

      // Place the units according to team position.
      const units = teams.map(team => {
        const degree = board.getDegree('N', team.position);
        const flipSide = team.randomSide && Math.random() < 0.5;

        return team.set.units.map(unitSetData => {
          const tile = flipSide === false || unitSetData.assignment[0] === 5
            ? board.getTileRotation(unitSetData.assignment, degree)
            : board.getTileRotation([ 10 - unitSetData.assignment[0], unitSetData.assignment[1] ], degree);

          const unitState = {
            id: unitId++,
            ...unitSetData,
            assignment: [tile.x, tile.y],
          };

          if (unitState.direction)
            unitState.direction = board.getRotation(unitState.direction, degree);

          return unitState;
        });
      });

      currentTurn = Turn.create({
        id: 0,
        team: this.teams[0],
        data: {
          startedAt: new Date(),
          units,
        },
      });
    }

    board.setState(currentTurn.units, teams);

    this._bots = teams
      .filter(t => !!t.bot)
      .map(t => botFactory(t.bot, this, t));

    // Fork games already have turns
    if (this.turns.length === 0) {
      this.turns.push(currentTurn);

      // First turn must be passed, but at least recovery drops.
      // The second turn might be passed, too, if all units are in recovery.
      // Even after auto passing, the first playable turn startedAt matches the
      // first turn startedAt.  This guarantee enables us to determine if a
      // given turn is the first playable turn by comparing the turn start date
      // with the first turn start date.  This is currently used for triggering
      // "Your Turn" notifications at the right times.
      this.autoPass(true);

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

  getTurnData(turnId) {
    const turn = this.turns[turnId];
    if (!turn)
      throw new ServerError(409, 'No such turn ID');

    return turn.getData();
  }
  getTurnActions(turnId) {
    return this.getTurnData(turnId).actions;
  }

  getData() {
    const data = {
      type: this.type,
      randomFirstTurn: this.randomFirstTurn,
      randomHitChance: this.randomHitChance,
      strictUndo: this.strictUndo,
      strictFork: this.strictFork,
      autoSurrender: this.autoSurrender,
      rated: this.rated,
      timeLimit: this.timeLimit,

      teams: this.teams.map(t => t && t.getData(!!this.startedAt)),

      // Normally derived from the full turn history the client doesn't have.
      startedAt: this.startedAt,
      lockedTurnId: this.lockedTurnId,
      currentTurnId: this.currentTurnId,
    };

    if (this.startedAt)
      data.recentTurns = [ this.currentTurn ];

    return data;
  }
  /*
   * This method is used when transmitting game state from the server to client.
   * It does not include all of the data that is serialized by toJSON().
   * Sometimes a player may only view an earlier state
   */
  getDataForPlayer(playerId = 'anonymous') {
    const team = this.getTeamForPlayer(playerId);
    const data = this.getData();

    if (this.startedAt) {
      // Provide enough history so that the client knows if they may undo.
      const pointer = this.getUndoPointer(team);
      if (pointer)
        data.recentTurns = this.turns.slice(pointer.turnId);
    }

    // Everybody sees the game start and end
    // Everybody sees everything in unrated games.
    if (!this.startedAt || this.endedAt || !this.rated)
      return data;

    if (team) {
      if (team !== this.currentTeam) {
        // Opponents can't see recent activity that can be freely undone.
        const context = this.getUndoPointer(this.currentTeam, true);
        if (context) {
          data.currentTurnId = context.turnId;
          data.recentTurns = Object.clone([ this.turns[data.currentTurnId] ]);
          data.recentTurns.last.nextActionId = context.actionId;
          data.recentTurns.last.isCurrent = true;
        }
      }
    } else {
      // Observer(s) don't see real recent turns in rated games
      data.currentTurnId = this.lockedTurnId;
      data.recentTurns = Object.clone([ this.turns[data.currentTurnId] ]);
      data.recentTurns.last.nextActionId = 0;
      data.recentTurns.last.isCurrent = true;
    }

    return data;
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

      if (this.currentTurn.isEnded)
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

      if (this.currentTurn.isEmpty)
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
    const currentTurn = this.currentTurn;
    const actions = currentTurn.actions;

    // Auto passed turns start and end at the same time.  This guarantee enables
    // us to determine if a given turn is the first playable turn by comparing
    // the turn start date with the game start date.  This is currently used for
    // triggering "Your Turn" notifications at the right times.
    action.createdAt = currentTurn.isEmpty && [ 'endTurn', 'endGame' ].includes(action.type) && action.forced
      ? currentTurn.startedAt
      : new Date();
    if (action.type !== 'endGame')
      action.teamId = action.teamId ?? currentTurn.team.id;

    if (action.forced === false)
      delete action.forced;

    // This can be true when a game ends in a draw after ending a turn.
    if (currentTurn.isEnded)
      this._pushHistory(actions.last.forced ? actions.last.createdAt : action.createdAt);
    // Do not use the currentTurn object defined above since the currentTurn may have changed
    this.currentTurn.pushAction(this._board.encodeAction(action));

    this._newActions.push(action);
    this._applyAction(action);
  }
  submitAction(actions) {
    let endTurn;

    /*
     * If the full transaction isn't a success, rollback any changes that were pending.
     */
    try {
      endTurn = this._pushActions(actions);
    } catch(error) {
      this.revert(this.currentTurnId, this._actions.length - this._newActions.length);

      throw error;
    }

    // Find teams that has a unit that keeps it alive.
    const winners = this.winningTeams;
    if (winners.length === 0)
      return this.end('draw');
    else if (winners.length === 1)
      return this.end(winners[0].id);

    if (endTurn) {
      if (this.type === 'chaos') {
        // Team Chaos needs a chance to phase before ending their turn.
        const currentTeam = this.currentTeam;
        if (currentTeam.name === 'Chaos') {
          const phaseAction = currentTeam.units[0].getPhaseAction();
          if (phaseAction)
            this._pushAction(phaseAction);
        }
      }

      this._pushAction(endTurn);
      if (this.autoPass())
        return this.end('draw');
    } else if (this._newActions.length === 0)
      return;

    this._emit({
      type: 'action',
      data: this._board.encodeAction(this._newActions),
    });
    this._newActions.length = 0;

    // At the very least, echo actions back to submitter.
    this.sync('action');
  }
  /*
   * Only called when a turn ends or just began.
   * Keep ending turns until a team is capable of making their turn.
   * ...or the game ends due to draw.
   */
  autoPass(startNextTurn = false) {
    let {
      passedTurnLimit,
      passedTurnCount,
      attackTurnLimit,
      attackTurnCount
    } = this.calcDrawCounts();

    let turnEnded = true;
    while (turnEnded) {
      if (passedTurnCount === passedTurnLimit || attackTurnCount === attackTurnLimit)
        return 'draw';

      const currentTurnId = this.effectiveCurrentTurnId;
      const currentTeamId = currentTurnId % this.teams.length;
      const currentTeam = this.teams[currentTeamId];

      // End the next turn if we can't find one playable unit.
      turnEnded = !currentTeam.units.some(unit => {
        if (unit.mRecovery) return;
        if (unit.paralyzed) return;
        if (unit.type === 'Shrub') return;

        return true;
      });

      if (turnEnded) {
        if (this.currentTurn.isEnded)
          this._pushHistory();
        this._pushAction(this._getEndTurnAction(true));
        passedTurnCount++;
        attackTurnCount++;
      }
    }

    if (startNextTurn && this.currentTurn.isEnded)
      this._pushHistory();
  }

  calcDrawCounts() {
    const counts = {
      // If all teams pass their turns 3 times, draw!
      passedTurnLimit: this.teams.length * 3,
      passedTurnCount: 0,
      // If no teams attack each other for 15 cycles, draw!
      attackTurnLimit: this.teams.length * 15,
      attackTurnCount: 0,
    };
    const initialTurnId = this.initialTurnId;
    const stopTurnId = this.effectiveCurrentTurnId;
    const startTurnId = Math.max(initialTurnId, stopTurnId - counts.attackTurnLimit);
    const turns = this.turns.slice(startTurnId, stopTurnId).reverse();

    let stopCountingPassedTurns = false;

    /*
     * Determine current draw counts from the game history.
     * The min turnId is 0 not -1.  The always passed 1st turn doesn't count.
     */
    TURN:for (const turn of turns) {
      // If the only action that took place is ending the turn...
      if (turn.actions.length === 1) {
        if (!stopCountingPassedTurns && ++counts.passedTurnCount === counts.passedTurnLimit)
          break;
      } else {
        stopCountingPassedTurns = true;

        for (let j = 0; j < turn.actions.length-1; j++) {
          const action = turn.actions[j];
          if (!action.type.startsWith('attack')) continue;

          let attackerTeamId;
          for (let t = 0; t < turn.units.length; t++) {
            if (turn.units[t].find(u => u.id === action.unit)) {
              attackerTeamId = t;
              break;
            }
          }

          for (let k = 0; k < action.results.length; k++) {
            const result = action.results[k];
            // This check ignores summoned units, e.g. shrubs
            if (typeof result.unit !== 'number') continue;
            // Ignore immune attacks
            if (result.miss === 'immune') continue;

            let defenderTeamId;
            for (let t = 0; t < turn.units.length; t++) {
              if (turn.units[t].find(u => u.id === result.unit)) {
                defenderTeamId = t;
                break;
              }
            }

            if (defenderTeamId !== attackerTeamId)
              break TURN;
          }
        }
      }

      counts.attackTurnCount++;
    }

    return counts;
  }
  getPreviousTeam(n = 1) {
    const teams = this.teams;
    const teamId = Math.abs(this.currentTeamId - n) % teams.length;

    return teams[teamId];
  }
  getNextTeam(n = 1) {
    const teams = this.teams;
    const teamId = (this.currentTeamId + n) % teams.length;

    return teams[teamId];
  }
  /*
   * Return the most recent team owned by the player, if any.
   */
  getTeamForPlayer(playerId) {
    const numTeams = this.teams.length;

    for (let i = 0; i < numTeams; i++) {
      const team = this.getPreviousTeam(i);
      if (team?.playerId === playerId)
        return team;
    }

    return null;
  }
  getTeamInitialTurnId(team) {
    const waitTurns = Math.min(...team.set.units.map(u => u.mRecovery ?? 0));

    return team.id + this.teams.length * waitTurns;
  }
  getTeamPreviousPlayableTurnId(team) {
    if (!this.startedAt)
      return null;

    for (const turn of this.playableTurnsInReverse()) {
      if (turn !== this.currentTurn && turn.team === team)
        return turn.id;
    }

    return null;
  }
  getPreviousPlayableTurnId(contextTurnId = this.currentTurnId) {
    return this.playableTurnsInReverse(contextTurnId - 1).next().value?.id ?? null;
  }
  *playableTurnsInReverse(contextTurnId = this.currentTurnId) {
    const turns = this.turns;
    const minTurnId = this.initialTurnId - 1;

    for (let turnId = contextTurnId; turnId > minTurnId; turnId--) {
      const turn = turns[turnId];
      if (!turn.isPlayable)
        continue;

      yield turn;
    }
  }
  getTurnTimeLimit(turnId = this.currentTurnId) {
    if (!this.startedAt || this.endedAt || !this.timeLimit)
      return null;

    const turn = this.turns[turnId];
    if (!turn)
      throw new Error('Attempt to get turn that does not exist');

    return turn.timeLimit;
  }
  getTurnTimeRemaining(turnId = this.currentTurnId) {
    if (!this.startedAt || this.endedAt)
      return false;
    if (!this.timeLimit)
      return Infinity;

    const turnTimeLimit = this.getTurnTimeLimit(turnId);
    const turnTimeout = this.turns[turnId].startedAt.getTime() + turnTimeLimit*1000 - Date.now();

    return Math.max(0, turnTimeout);
  }

  teamHasPlayed(team) {
    if ([ 'truce', 'draw', team.id ].includes(this.winnerId))
      return true;

    const initialTurnId = this.getTeamInitialTurnId(team);
    if (this.currentTurnId < initialTurnId)
      return false;

    /*
     * If the game ended on the turn after this team's first turn, then it
     * is possible that this team surrendered.  If so, turn not played.
     */
    const actions = this.turns[initialTurnId].actions;
    const playedAction = actions.find(a => a.type !== 'surrender' && !a.forced);
    if (!playedAction)
      return false;

    return true;
  }

  /*
   * Has any other team checked in since the given date?
   */
  seen(team, date) {
    return this.teams.findIndex(t => t.id !== team.id && t.seen(date)) > -1;
  }

  /*
   * Return a pointer to the next turnId and actionId to which the provided
   * team may undo without approval.
   *
   * May return null if undo is impossible or not allowed
   * May return false if the player may not undo without approval.
   */
  getUndoPointer(team = this.currentTeam, useEarliest = false) {
    if (!team || !this.startedAt)
      return null;

    // Practice games can always undo if there is something to undo.
    if (this.isPracticeGame) {
      const initialTurnId = this.initialTurnId;
      if (this.currentTurnId === initialTurnId && this.currentTurn.isEmpty)
        return null;
      if (useEarliest)
        return { turnId:initialTurnId, actionId:0 };
      if (this.currentTurn.isEmpty || this.currentTurn.isAutoSkipped)
        return { turnId:this.getPreviousPlayableTurnId(), actionId:0 };
      return { turnId:this.currentTurnId, actionId:0 };
    }

    const numTeams = this.teams.length;
    const teamInitialTurnId = this.getTeamInitialTurnId(team);
    const teamContextTurnId = this.currentTurnId - ((numTeams + this.currentTeamId - team.id) % numTeams);
    const teamPreviousTurnId = teamContextTurnId - numTeams;
    const lockedTurnId = this.lockedTurnId;
    const rated = this.rated;
    const strictUndo = this.strictUndo;
    const turns = this.turns;
    let pointer = false;

    if (this.endedAt)
      return rated ? null : false;

    /*
     * Walk backward through turns and actions until we reach the undo limit.
     */
    for (let turnId = this.currentTurnId; turnId > -1; turnId--) {
      const turn = turns[turnId];

      if (turn.isCurrent) {
        if (turn.team === team) {
          // Can't undo when previous turn is locked (and there are no actions to undo).
          if (teamPreviousTurnId < lockedTurnId && turn.isEmpty)
            return null;

          // Can't undo if this is the team's first turn (and there are no actions to undo).
          if (teamInitialTurnId === turn.id && turn.isEmpty)
            return null;

          // Can't undo when less than 10 seconds remain in the current turn.
          // This protects against auto or forced surrender.
          if (this.getTurnTimeRemaining(turnId) < 10000)
            return null;

          // Pass control to the next team 5 seconds after the current turn ends in rated games.
          if (rated && turn.isEnded && this.seen(team, turn.endedAt.getTime() + 5000) && Date.now() - turn.endedAt >= 5000)
            return pointer;
        } else {
          // Can't undo when team's last turn is locked.
          if (teamContextTurnId < lockedTurnId)
            return null;

          // Can't undo if the team hasn't had a turn yet.
          if (teamInitialTurnId > turn.id)
            return null;

          // Opponents may not undo current turn without permission.
          // ... except the previous team can undo an empty turn in:
          //   1) unrated games, or
          //   2) rated games where nobody has seen them move yet.
          if (rated && this.seen(team, turn.startedAt) || team !== this.previousTeam || !turn.isEmpty)
            return pointer;
        }
      } else {
        // May not undo previous turns in strict undo without permission.
        if (strictUndo)
          return pointer;

        // May undo forcibly skipped turns if something can be undone earlier.
        if (turn.isAutoSkipped)
          continue;

        // May not undo opponent turns without permission.
        if (turn.team !== team)
          return pointer;

        // May not undo when less than 10 seconds remain in the previous turn without permission.
        if (this.getTurnTimeRemaining(turnId) < 10000)
          return pointer;
      }

      for (let actionId = turn.lastActionId; actionId > -1; actionId--) {
        const action = turn.actions[actionId];

        if (strictUndo) {
          // May not undo more than the last action in strict mode without permission.
          if (actionId < turn.lastActionId)
            return pointer;

          // May not undo unit selection in strict mode without permission.
          if (action.type === 'select')
            return pointer;

          // May not undo an action after 5 seconds without permission.
          if (Date.now() - action.createdAt >= 5000)
            return pointer;
        }

        // May not undo luck-involved attacks without permission.
        if (action.results && action.results.findIndex(r => 'luck' in r) > -1)
          return pointer;

        // May not undo counter-attacks without permission.
        if (action.unit !== undefined && action.unit !== turn.unit)
          return pointer;

        // May undo forced end turns if something can be undone earlier.
        if (action.type === 'endTurn' && action.forced)
          continue;

        // Now we know something can be undone
        pointer = { turnId, actionId };
      }

      // Can't undo locked turns.
      if (turn.id === lockedTurnId)
        return pointer;

      // Stop at the next turn id we can undo before the current one.
      if (pointer && !useEarliest)
        return pointer;
    }

    return pointer;
  }
  /*
   * Determine if provided team may request an undo.
   * Also indicate if approval should be required of opponents.
   */
  canUndo(team = this.currentTeam) {
    const pointer = this.getUndoPointer(team);

    // If undo is impossible or not allowed, return false
    if (pointer === null)
      return false;

    // If undo cannot be done without approval, return 'approve'
    // Bots will never approve anything that requires approval.
    // Approval is also disabled for blitz games with auto surrender.
    if (pointer === false) {
      const hasBot = this.teams.findIndex(t => !!t.bot) > -1;
      const approve = hasBot || this.timeLimit.base === 30 && this.autoSurrender ? false : 'approve';

      return approve;
    }

    return true;
  }

  /*
   * Initiate an undo action by provided team (defaults to current turn's team)
   */
  undo(team = this.currentTeam, approved = false) {
    const pointer = this.getUndoPointer(team);
    if (pointer === null)
      return false;
    if (pointer === false && !approved)
      return false;

    if (pointer)
      this.revert(pointer.turnId, pointer.actionId, true, approved);
    // The current turn is not playable when the game ended in a draw.
    else if (team === this.currentTeam && this.currentTurn.isPlayable && this.currentTurn.nextActionId)
      this.revert(this.currentTurnId, 0, true, approved);
    else {
      const turnId = this.getTeamPreviousPlayableTurnId(team);
      this.revert(turnId, 0, true, approved);
    }

    return true;
  }
  startTurn() {
    if (this.currentTurn.isEnded)
      this._pushHistory();

    this._emit({
      type: 'startTurn',
      data: {
        teamId: this.currentTeamId,
        startedAt: this.startedAt,
        timeLimit: this.turnTimeLimit,
      },
    });

    this.sync('startTurn');
  }
  end(winnerId) {
    this._pushAction({
      type: 'endGame',
      winnerId,
      forced: true,
    });

    this._emit({
      type: 'action',
      data: this._board.encodeAction(this._newActions),
    });
    this._newActions.length = 0;

    this._emit({
      type: 'endGame',
      data: this.currentTurn.actions.last,
    });

    this.sync('endGame');
  }
  sync(reason = 'sync') {
    // If the game ended since we scheduled a sync, ignore
    if (reason === 'willSync' && this.endedAt)
      return;

    if (this.currentTurn.isEnded && (
      // Opponent can see a turn end immediately in unrated games.
      !this.rated ||
      // Opponent can see a turn end 5 seconds after it ended.
      Date.now() - this.currentTurn.endedAt >= 5000 ||
      // Opponent can see a turn end within 10 seconds of time limit expiration
      this.getTurnTimeRemaining() <= 10000
    )) return this.startTurn();

    this._emit({ type:'sync' });

    // Only active rated games require scheduling a sync after a timeout.
    if (!this.endedAt && this.rated)
      this.willSync();
  }
  /*
   * Some things in active rated games are deferred for a period of time.
   * This lets the current team freely undo without making the opponent watch.
   * But this privilege has a time limit.
   *
   * Start the next turn 5 seconds after the current one ends.
   * The current team may freely undo within 5 seconds after ending their turn.
   * The opponent is synced with the latest activity after 5 seconds.
   *
   * Strict undo games apply this 5 second grace period after every action.
   *
   * Undo is disabled 10 seconds before turn time limit is reached.
   * At this point the opponent can see everything.
   */
  willSync() {
    const currentTurn = this.currentTurn;
    const pointer = this.getUndoPointer(this.currentTeam, true) ?? { turnId:currentTurn.id };

    // Nothing to sync if the turn is empty and opponent has seen previous turn.
    if (currentTurn.isEmpty && pointer.turnId === currentTurn.id)
      return;

    const targetTurnTimeout = Math.max(0, this.getTurnTimeRemaining(pointer.turnId) - 10000);
    const currentTurnTimeout = Math.max(0, this.getTurnTimeRemaining() - 10000);
    const turnEndTimeout = Math.min(targetTurnTimeout, currentTurnTimeout);
    const actionTimeout = Math.max(0, 5000 - (Date.now() - currentTurn.updatedAt));
    const timeout = currentTurn.isEnded || this.strictUndo ? Math.min(turnEndTimeout, actionTimeout) : turnEndTimeout;

    if (timeout)
      this._emit({ type:'willSync', data:timeout });
  }
  revert(turnId, nextActionId = 0, isUndo = false, resetStartDate) {
    const board = this._board;

    if (turnId < this.currentTurnId)
      this._popHistory(turnId, resetStartDate);
    if (nextActionId < this.currentTurn.actions.length)
      this.currentTurn.nextActionId = nextActionId;

    this._newActions.length = 0;
    this._actions.length = 0;
    board.setState(this.units, this.teams);
    board.decodeAction(this.actions).forEach(a => this._applyAction(a));

    if (isUndo !== true) return;

    this._emit({
      type: 'revert',
      data: this.currentTurn.getData(),
    });

    this.sync('revert');
  }

  /*
   * Intended for serializing game data for persistent storage.
   */
  toJSON() {
    return {
      type: this.type,
      randomFirstTurn: this.randomFirstTurn,
      randomHitChance: this.randomHitChance,
      strictUndo: this.strictUndo,
      strictFork: this.strictFork,
      autoSurrender: this.autoSurrender,
      rated: this.rated,
      timeLimit: this.timeLimit,

      teams: this.teams,
      turns: this.turns.map(t => t.toJSON()),
    };
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  /*
   * In rated games, every team may undo at most their previous playable turn.
   */
  _getLockedTurnId() {
    const turnIds = this.teams.map(t => this.getTeamPreviousPlayableTurnId(t)).filter(tId => tId !== null);

    return turnIds.length ? Math.min(...turnIds) : this.initialTurnId;
  }
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
        const result = { unit, changes:{} };

        // Adjust recovery for the outgoing team.
        if (team === currentTeam) {
          let mRecovery;
          if (unit === selected) {
            // Allow a unit (such as Furgon) to provide custom recovery.
            if (selected.mRecovery === 0) {
              const recovery = selected.recovery;

              if ((moved || !selected.mType) && attacked)
                mRecovery = recovery;
              else if (moved)
                mRecovery = Math.floor(recovery / 2);
              else if (attacked)
                mRecovery = Math.ceil(recovery / 2);

              if (mRecovery === 0)
                mRecovery = undefined;
            }
          } else {
            // Check recovery at the start of the turn, not the current recovery.
            // This handles the case of a berserker attacking a friendly unit.
            // Note: this also needs an undefined check since the furgon's shrubs do not exist at turn start
            //       and will be undefined
            const unitAtTurnStart = this.units[team.id].find(u => u.id === unit.id);
            if (!!unitAtTurnStart && unitAtTurnStart.mRecovery)
              mRecovery = unit.mRecovery - 1;
          }

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
      if (action.declaredBy !== 'system')
        action.teamId = this.getTeamForPlayer(action.declaredBy).id;
      else
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
      if (this.timeLimit && this.getTurnTimeRemaining() > 0)
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

  _pushHistory(nextTurnStartsAt = new Date()) {
    this.turns.push(Turn.create({
      id: this.turns.length,
      team: this.teams[this.turns.length % this.teams.length],
      data: {
        startedAt: nextTurnStartsAt,
        units: this._board.getState(),
      },
    }));

    this.previousTurn.isCurrent = false;

    if (this.rated) {
      const oldLockedTurnId = this.lockedTurnId;
      const newLockedTurnId = this._getLockedTurnId();
      if (newLockedTurnId > oldLockedTurnId) {
        this.turns[oldLockedTurnId].isLocked = false;
        this.turns[newLockedTurnId].isLocked = true;
      }
    }

    if (this.timeLimit)
      applyTurnTimeLimit[this.timeLimit.type].call(this, 'pushed');

    this._newActions.length = 0;
    this._actions.length = 0;

    return this;
  }
  /*
   * 'turnId' can be used to revert to any previous turn by ID.
   */
  _popHistory(turnId = this.previousTurnId, resetStartDate = false) {
    const turn = this.turns[turnId];
    if (!turn)
      throw new Error(`Attempt to pop a turn that does not exist: ${turnId}`);

    // Truncate the turn history.
    this.turns.length = turnId + 1;

    if (resetStartDate)
      turn.startedAt = new Date();

    turn.isCurrent = true;

    // Even if the previous turn time limit isn't null, reset it just in case it was extended.
    if (this.timeLimit)
      applyTurnTimeLimit[this.timeLimit.type].call(this, 'popped');

    return turn;
  }
}

emitter(GameState);

serializer.addType({
  name: 'GameState',
  constructor: GameState,
  schema: {
    type: 'object',
    required: [
      'type', 'teams', 'turns',
    ],
    properties: {
      type: { type:'string' },
      randomFirstTurn: { type:'boolean' },
      randomHitChance: { type:'boolean' },
      strictUndo: { type:'boolean' },
      strictFork: { type:'boolean' },
      autoSurrender: { type:'boolean' },
      rated: { type:'boolean' },
      timeLimit: {
        type: 'object',
        required: [ 'type' ],
        properties: {
          type: { type:'string' },
        },
        // For example: buffered time limits have 'initial', 'base', and 'maxBuffer' properties.
        additionalProperties: true,
      },
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
            isLocked: { type:'boolean', const:true },
          },
          // For example: buffered time limits add a timeBuffer property.
          additionalProperties: true,
        },
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
          winnerId: {
            type: 'string',
            oneOf: [
              { format:'uuid' },
              { enum:[ 'draw', 'truce' ] },
            ],
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
