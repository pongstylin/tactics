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
    this._server.requestAuthorized(this.name, 'createGame', [stateData])
  }

  joinGame(gameId, options) {
    let args = [gameId];
    if (options) args.push(options);

    this._server.requestAuthorized(this.name, 'joinGame', args)
  }

  getGameData(gameId) {
    // Authorization not required
    return this._server.request(this.name, 'getGame', [gameId]);
  }
  getPlayerStatus(gameId) {
    return this._server.requestAuthorized(this.name, 'getPlayerStatus', [gameId])
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

  _onOpen({data}) {
    let authClient = this._authClient;

    // When the auth and game services share a server/connection, there is no
    // need to get authorization from the auth client here.  This is because the
    // auth client refreshes a token every time a connection is opened and emits
    // the new token.  So, authorization will be sent upon token emit.
    if (this._server === authClient._server)
      return;

    authClient.whenAuthorized.then(() => {
      this._authorize(authClient.token);
    });
  }
}
