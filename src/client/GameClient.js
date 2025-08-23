import Client from 'client/Client.js';
import 'tactics/GameType.js';
import 'models/GameSummary.js';

export default class GameClient extends Client {
  constructor(server, authClient) {
    super('game', server);

    Object.assign(this, {
      _authClient: authClient,
    });

    authClient.on('token', ({data:token}) => this._authorize(token));

    const listener = event => {
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

  resetRatings(targetPlayerId, rankingId = null) {
    return this._server.requestAuthorized(this.name, 'resetRatings', [ targetPlayerId, rankingId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.resetRatings(targetPlayerId, rankingId);
        throw error;
      });
  }
  grantAvatar(playerId, unitType) {
    return this._server.requestAuthorized(this.name, 'grantAvatar', [ playerId, unitType ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.grantAvatar(playerId, unitType);
        throw error;
      });
  }

  createGame(gameTypeId, gameOptions) {
    return this._server.requestAuthorized(this.name, 'createGame', [ gameTypeId, gameOptions ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.createGame(gameTypeId, gameOptions);
        throw error;
      });
  }
  tagGame(gameId, tags) {
    return this._server.requestAuthorized(this.name, 'tagGame', [ gameId, tags ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.tagGame(gameId, tags);
        throw error;
      });
  }

  forkGame(gameId, options) {
    return this._server.requestAuthorized(this.name, 'forkGame', [ gameId, options ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.forkGame(gameId, options);
        throw error;
      });
  }

  cancelGame(gameId) {
    return this._server.requestAuthorized(this.name, 'cancelGame', [ gameId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.cancelGame(gameId);
        throw error;
      });
  }
  declineGame(gameId) {
    return this._server.requestAuthorized(this.name, 'declineGame', [ gameId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.declineGame(gameId);
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
  getGameTypes() {
    return this._server.request(this.name, 'getGameTypes')
      .catch(error => {
        if (error === 'Connection reset')
          return this.getGameTypes();
        throw error;
      });
  }
  getGameType(gameTypeId) {
    return this._server.request(this.name, 'getGameTypeConfig', [gameTypeId])
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
      .catch(error => {
        if (error === 'Connection reset')
          return this.getTurnData(gameId, turnId);
        throw error;
      });
  }
  getTurnActions(gameId, turnId) {
    return this._server.request(this.name, 'getTurnActions', [ gameId, turnId ])
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
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerInfo(gameId, playerId);
        throw error;
      });
  }
  getMyInfo() {
    return this._server.requestAuthorized(this.name, 'getMyInfo', [ ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getMyInfo();
        throw error;
      });
  }
  clearWLDStats(playerId, gameTypeId) {
    return this._server.requestAuthorized(this.name, 'clearWLDStats', [ playerId, gameTypeId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.clearWLDStats(playerId, gameTypeId);
        throw error;
      });
  }

  getPlayerSets(gameTypeId) {
    return this._server.requestAuthorized(this.name, 'getPlayerSets', [ gameTypeId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerSets(gameTypeId);
        throw error;
      });
  }
  getPlayerSet(gameTypeId, setId) {
    return this._server.requestAuthorized(this.name, 'getPlayerSet', [ gameTypeId, setId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerSet(gameTypeId, setId);
        throw error;
      });
  }
  savePlayerSet(gameTypeId, set) {
    return this._server.requestAuthorized(this.name, 'savePlayerSet', [ gameTypeId, set ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.savePlayerSet(gameTypeId, set);
        throw error;
      });
  }
  deletePlayerSet(gameTypeId, setId) {
    return this._server.requestAuthorized(this.name, 'deletePlayerSet', [ gameTypeId, setId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.deletePlayerSet(gameTypeId, setId);
        throw error;
      });
  }

  getMyAvatar() {
    return this._server.requestAuthorized(this.name, 'getMyAvatar')
      .catch(error => {
        if (error === 'Connection reset')
          return this.getMyAvatar();
        throw error;
      });
  }
  saveMyAvatar(avatar) {
    return this._server.requestAuthorized(this.name, 'saveMyAvatar', [ avatar ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.saveMyAvatar(avatar);
        throw error;
      });
  }
  getMyAvatarList() {
    return this._server.requestAuthorized(this.name, 'getMyAvatarList')
      .catch(error => {
        if (error === 'Connection reset')
          return this.getMyAvatarList();
        throw error;
      });
  }
  getPlayersAvatar(playerIds) {
    return this._server.requestAuthorized(this.name, 'getPlayersAvatar', [ playerIds ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayersAvatar(playerIds);
        throw error;
      });
  }

  searchMyGames(query) {
    return this._server.requestAuthorized(this.name, 'searchMyGames', [ query ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchMyGames(query);
        throw error;
      });
  }
  searchGameCollection(collection, query) {
    return this._server.requestAuthorized(this.name, 'searchGameCollection', [ collection, query ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.searchGameCollection(collection, query);
        throw error;
      });
  }
  getRatedGames(rankingId, playerId) {
    return this._server.requestAuthorized(this.name, 'getRatedGames', [ rankingId, playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getRatedGames(rankingId, playerId);
        throw error;
      });
  }

  joinMyGamesGroup(params) {
    const playerId = this._authClient.playerId;

    return this._server.joinAuthorized(this.name, `/myGames/${playerId}`, params);
  }
  joinCollectionStatsGroup(params) {
    return this._server.joinAuthorized(this.name, '/collections', params);
  }
  joinCollectionGroup(collectionId, params) {
    return this._server.joinAuthorized(this.name, `/collections/${collectionId}`, params);
  }
  leaveCollectionGroup(collectionId) {
    return this._server.leave(this.name, `/collections/${collectionId}`)
      .catch(error => {
        if (error === 'Connection reset')
          return;
        throw error;
      });
  }
  watchGame(gameId, reference) {
    return this._server.joinAuthorized(this.name, `/games/${gameId}`, reference);
  }
  closeGame(gameId) {
    return this._server.leave(this.name, `/games/${gameId}`);
  }
  async submitAction(gameId, action) {
    const beforeUnloadListener = event => {
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

    const authClient = this._authClient;

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
