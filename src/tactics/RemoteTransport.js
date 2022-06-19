import Transport from 'tactics/Transport.js';
import clientFactory from 'client/clientFactory.js';

const authClient = clientFactory('auth');
const gameClient = clientFactory('game');

export default class RemoteTransport extends Transport {
  constructor(gameId, gameData) {
    super({
      playerStatus: new Map(),
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
    return gameClient.submitAction(this._data.id, protoAction);
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
