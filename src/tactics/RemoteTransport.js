import clientFactory from 'client/clientFactory.js';
import unitDataMap from 'tactics/unitData.js';
import emitter from 'utils/emitter.js';

const authClient = clientFactory('auth');
const gameClient = clientFactory('game');

export default class RemoteTransport {
  /*
   * The default constructor is not intended for public use.
   */
  constructor(gameId, gameData) {
    Object.assign(this, {
      playerStatus: new Map(),

      // Ready means the object is hydrated with game data.
      whenReady: new Promise(),

      // Started means the game has started (and possibly ended)
      whenStarted: new Promise(),
      whenTurnStarted: new Promise(),

      _data: null,
    });

    gameClient
      .on('event', ({ body }) => {
        if (body.group !== `/games/${gameId}`) return;

        this._emit(body);
      })
      .on('open', ({ data }) => {
        // Connection may be lost after listening to events, but before joining
        // the game and getting the data.  In that case, resume is a no-op and
        // the attempt to join will be retried.
        if (!this._data) return;

        if (data.reason === 'resume')
          this._resume();
        else
          this._reset(data.outbox);
      })
      .on('close', () => {
        const myPlayerId = authClient.playerId;
        const playerStatus = [...this.playerStatus].map(([playerId]) => {
          if (playerId === myPlayerId)
            return { playerId, status:'offline' };
          else
            return { playerId, status:'unavailable' };
        });

        this._emit({ type:'playerStatus', data:playerStatus });
      });

    this._watchForDataChanges();

    // For now, joining ended games is ok... unless not authorized.
    if (gameData && gameData.state.endedAt && !authClient.token) {
      this._data = gameData;
      Object.assign(this._data.state, {
        startedAt: gameData.state.startedAt,
        turnStartedAt: gameData.state.turnStartedAt,
        endedAt: gameData.state.endedAt,
      });

      const playerIds = new Set(gameData.state.teams.map(t => t.playerId));
      const playerStatus = [ ...playerIds ].map(playerId => ({ playerId, status:'offline' }));
      this._emit({ type:'playerStatus', data:playerStatus });
      this.whenReady.resolve();
      this.whenStarted.resolve();
      this.whenTurnStarted.resolve();
    }
    else
      this._init(gameId);
  }

  /*
   * Public Properties
   */
  get now() {
    return gameClient.serverNow;
  }

  /*
   * Game Data Properties
   * These are cached and kept in sync for arbitrary access.
   */
  get type() {
    return this._getStateData('type');
  }
  get forkOf() {
    return this._getData('forkOf');
  }
  get teams() {
    return this._getStateData('teams');
  }
  get randomHitChance() {
    return this._getStateData('randomHitChance');
  }
  get strictUndo() {
    return this._getStateData('strictUndo');
  }
  get autoSurrender() {
    return this._getStateData('autoSurrender');
  }
  get turnTimeLimit() {
    return this._getStateData('turnTimeLimit');
  }
  get turnTimeBuffer() {
    return this._getStateData('turnTimeBuffer');
  }
  get createdAt() {
    return this._getData('createdAt');
  }
  get createdBy() {
    return this._getData('createdBy');
  }
  get startedAt() {
    return this._getStateData('startedAt');
  }

  get cursor() {
    if (!this._data)
      throw new Error('Not ready');

    const state = this._data.state;

    return Object.clone({
      turnId: state.currentTurnId,
      teamId: state.currentTeamId,
      startedAt: state.turnStartedAt,
      units: state.units,
      actions: state.actions,
      nextActionId: state.actions.length,
      atEnd: !!state.endedAt,
    });
  }
  get currentTurnData() {
    if (!this._data)
      throw new Error('Not ready');

    const state = this._data.state;

    return Object.clone({
      id: state.currentTurnId,
      teamId: state.currentTeamId,
      startedAt: state.turnStartedAt,
      units: state.units,
      actions: state.actions,
    });
  }
  get currentTurnId() {
    return this._getStateData('currentTurnId');
  }
  get currentTeamId() {
    return this._getStateData('currentTeamId');
  }
  get currentTeam() {
    return this.teams[this.currentTeamId];
  }
  get turnStartedAt() {
    return this._getStateData('turnStartedAt');
  }
  get units() {
    return this._getStateData('units');
  }
  get actions() {
    return this._getStateData('actions');
  }

