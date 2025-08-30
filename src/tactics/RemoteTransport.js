import clientFactory from 'client/clientFactory.js';
import popup from 'components/popup.js';
import ServerError from 'server/Error.js';
import Transport from 'tactics/Transport.js';

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
      .on('leave', event => {
        if (event.body.reason === 'request')
          return;

        const messageByReason = new Map([
          [ 'expire', 'Oops!  The game expired due to inactivity.' ],
          [ 'cancel', 'Oops!  You cancelled the game in another tab.' ],
          [ 'decline', 'Oops!  The challenged player declined the game.' ],
        ]);

        popup({
          message: messageByReason.get(event.body.reason) ?? 'Oops!  The game disappeared mysteriously.',
          buttons: [
            { label:'Back to Game List', closeOnClick:false, onClick:() => location.href = 'online.html' },
          ],
          maxWidth: '250px',
          closeOnCancel: false,
        });
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
    if (gameData && gameData.state.recentTurns?.last.actions.last?.type === 'endGame' && !authClient.token) {
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
  async getTurnData(turnId) {
    const turn = this.getRecentTurn(turnId);
    if (turn)
      return turn.getData();

    return gameClient.getTurnData(this._data.id, turnId);
  }
  async getTurnActions(turnId) {
    const turn = this.getRecentTurn(turnId);
    if (turn)
      return turn.actions;

    return gameClient.getTurnActions(this._data.id, turnId);
  }
  async cancel() {
    // Shouldn't happen
    if (!this._data) return;

    const gameId = this._data.id;

    await gameClient.closeGame(gameId);
    await gameClient.cancelGame(gameId);

    location.href = '/online.html';
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
    gameClient.watchGame(gameId).then(({ playerStatus, sync }) => {
      this._makeReady(sync);

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
    const reference = this._data.reference;

    // Instead of watching the game from its current point, resume watching
    // the game from the point we lost connection.
    gameClient.watchGame(gameId, reference).then(({ playerStatus, sync }) => {
      this._emit({ type:'playerStatus', data:playerStatus });

      /*
       * Sync Player Status
       */
      const oldRequest = this._data.playerRequest;
      const newRequest = sync.playerRequest;
      if (newRequest)
        // Inform the game of a change in player request status, if any.
        this._emit({ type:`playerRequest`, data:newRequest });
      else if (oldRequest && oldRequest.status === 'pending')
        // Not sure if the request was rejected or accepted.
        // But 'complete' will result in hiding the dialog, if any.
        this._emit({ type:`playerRequest:complete` });

      delete sync.playerRequest;

      if (sync.reference)
        this._emit({ type:'sync', data:sync });

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
      if (error instanceof ServerError)
        if (error.code === 404)
          return popup({
            message: 'Oops!  The game expired or was cancelled or declined.',
            buttons: [
              { label:'Back to Game List', closeOnClick:false, onClick:() => location.href = 'online.html' },
            ],
            maxWidth: '250px',
            closeOnCancel: false,
          });
      throw error;
    });
  }

  _onStartTurn(event) {
    // Clear a player's rejected requests when their turn starts.
    if (this._data.playerRequest) {
      const currentTeamId = (this._data.state.currentTurnId + 1) % this.teams.length;
      const playerId = this.teams[currentTeamId].playerId;
      const oldRejected = this._data.playerRequest.rejected;
      const newRejected = [ ...oldRejected ].filter(([k,v]) => !k.startsWith(`${playerId}:`))

      if (newRejected.length !== oldRejected.size) {
        if (newRejected.length)
          this._data.playerRequest.rejected = new Map(newRejected);
        else
          this._data.playerRequest = null;
      }
    }

    return super._onStartTurn(event);
  }
  /*
   * We only need enough history to determine undo availability.
   */
  _pruneRecentTurns() {
    const state = this._data.state;
    const recentTurns = state.recentTurns;
    const team = this.getTeamForPlayer(authClient.playerId);
    // Use a minimum of the previous turn id to allow for efficient turn progression.
    const pointer = this.getUndoPointer(team) || { turnId:state.previousTurnId };
    while (recentTurns[0].id < pointer.turnId)
      recentTurns.shift();
  }
  _watchForDataChanges(gameData) {
    this
      .on('playerStatus', ({ data }) => {
        if (!Array.isArray(data))
          data = [ data ];

        const teams = this._data?.state.teams ?? [];

        for (const ps of data) {
          this.playerStatus.set(ps.playerId, ps);

          for (const team of teams)
            if (team?.playerId === ps.playerId)
              if (ps.isOpen && (team.checkinAt === null || team.checkoutAt > team.checkinAt))
                team.checkinAt = new Date();
              else if (!ps.isOpen && team.checkinAt > team.checkoutAt)
                team.checkoutAt = new Date();
        }
      })
      .on('playerRequest', ({ data:request }) => {
        this._data.playerRequest = request;
        this._data.playerRequest.turnId = this.currentTurnId;
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
