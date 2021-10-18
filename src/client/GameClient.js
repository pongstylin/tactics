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

  forkGame(gameId, options) {
    return this._server.requestAuthorized(this.name, 'forkGame', [gameId, options])
      .catch(error => {
        if (error === 'Connection reset')
          return this.forkGame(gameId, options);
        throw error;
      });
  }

  cancelGame(gameId) {
    return this._server.requestAuthorized(this.name, 'cancelGame', [gameId])
      .catch(error => {
        if (error === 'Connection reset')
          return this.cancelGame(gameId);
        throw error;
      });
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

  /*
   * Authorization not required for these read operations
   */
  getGameType(gameTypeId) {
    return this._server.request(this.name, 'getGameTypeConfig', [gameTypeId])
      .then(gameTypeConfig => GameType.load(gameTypeId, gameTypeConfig))
      .catch(error => {
        if (error === 'Connection reset')
          return this.getGameType(gameTypeId);
        throw error;
      });
  }
  getGameData(gameId) {
    return this._server.request(this.name, 'getGame', [gameId])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getGameData(gameId);
        throw error;
      });
  }
  getTurnData(gameId, turnId) {
    return this._server.request(this.name, 'getTurnData', [ gameId, turnId ])
      .then(turnData => {
        if (turnData) {
          turnData.startedAt = new Date(turnData.startedAt);
          turnData.actions.forEach(action => {
            action.createdAt = new Date(action.createdAt);
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
    return this._server.request(this.name, 'getTurnActions', [ gameId, turnId ])
      .then(actions => {
        if (actions) {
          actions.forEach(action => {
            action.createdAt = new Date(action.createdAt);
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

  getPlayerStatus(gameId) {
    return this._server.requestJoined(this.name, `/games/${gameId}`, 'getPlayerStatus')
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerStatus(gameId);
        throw error;
      });
  }
  getPlayerActivity(gameId, playerId) {
    return this._server.requestJoined(this.name, `/games/${gameId}`, 'getPlayerActivity', [ playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerActivity(gameId, playerId);
        throw error;
      });
  }
  getPlayerInfo(gameId, playerId) {
    return this._server.requestJoined(this.name, `/games/${gameId}`, 'getPlayerInfo', [ playerId ])
      .then(data => {
        data.createdAt = new Date(data.createdAt);

        for (const alias of data.stats.aliases) {
          alias.lastSeenAt = new Date(alias.lastSeenAt);
        }
        data.stats.all.startedAt = new Date(data.stats.all.startedAt);
        data.stats.style.startedAt = new Date(data.stats.style.startedAt);

        return data;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerInfo(gameId, playerId);
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

  searchMyActiveGames(query) {
    return this._server.requestAuthorized(this.name, 'searchMyActiveGames', [ query ])
      .then(result => {
        result.hits.forEach(hit => {
          hit.createdAt = new Date(hit.createdAt);
          hit.updatedAt = new Date(hit.updatedAt);
          hit.startedAt = hit.startedAt && new Date(hit.startedAt);
          hit.turnStartedAt = hit.turnStartedAt && new Date(hit.turnStartedAt);
          hit.endedAt = hit.endedAt && new Date(hit.endedAt);
        });

        return result;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchMyActiveGames(query);
        throw error;
      });
  }
  searchOpenGames(query) {
    return this._server.requestAuthorized(this.name, 'searchOpenGames', [query])
      .then(result => {
        result.hits.forEach(hit => {
          hit.createdAt = new Date(hit.createdAt);
          hit.updatedAt = new Date(hit.updatedAt);
          hit.startedAt = hit.startedAt && new Date(hit.startedAt);
          hit.turnStartedAt = hit.turnStartedAt && new Date(hit.turnStartedAt);
          hit.endedAt = hit.endedAt && new Date(hit.endedAt);
        });

        return result;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchOpenGames(query);
        throw error;
      });
  }
  searchMyCompletedGames(query) {
    return this._server.requestAuthorized(this.name, 'searchMyCompletedGames', [ query ])
      .then(result => {
        result.hits.forEach(hit => {
          hit.createdAt = new Date(hit.createdAt);
          hit.updatedAt = new Date(hit.updatedAt);
          hit.startedAt = hit.startedAt && new Date(hit.startedAt);
          hit.turnStartedAt = hit.turnStartedAt && new Date(hit.turnStartedAt);
          hit.endedAt = hit.endedAt && new Date(hit.endedAt);
        });

        return result;
      })
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchMyCompletedGames(query);
        throw error;
      });
  }

  watchGame(gameId, resume) {
    return this._server.joinAuthorized(this.name, `/games/${gameId}`, resume)
      .then(data => {
        let gameData = data.gameData;
        let state = gameData.state;
        if (state) {
          if (state.startedAt)
            state.startedAt = new Date(state.startedAt);
          if (state.turnStartedAt)
            state.turnStartedAt = new Date(state.turnStartedAt);
          if (state.teams)
            state.teams.forEach(team => {
              if (!team) return;
              team.createdAt = new Date(team.createdAt);
            });
          if (state.actions)
            state.actions.forEach(action => {
              action.createdAt = new Date(action.createdAt);
            });
        }

        if (data.newActions)
          data.newActions.forEach(action => {
            action.createdAt = new Date(action.createdAt);
          });

        if (gameData.playerRequest)
          Object.assign(gameData.playerRequest, {
            createdAt: new Date(gameData.playerRequest.createdAt),
            accepted: new Set(gameData.playerRequest.accepted),
            rejected: new Map(gameData.playerRequest.rejected),
          });

        return data;
      });
  }
  async submitAction(gameId, action) {
    let beforeUnloadListener = event => {
      event.preventDefault();
      return event.returnValue = 'Your move hasn\'t been saved yet!';
    };

    window.addEventListener('beforeunload', beforeUnloadListener, { capture:true });

    try {
      await this._server.requestJoined(this.name, `/games/${gameId}`, 'action', [ action ]);
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
    try {
      return await this._server.requestJoined(this.name, `/games/${gameId}`, 'playerRequest', [ 'undo' ]);
    }
    catch (error) {
      if (error === 'Connection reset')
        return this.undo(gameId);

      throw error;
    }
  }
  async truce(gameId) {
    try {
      return await this._server.requestJoined(this.name, `/games/${gameId}`, 'playerRequest', [ 'truce' ]);
    }
    catch (error) {
      if (error === 'Connection reset')
        return this.truce(gameId);

      throw error;
    }
  }

  async acceptPlayerRequest(gameId, createdAt) {
    try {
      this._server.emitAuthorized(this.name, `/games/${gameId}`, 'playerRequest:accept', createdAt);
    } catch (error) {
      if (error === 'Connection reset')
        return this.acceptPlayerRequest(gameId, createdAt);

      throw error;
    }
  }
  async rejectPlayerRequest(gameId, createdAt) {
    try {
      this._server.emitAuthorized(this.name, `/games/${gameId}`, 'playerRequest:reject', createdAt);
    } catch (error) {
      if (error === 'Connection reset')
        return this.rejectPlayerRequest(gameId, createdAt);

      throw error;
    }
  }
  async cancelPlayerRequest(gameId, createdAt) {
    try {
      this._server.emitAuthorized(this.name, `/games/${gameId}`, 'playerRequest:cancel', createdAt);
    } catch (error) {
      if (error === 'Connection reset')
        return this.cancelPlayerRequest(gameId, createdAt);

      throw error;
    }
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