  get winnerId() {
    return this._getStateData('winnerId');
  }
  get endedAt() {
    return this._getStateData('endedAt');
  }

  get playerRequest() {
    return this._getData('playerRequest');
  }
  get chatDisabled() {
    return this._getData('chatDisabled');
  }

  /*
   * Proxy these methods to the game client.
   * Returns a promise that resolves to the method result, if any.
   */
  getTurnData() {
    return gameClient.getTurnData(this._data.id, ...arguments);
  }
  getTurnActions() {
    return gameClient.getTurnActions(this._data.id, ...arguments);
  }
  submitAction(action) {
    return gameClient.submitAction(this._data.id, action);
  }
  undo() {
    return gameClient.undo(this._data.id);
  }
  truce() {
    return gameClient.truce(this._data.id);
  }
  acceptPlayerRequest() {
    gameClient.acceptPlayerRequest(this._data.id, this.playerRequest.createdAt);
  }
  rejectPlayerRequest() {
    gameClient.rejectPlayerRequest(this._data.id, this.playerRequest.createdAt);
  }
  cancelPlayerRequest() {
    gameClient.cancelPlayerRequest(this._data.id, this.playerRequest.createdAt);
  }

  /*
   * Other public methods that imitate GameState.
   */
  canUndo(team = this.currentTeam) {
    const teams = this.teams;
    const currentTurnId = this.currentTurnId;
    let actions = this._data.state.actions;

    // Practice games don't impose restrictions.
    const bot = teams.find(t => !!t.bot);
    const opponent = teams.find(t => t.playerId !== team.playerId);
    if (!bot && !opponent)
      return !!(currentTurnId > 1 || actions.length > 0);

    if (this.endedAt && (!this.forkOf || bot))
      return false;

    const firstTurnId = this.getTeamFirstTurnId(team);

    // Can't undo if we haven't had a turn yet.
    if (firstTurnId > currentTurnId)
      return false;

    // Can't undo if we haven't made an action yet.
    if (firstTurnId === currentTurnId && actions.length === 0)
      return false;

    // Bots will never approve anything that requires approval.
    // Strict undo also doesn't allow approval for undos.
    // Once undo was rejected, approval cannot be requested.
    const approve = (
      bot ||
      this.strictUndo ||
      this.playerRequest?.rejected.has(`${team.playerId}:undo`)
    ) ? false : 'approve';
    let turnId;

    if (this.endedAt)
      return approve;

    // Determine the turn being undone in whole or in part
    for (turnId = currentTurnId; turnId > -1; turnId--) {
      // Bots do not allow undo after the turn has ended.  This is a technical
      // limitation since bots start executing their move immediately when their
      // turn starts.  It would be better if they started planning the move
      // immediately, but waited to execute until undo limit has passed.
      if (bot && turnId < currentTurnId)
        return false;

      const turnData = this.getRecentTurnData(turnId);
      // Stop if not a recent turn
      if (turnData === false)
        break;
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
      if (turnData.teamId !== team.id)
        return approve;

      // Require approval if the turn time limit was reached.
      if (this.getTurnTimeRemaining(turnId, 5000, this.now) === 0)
        return approve;

      const preservedActionId = this.getPreservedActionId(actions);
      if (preservedActionId === actions.length)
        return approve;

      if (this.strictUndo)
        return +actions.last.createdAt + 5000 - this.now;

      break;
    }

    return true;
  }
  /*
   * Notice: Recent turn data does not include 'units'.
   */
  getRecentTurnData(turnId) {
    let turnData;

    if (turnId === this.currentTurnId)
      turnData = {
        startedAt: this.turnStartedAt,
        actions: this.actions,
        timeBuffer: this.currentTeam.turnTimeBuffer,
      };
    else if (turnId > this.currentTurnId || turnId < 0)
      return null;
    else {
      const recentTurns = this._data.recentTurns;
      const turnIndex = turnId - this.currentTurnId + recentTurns.length;

      if (recentTurns[turnIndex])
        turnData = recentTurns[turnIndex];
      else
        return false;
    }

    turnData.id = turnId;
    turnData.teamId = turnId % this.teams.length;

    return turnData;
  }
  getPreservedActionId(actions) {
    const selectedUnitId = actions[0].unit;

    return actions.findLastIndex(action => (
      // Preserve unit selection in strict mode
      // Preserve old actions in strict mode
      this.strictUndo && (
        action.type === 'select' ||
        this.now - action.createdAt > 5000
      ) ||
      // Preserve counter-attacks
      action.unit !== undefined && action.unit !== selectedUnitId ||
      // Preserve luck-involved attacks
      !!action.results && !!action.results.find(r => 'luck' in r)
    )) + 1;
  }
  getTeamFirstTurnId(team) {
    const numTeams = this.teams.length;
    const waitTurns = Math.min(...team.set.units.map(u => u.mRecovery ?? 0));
    const skipTurns = numTeams === 2 && team.id === 0 ? 1 : 0;

    return team.id + (numTeams * Math.max(waitTurns, skipTurns));
  }
  /*
   * Like GameState->getTurnTimeLimit() but with limited history support.
   */
  getTurnTimeLimit(turnId = this.currentTurnId) {
    if (!this.startedAt || !this.turnTimeLimit)
      return;

    let turnTimeLimit = this.turnTimeLimit;
    if (this.turnTimeBuffer) {
      const turnData = this.getRecentTurnData(turnId);
      if (turnData === false)
        return this.turnTimeLimit;
      const team = this.teams[turnData.teamId];
      const firstTurnId = this.getTeamFirstTurnId(team);

      if (turnId === firstTurnId)
        turnTimeLimit = this.turnTimeBuffer;
      else
        turnTimeLimit += turnData.timeBuffer;
    }

    return turnTimeLimit;
  }
  /*
   * Like GameState->getTurnTimeRemaining() but with limited history support.
   */
  getTurnTimeRemaining(turnId = this.currentTurnId, actionTimeLimit = 10000) {
    if (!this.startedAt || this.endedAt)
      return false;
    if (!this.turnTimeLimit)
      return Infinity;

    const turnData = this.getRecentTurnData(turnId);
    if (turnData === null)
      return 0;
    const turnTimeLimit = this.getTurnTimeLimit(turnId);

    const now = gameClient.serverNow;
    const lastAction = turnData.actions.filter(a => !a.forced).last;
    const lastActionAt = lastAction ? +lastAction.createdAt : 0;
    const actionTimeout = (lastActionAt + actionTimeLimit) - now;
    const turnTimeout = (+turnData.startedAt + turnTimeLimit*1000) - now;

    return Math.max(0, actionTimeout, turnTimeout);
  }

