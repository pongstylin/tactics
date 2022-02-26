import Transport from 'tactics/Transport.js';
import clientFactory from 'client/clientFactory.js';

const authClient = clientFactory('auth');
const gameClient = clientFactory('game');

export default class RemoteTransport extends Transport {
  constructor(gameId, gameData) {
    super({
      playerStatus: new Map(),
      _localize: false,
      _protoTimeout: null,
      _protoActions: [],
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
      this._makeReady(gameData);

      const playerIds = new Set(gameData.state.teams.map(t => t.playerId));
      const playerStatus = [ ...playerIds ].map(playerId => ({ playerId, status:'offline' }));
      this._emit({ type:'playerStatus', data:playerStatus });
    } else
      this._init(gameId);
  }

  /*
   * Public Properties
   */
  get now() {
    return gameClient.serverNow;
  }
  get localize() {
    return this._localize;
  }
  set localize(localize) {
    if (this._localize === localize)
      return;

    this._localize = localize;
    this._flushLocalActions();
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
  submitAction(protoAction) {
    // Submit actions remotely if unable to submit locally.
    if (this._submitLocalActions(protoAction)) {
      if (!this._protoTimeout) {
        this._protoTimeout = setTimeout(
          () => this._flushLocalActions(),
          this.getTurnTimeRemaining() - 15000,
        );
      }
      return Promise.resolve();
    }

    return this._flushLocalActions();
  }
  undo() {
    if (this._protoActions.length) {
      this._resetLocalActions();
      return Promise.resolve();
    }

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
   * Other Private Methods
   */
  _init(gameId) {
    gameClient.watchGame(gameId).then(({ playerStatus, gameData, recentTurns }) => {
      this._makeReady(Object.assign(gameData, { recentTurns }));

      // Event emitted internally to set this.playerStatus.
      this._emit({ type:'playerStatus', data:playerStatus });
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
    const board = this.board;
    const state = this._data.state;
    const actions = state.actions.filter(a => !a.isLocal);
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

      if (gameData.state?.actions || newActions)
        this._resetLocalActions(true);

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
        if (newActions) {
          this._data.state.actions.push(...newActions);
          board.decodeAction(newActions).forEach(a => board.applyAction(a));
        } else if (gameData.state.units || gameData.state.actions)
          this._applyState();

        if (!oldStarted && this._data.state.startedAt)
          this.whenStarted.resolve();
        if (!oldTurnStarted && this._data.state.turnStartedAt)
          this.whenTurnStarted.resolve();

        this._emit({ type:'change' });
      } else if (newActions) {
        this._data.state.actions.push(...newActions);
        board.decodeAction(newActions).forEach(a => board.applyAction(a));
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

  /*
   * Borrows from GameState->submitActions()
   *
   * Push actions onto the state actions array based on the proto actions.
   * Return false if an action cannot be submitted locally.
   *
   * Actions that require RNG or ending the turn must be pushed to the server.
   */
  _submitLocalActions(protoActions) {
    // Actions may only be submitted between game start and end.
    if (!this.startedAt || this.endedAt)
      return false;

    if (!Array.isArray(protoActions))
      protoActions = [ protoActions ];

    /*
     * Tip: An action may be passed to this function.  The action may be a
     * counter-attack, in which case the action itself may have RNG as opposed
     * to one of the results of the counter-attack.
     */
    const board = this.board;
    const hasRNG = result => {
      if ('luck' in result)
        return true;
      else if (result.results)
        return result.results.findIndex(r => hasRNG(r)) > -1;

      return false;
    };
    const pushAction = action => {
      action.createdAt = new Date();
      action.teamId = action.teamId ?? this.currentTeamId;

      if (action.forced === false)
        delete action.forced;

      action.isLocal = true;

      this._data.state.actions.push(board.encodeAction(action));
      board.applyAction(action);
    };

    const turnTimeRemaining = this.getTurnTimeRemaining();

    /*
     * Find a proto action that must be submitted to the server.
     * If none, return true since local submission was successful.
     */
    const remote = protoActions.findIndex(pAction => {
      this._protoActions.push(pAction);

      // Submit all actions to the server if localization isn't enabled.
      if (this._localize !== true)
        return true;

      // Immediately submit actions to server in blitz games.
      // Immediately submit actions when less than 15 seconds remain.
      if (turnTimeRemaining < 15000 || this._data.state.turnTimeLimit === 30)
        return true;

      if (pAction.type === 'turn' || pAction.type === 'endTurn' || pAction.type === 'surrender')
        return true;

      /*
       * Validate and populate the action
       */
      let action = board.decodeAction(pAction);
      const unit = action.unit;

      if (this.actions.length === 0)
        pushAction({ type:'select', unit });

      // Taking an action may break certain status effects.
      const breakAction = unit.getBreakAction(action);
      if (breakAction)
        pushAction(breakAction);

      // Determine results.
      action = unit.validateAction(action);

      if (hasRNG(action))
        return true;

      pushAction(action);

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
          return true;

        // Can any victims counter-attack?
        return action.results.findIndex(result => {
          const unit = result.unit;
          if (!unit.canCounter()) return;

          const counterAction = unit.getCounterAction(action.unit, result);
          if (!counterAction) return;

          if (hasRNG(counterAction))
            return true;

          pushAction(counterAction);

          if (forceEndTurn())
            return true;
        }) > -1;
      }
    }) > -1;

    if (remote)
      return false;

    setTimeout(() => {
      // Notify the GameStateCursor that a change has occurred.
      this._emit({ type:'change' });
    });

    return true;
  }
  _flushLocalActions() {
    if (this._protoActions.length === 0)
      return Promise.resolve();

    if (this._protoTimeout) {
      clearTimeout(this._protoTimeout);
      this._protoTimeout = null;
    }

    return gameClient.submitAction(this._data.id, this._protoActions);
  }
  _resetLocalActions(silent = false) {
    if (this._protoActions.length === 0)
      return;

    clearTimeout(this._protoTimeout);
    this._protoTimeout = null;
    this._protoActions.length = 0;

    const actions = this._data.state.actions;
    const actionId = actions.findIndex(a => a.isLocal);
    if (actionId > -1) {
      actions.splice(actionId);
      this._applyState();

      if (!silent) {
        setTimeout(() => {
          // Notify the GameStateCursor that a change has occurred.
          this._emit({ type:'change' });
        });
      }
    }
  }

  _onStartTurn(event) {
    // Clear a player's rejected requests when their turn starts.
    if (this._data.playerRequest) {
      const playerId = this._data.state.teams[event.data.teamId].playerId;
      const oldRejected = this._data.playerRequest.rejected;
      const newRejected = [ ...oldRejected ].filter(([k,v]) => !k.startsWith(`${playerId}:`))

      if (newRejected.length !== oldRejected.size) {
        if (newRejected.length)
          this._data.playerRequest.rejected = new Map(newRejected);
        else
          this._data.playerRequest = null;
      }
    }

    const state = this._data.state;
    if (state.turnTimeBuffer) {
      const team = state.teams[event.data.teamId];
      team.turnTimeBuffer = event.data.timeBuffer;
    }

    return super._onStartTurn(event);
  }
  _onAction(event) {
    this._resetLocalActions(true);

    return super._onAction(event);
  }
  _onRevert(event) {
    this._resetLocalActions(true);

    return super._onRevert(event);
  }
  _onEndGame(event) {
    this._data.playerRequest = null;

    return super._onEndGame(event);
  }
  _watchForDataChanges(gameData) {
    this
      .on('playerStatus', ({ data }) => {
        if (!Array.isArray(data))
          data = [ data ];

        data.forEach(ps => this.playerStatus.set(ps.playerId, ps));
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
}
