import config from 'config/client.js';
import Client from 'client/Client.js';
import GameType from 'tactics/GameType.js';

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

    // If the server connection is already open, fire the open event.
    // The open event is typically used to send authorization.
    if (server.isOpen)
      this._emit({ type:'open', data:{ reason:'new' }});
  }

  createGame(gameOptions) {
    return this._server.requestAuthorized(this.name, 'createGame', [gameOptions])
  }

  joinGame(gameId, options) {
    let args = [gameId];
    if (options) args.push(options);

    return this._server.requestAuthorized(this.name, 'joinGame', args);
  }

  getGameType(gameTypeId) {
    // Authorization not required
    return this._server.request(this.name, 'getGameTypeConfig', [gameTypeId])
      .then(gameTypeConfig => GameType.load(gameTypeId, gameTypeConfig))
      .catch(error => {
        if (error === 'Connection reset')
          return this.getGameTypeConfig(gameTypeId);
        throw error;
      });
  }
  getGameData(gameId) {
    // Authorization not required
    return this._server.request(this.name, 'getGame', [gameId])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getGameData(gameId);
        throw error;
      });
  }
  hasCustomPlayerSet(gameType) {
    return this._server.requestAuthorized(this.name, 'hasCustomPlayerSet', [gameType])
      .catch(error => {
        if (error === 'Connection reset')
          return this.hasCustomPlayerSet(gameType);
        throw error;
      });
  }
  getDefaultPlayerSet(gameType) {
    return this._server.requestAuthorized(this.name, 'getDefaultPlayerSet', [gameType])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getDefaultPlayerSet(gameType);
        throw error;
      });
  }
  getPlayerStatus(gameId) {
    return this._server.requestAuthorized(this.name, 'getPlayerStatus', [gameId])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerStatus(gameId);
        throw error;
      });
  }

  saveDefaultPlayerSet(gameType, set) {
    return this._server.requestAuthorized(this.name, 'saveDefaultPlayerSet', [gameType, set])
      .catch(error => {
        if (error === 'Connection reset')
          return this.saveDefaultPlayerSet(gameType, set);
        throw error;
      });
  }

  searchMyGames(query) {
    let playerId = this._authClient.playerId;

    return this._server.requestAuthorized(this.name, 'searchPlayerGames', [playerId, query])
      .then(result => {
        result.hits.forEach(hit => {
          hit.created = new Date(hit.created);
          hit.updated = new Date(hit.updated);
          if (hit.started)
            hit.started = new Date(hit.started);
          if (hit.ended)
            hit.ended = new Date(hit.ended);
        });

        return result;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchMyGames(query);
        throw error;
      });
  }
  async searchOpenGames(query) {
    return this._server.requestAuthorized(this.name, 'searchOpenGames', [query])
      .then(result => {
        result.hits.forEach(hit => {
          hit.created = new Date(hit.created);
          hit.updated = new Date(hit.updated);
          if (hit.started)
            hit.started = new Date(hit.started);
          if (hit.ended)
            hit.ended = new Date(hit.ended);
        });

        return result;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchOpenGames(query);
        throw error;
      });
  }

  watchGame(gameId, resume) {
    return this._server.joinAuthorized(this.name, `/games/${gameId}`, resume);
  }
  getTurnData(gameId, turnId) {
    return this._server.requestAuthorized(this.name, 'getTurnData', [ gameId, turnId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getTurnData(gameId, turnId);
        throw error;
      });
  }
  getTurnActions(gameId, turnId) {
    return this._server.requestAuthorized(this.name, 'getTurnActions', [ gameId, turnId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getTurnActions(gameId, turnId);
        throw error;
      });
  }
  async submitAction(gameId, action) {
    let server = this._server;
    let beforeUnloadListener = event => {
      event.preventDefault();
      return event.returnValue = 'Your move hasn\'t been saved yet!';
    };

    window.addEventListener('beforeunload', beforeUnloadListener, { capture:true });

    try {
      await server.whenJoined(this.name, `/games/${gameId}`);
      await server.requestAuthorized(this.name, 'action', [ gameId, action ]);
    }
    catch (error) {
      window.removeEventListener('beforeunload', beforeUnloadListener, { capture:true });

      if (error === 'Connection reset')
        return this.submitAction(gameId, action);

      throw error;
    }

    window.removeEventListener('beforeunload', beforeUnloadListener, { capture:true });
  }
  async undo(gameId) {
    let server = this._server;

    try {
      await server.whenJoined(this.name, `/games/${gameId}`);
      return await server.requestAuthorized(this.name, 'undo', [ gameId ]);
    }
    catch (error) {
      if (error === 'Connection reset')
        return this.undo(gameId);

      throw error;
    }
  }
  restart() {
    return this._server.requestAuthorized(this.name, 'restart', [...arguments]);
  }

  acceptUndo(gameId) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'undoAccept');
  }
  rejectUndo(gameId) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'undoReject');
  }
  cancelUndo(gameId) {
    this._server.emitAuthorized(this.name, `/games/${gameId}`, 'undoCancel');
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