  /*
   * Other Private Methods
   */
  _init(gameId) {
    gameClient.watchGame(gameId).then(({ playerStatus, gameData, recentTurns }) => {
      // Event emitted internally to set this.playerStatus.
      this._emit({ type:'playerStatus', data:playerStatus });

      this._data = gameData;
      this._data.recentTurns = recentTurns;
      this.whenReady.resolve();

      if (gameData.state.startedAt)
        this.whenStarted.resolve();
      if (gameData.state.turnStartedAt)
        this.whenTurnStarted.resolve();
    }).catch(error => {
      if (error === 'Connection reset')
        return this._init(gameId);

      // The error is assumed to be permanent.
      this.whenReady.reject(error);
    });
  }
  _resume() {
    const gameId = this._data.id;

    gameClient.whenAuthorized.then(() => {
      const myPlayerId = authClient.playerId;

      this._emit({
        type: 'playerStatus',
        data: { playerId:myPlayerId, status:'online' },
      });

      gameClient.getPlayerStatus(gameId).then(playerStatus =>
        this._emit({ type:'playerStatus', data:playerStatus })
      );
    });
  }
  _reset(outbox) {
    const gameId = this._data.id;
    const state = this._data.state;
    const actions = state.actions;
    let resume;

    if (state.endedAt)
      resume = { since:'end' };
    else if (state.startedAt)
      resume = {
        turnId: state.currentTurnId,
        nextActionId: actions.length,
        since: actions.length ? actions.last.createdAt : state.turnStartedAt,
      };
    else
      resume = { since:'start' };

    // Instead of watching the game from its current point, resume watching
    // the game from the point we lost connection.
    gameClient.watchGame(gameId, resume).then(({ playerStatus, gameData, recentTurns, newActions }) => {
      this._emit({ type:'playerStatus', data:playerStatus });

      const oldRequest = this._data.playerRequest;
      const newRequest = gameData.playerRequest;
      if (newRequest)
        // Inform the game of a change in player request status, if any.
        this._emit({ type:`playerRequest`, data:newRequest });
      else if (oldRequest && oldRequest.status === 'pending')
        // Not sure if the request was rejected or accepted.
        // But 'complete' will result in hiding the dialog, if any.
        this._emit({ type:`playerRequest:complete` });

      if (gameData.state) {
        const oldStarted = this._data.state.startedAt;
        const oldTurnStarted = this._data.state.turnStartedAt;

        if (gameData.state.teams) {
          for (let i = 0; i < gameData.state.teams.length; i++)
            this._data.state.teams[i] = Object.merge(
              this._data.state.teams[i],
              gameData.state.teams[i],
            );
          delete gameData.state.teams;
        }
        this._data.state.merge(gameData.state);
        if (newActions)
          this._data.state.actions.push(...newActions);

        if (!oldStarted && this._data.state.startedAt)
          this.whenStarted.resolve();
        if (!oldTurnStarted && this._data.state.turnStartedAt)
          this.whenTurnStarted.resolve();

        this._emit({ type:'change' });
      } else if (newActions) {
        this._data.state.actions.push(...newActions);
        this._emit({ type:'change' });
      }
      if (recentTurns)
        this._data.recentTurns = recentTurns;

      if (!outbox) return;

      // Resend specific lost messages
      outbox.forEach(message => {
        if (message.type !== 'event') return;
        const event = message.body;
        if (event.service !== 'game') return;
        if (event.group !== `/games/${gameId}`) return;

        if (event.type === 'action')
          gameClient.submitAction(gameId, event.data);
      });
    }).catch(error => {
      // Ignore a connection reset since a new connection will trigger a retry.
      if (error === 'Connection reset')
        return;
      throw error;
    });
  }

