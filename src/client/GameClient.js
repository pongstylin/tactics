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

  createGame(gameTypeId, gameOptions) {
    return this._server.requestAuthorized(this.name, 'createGame', [gameTypeId, gameOptions])
      .catch(error => {
        if (error === 'Connection reset')
          return this.createGame(gameTypeId, gameOptions);
        throw error;
      });
  }

  cancelGame(gameId) {
    return this._server.requestAuthorized(this.name, 'cancelGame', [gameId])
  }

  joinGame(gameId, options) {
    let args = [gameId];
    if (options) args.push(options);

    return this._server.requestAuthorized(this.name, 'joinGame', args)
      .catch(error => {
        if (error === 'Connection reset')
          return this.joinGame(gameId, options);
        throw error;
      });
  }

  getGameType(gameTypeId) {
    // Authorization not required
    return this._server.request(this.name, 'getGameTypeConfig', [gameTypeId])
      .then(gameTypeConfig => GameType.load(gameTypeId, gameTypeConfig))
      .catch(error => {
        if (error === 'Connection reset')
          return this.getGameType(gameTypeId);
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
  getPlayerStatus(gameId) {
    return this._server.requestAuthorized(this.name, 'getPlayerStatus', [gameId])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerStatus(gameId);
        throw error;
      });
  }

  hasCustomPlayerSet(gameTypeId, setName) {
    return this._server.requestAuthorized(this.name, 'hasCustomPlayerSet', [gameTypeId, setName])
      .catch(error => {
        if (error === 'Connection reset')
          return this.hasCustomPlayerSet(gameTypeId, setName);
        throw error;
      });
  }
  getPlayerSet(gameTypeId, setName) {
    return this._server.requestAuthorized(this.name, 'getPlayerSet', [gameTypeId, setName])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerSet(gameTypeId, setName);
        throw error;
      });
  }
  savePlayerSet(gameTypeId, setName, set) {
    return this._server.requestAuthorized(this.name, 'savePlayerSet', [gameTypeId, setName, set])
      .catch(error => {
        if (error === 'Connection reset')
          return this.savePlayerSet(gameTypeId, setName, set);
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
          hit.started = hit.started && new Date(hit.started);
          hit.turnStarted = hit.turnStarted && new Date(hit.turnStarted);
          hit.ended = hit.ended && new Date(hit.ended);
        });

        return result;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchMyGames(query);
        throw error;
      });
  }
  searchOpenGames(query) {
    return this._server.requestAuthorized(this.name, 'searchOpenGames', [query])
      .then(result => {
        result.hits.forEach(hit => {
          hit.created = new Date(hit.created);
          hit.updated = new Date(hit.updated);
          hit.started = hit.started && new Date(hit.started);
          hit.turnStarted = hit.turnStarted && new Date(hit.turnStarted);
          hit.ended = hit.ended && new Date(hit.ended);
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
    return this._server.joinAuthorized(this.name, `/games/${gameId}`, resume)
      .then(data => {
        let gameData = data.gameData;
        let state = gameData.state;
        if (state) {
          if (state.started)
            state.started = new Date(state.started);
          if (state.turnStarted)
            state.turnStarted = new Date(state.turnStarted);
          state.teams.forEach(team => {
            if (!team) return;
            team.createdAt = new Date(team.createdAt);
          });
          if (state.actions)
            state.actions.forEach(action => {
              action.created = new Date(action.created);
            });
        }

        if (data.newActions)
          data.newActions.forEach(action => {
            action.created = new Date(action.created);
          });

        if (gameData.undoRequest)
          Object.assign(gameData.undoRequest, {
            createdAt: new Date(gameData.undoRequest.createdAt),
            accepts: new Set(gameData.undoRequest.accepts),
          });

        return data;
      });
  }
  getTurnData(gameId, turnId) {
    return this._server.requestAuthorized(this.name, 'getTurnData', [ gameId, turnId ])
      .then(turnData => {
        if (turnData) {
          turnData.started = new Date(turnData.started);
          turnData.actions.forEach(action => {
            action.created = new Date(action.created);
          });
        }

        return turnData;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.getTurnData(gameId, turnId);
        throw error;
      });
  }
  getTurnActions(gameId, turnId) {
    return this._server.requestAuthorized(this.name, 'getTurnActions', [ gameId, turnId ])
      .then(actions => {
        if (actions) {
          actions.forEach(action => {
            action.created = new Date(action.created);
          });
        }

        return actions;
      })
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
