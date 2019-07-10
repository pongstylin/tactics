import config from 'config/client.js';
import Client from 'client/Client.js';

export default class GameClient extends Client {
  constructor(server, authClient) {
    super('game', server);

    Object.assign(this, {
      _authClient: authClient,
    });

    authClient.on('token', ({data:token}) => this._authorize(token));

    let listener = event => {
      if (event.body.service !== this.name) return;

      this._emit(event);
    };

    server
      .on('event', listener)
      .on('join',  listener)
      .on('leave', listener)
      .on('enter', listener)
      .on('exit',  listener);
  }

  createGame(stateData) {
    return this._server.requestAuthorized(this.name, 'createGame', [stateData])
  }

  joinGame(gameId, options) {
    let args = [gameId];
    if (options) args.push(options);

    return this._server.requestAuthorized(this.name, 'joinGame', args);
  }

  getGameData(gameId) {
    // Authorization not required
    return this._server.request(this.name, 'getGame', [gameId]);
  }
  getPlayerStatus(gameId) {
    return this._server.requestAuthorized(this.name, 'getPlayerStatus', [gameId]);
  }

  listMyGames(query) {
    return this._server.requestAuthorized(this.name, 'listMyGames', [query]);
  }

  watchGame(gameId, resume) {
    return this._server.joinAuthorized(this.name, `/games/${gameId}`, resume)
  }
  getTurnData() {
    return this._server.requestAuthorized(this.name, 'getTurnData', [...arguments])
  }
  getTurnActions() {
    return this._server.requestAuthorized(this.name, 'getTurnActions', [...arguments])
  }
  restart() {
    return this._server.requestAuthorized(this.name, 'restart', [...arguments])
  }

  postAction(gameId, action) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'action', action);
  }
  undo(gameId) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'undo')
  }
  acceptUndo(gameId) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'undoAccept')
  }
  rejectUndo(gameId) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'undoReject')
  }
  cancelUndo(gameId) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'undoCancel')
  }

  _onOpen({ data }) {
    // Since a token is refreshed 1 minute before it expires and a connection
    // can only be resumed 30 seconds after disconnect, then authorization
    // should still be valid after resuming a connection.  Even if auth client
    // emits a new token while disconnected, authorization will be queued then
    // sent once the connection resumes without needing to handle it here.
    if (data.reason === 'resume') return;

    let authClient = this._authClient;

    // When the auth and game services share a server/connection, there is no
    // need to get authorization from the auth client here.  This is because the
    // auth client refreshes a token every time a connection is opened and emits
    // the new token.  So, authorization will be sent upon token emit.
    if (this._server === authClient._server)
      return;

    // Only authorize if the auth client is already authorized.  If the auth
    // client is not authorized, then we'll catch the emitted token once it is.
    if (authClient.isAuthorized)
      this._authorize(authClient.token);
  }
}