  _watchForDataChanges(gameData) {
    this
      .on('playerStatus', ({ data }) => {
        if (!Array.isArray(data))
          data = [ data ];

        data.forEach(ps => this.playerStatus.set(ps.playerId, ps));
      })
      .on('startGame', ({ data }) => {
        Object.assign(this._data.state, {
          startedAt: data.startedAt,
          teams: data.teams,
          units: data.units,
        });
        this.whenStarted.resolve();
        this._emit({ type:'change' });
      })
      .on('startTurn', ({ data }) => {
        // Clear a player's rejected requests when their turn starts.
        if (this._data.playerRequest) {
          const playerId = this._data.state.teams[data.teamId].playerId;
          const oldRejected = this._data.playerRequest.rejected;
          const newRejected = [ ...oldRejected ].filter(([k,v]) => !k.startsWith(`${playerId}:`))

          if (newRejected.length !== oldRejected.size) {
            if (newRejected.length)
              this._data.playerRequest.rejected = new Map(newRejected);
            else
              this._data.playerRequest = null;
          }
        }

        this.applyActions();

        const state = this._data.state;
        if (state.turnTimeBuffer) {
          const team = state.teams[data.teamId];
          team.turnTimeBuffer = data.timeBuffer;
        }

        Object.assign(state, {
          turnStartedAt: data.startedAt,
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          actions: [],
        });
        this.whenTurnStarted.resolve();
        this._emit({ type:'change' });
      })
      .on('action', ({ data:actions }) => {
        let state = this._data.state;

        state.actions.push(...actions);

        // Emit a change so that the game state cursor can pick up on the new
        // action before it is potentially cleared in the next step.
        this._emit({ type:'change' });

        /*
         * If the new action is an 'endTurn' action, update the state so that it
         * recognizes the new turn.  This is mostly useful when the game ends
         * and a 'startTurn' event never follows.  We could also just push the
         * new turn during an 'endGame' event, but connection lag can delay it.
         */
        if (actions.last.type === 'endTurn') {
          const recentTurns = this._data.recentTurns;
          recentTurns.push({
            startedAt: this.turnStartedAt,
            actions: this.actions,
            timeBuffer: this.currentTeam.turnTimeBuffer,
          });
          recentTurns.shift();

          this.applyActions();

          Object.assign(state, {
            turnStartedAt: actions.last.createdAt,
            currentTurnId: state.currentTurnId + 1,
            currentTeamId: (state.currentTeamId + 1) % state.teams.length,
            actions: [],
          });

          this._emit({ type:'change' });
        }
      })
      .on('revert', ({ data }) => {
        const state = this._data.state;
        if (state.turnTimeBuffer) {
          const team = state.teams[data.teamId];
          team.turnTimeBuffer = data.timeBuffer;
        }

        Object.assign(state, {
          turnStartedAt: data.startedAt,
          currentTurnId: data.turnId,
          currentTeamId: data.teamId,
          units: data.units,
          actions: data.actions,
          endedAt: null,
          winnerId: null,
        });
        this._emit({ type:'change' });
      })
      .on('endGame', ({ data }) => {
        this._data.playerRequest = null;
        Object.assign(this._data.state, {
          winnerId: data.winnerId,
          endedAt: new Date(),
        });
        this._emit({ type:'change' });
      })
      .on('playerRequest', ({ data:request }) => {
        this._data.playerRequest = request;
      })
      .on('playerRequest:accept', ({ data }) => {
        this._data.playerRequest.accepted.add(data.playerId);
      })
      .on('playerRequest:reject', ({ data }) => {
        const playerRequest = this._data.playerRequest;

        playerRequest.status = 'rejected';
        playerRequest.rejected.set(`${playerRequest.createdBy}:${playerRequest.type}`, data.playerId);
      })
      .on('playerRequest:cancel', () => {
        this._data.playerRequest.status = 'cancelled';
      })
      .on('playerRequest:complete', () => {
        this._data.playerRequest.status = 'completed';
      });
  }

  /*
   * Kinda sucks that this duplicates some board logic.
   * But the board logic is more than we need.
   */
  applyActions(teamsUnits = this._data.state.units, actions = this._data.state.actions) {
    let units = teamsUnits.flat();

    for (let action of actions) {
      if ('unit' in action) {
        let unit = units.find(u => u.id === action.unit);

        if (action.assignment)
          unit.assignment = action.assignment;
        if (action.direction)
          unit.direction = action.direction;
        if ('colorId' in action)
          unit.colorId = action.colorId;
      }

      this._applyActionResults(teamsUnits, action.results);
    }

    // Remove dead units
    for (let teamUnits of teamsUnits) {
      for (let i = teamUnits.length-1; i > -1; i--) {
        let unit = teamUnits[i];
        let unitData = unitDataMap.get(unit.type);
        if (unit.mHealth === -unitData.health)
          teamUnits.splice(i, 1);
      }
    }

    return teamsUnits;
  }
  _applyActionResults(teamsUnits, results) {
    if (!results) return;

    const units = teamsUnits.flat();

    for (const result of results) {
      if (result.type === 'summon') {
        teamsUnits[result.teamId].push(result.unit);
      } else {
        const unit = units.find(u => u.id === result.unit);

        Object.assign(unit, result.changes);
      }

      if (result.results)
        this._applyActionResults(teamsUnits, result.results);
    }
  }

  _getData(name) {
    if (!this._data)
      throw new Error('Not ready');

    return Object.clone(this._data[name]);
  }
  _getStateData(name) {
    if (!this._data)
      throw new Error('Not ready');

    return Object.clone(this._data.state[name]);
  }
}

emitter(RemoteTransport);
