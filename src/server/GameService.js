import jwt from 'jsonwebtoken';

import config from 'config/server.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';
import Game from 'models/Game.js';

const dataAdapter = adapterFactory();

class GameService extends Service {
  constructor() {
    super({
      name: 'game',

      /*
       * Entity: Any identifiable thing that exists apart from any other thing.
       *   Example: A player.
       * Data: Commonly the data that represents an entity.
       *   Example: A player's name.
       * Paradata: The data surrounding an entity, but doesn't describe it.
       *   Example: A player's session.
       */
      // Paradata about each active client by client ID.
      clientPara: new Map(),

      // Paradata about each watched game by game ID.
      gamePara: new Map(),

      // Paradata about each online player by player ID.
      playerPara: new Map(),
    });
  }

  /*
   * Test if the service will handle the eventName from client
   */
  will(client, messageType, bodyType) {
    // No authorization required
    if (bodyType === 'getGame') return true;

    // Authorization required
    let clientPara = this.clientPara.get(client.id);
    if (!clientPara)
      throw new ServerError(401, 'Authorization is required');
    if (clientPara.expires < (new Date() / 1000))
      throw new ServerError(401, 'Token is expired');
  }

  dropClient(client) {
    let clientPara = this.clientPara.get(client.id);
    if (clientPara) {
      if (clientPara.watchedGames)
        clientPara.watchedGames.forEach(game =>
          this.onLeaveGameGroup(client, `/games/${game.id}`, game.id)
        );

      let playerPara = this.playerPara.get(clientPara.playerId);
      if (playerPara.clients.size > 1)
        playerPara.clients.delete(clientPara);
      else {
        this.playerPara.delete(clientPara.playerId);

        // Let people who needs to know that this player went offline.
        this.onPlayerOffline(clientPara.playerId);
      }

      this.clientPara.delete(client.id);
    }

    super.dropClient(client);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    if (!token)
      throw new ServerError(422, 'Required authorization token');

    let clientPara = this.clientPara.get(client.id) || {};
    let claims;
    
    try {
      claims = jwt.verify(token, config.publicKey);
    }
    catch (error) {
      throw new ServerError(401, error.message);
    }

    let playerId = clientPara.playerId = claims.sub;
    clientPara.deviceId = claims.deviceId;
    clientPara.name = claims.name;
    clientPara.expires = claims.exp;
    this.clientPara.set(client.id, clientPara);

    let playerPara = this.playerPara.get(playerId);
    if (playerPara)
      // This operation would be redundant if client authorizes more than once.
      playerPara.clients.add(clientPara);
    else {
      this.playerPara.set(playerId, {
        clients: new Set([clientPara]),
        watchedGames: new Map(),
      });

      // Let people who needs to know that this player is online.
      this.onPlayerOnline(playerId);
    }
  }

  onGameEnd(gameId) {
    let gamePara = this.gamePara.get(gameId);
    gamePara.clients.forEach(clientPara =>
      clientPara.watchedGames.delete(gameId)
    );
    this.gamePara.delete(gameId);

    this._emit({
      type: 'closeGroup',
      body: {
        group: `/games/${gameId}`,
      },
    });

    // Save the game before it is wiped from memory.
    dataAdapter.saveGame(gamePara.game);
  }
  onPlayerOnline(playerId) {
    this.gamePara.forEach(gamePara => {
      let game = gamePara.game;
      if (!game.state.teams.find(t => t && t.playerId === playerId))
        return;

      this._emitPlayerStatus(`/games/${game.id}`, playerId, 'online');
    });
  }
  onPlayerOffline(playerId) {
    this.gamePara.forEach(gamePara => {
      let game = gamePara.game;
      if (!game.state.teams.find(t => t && t.playerId === playerId))
        return;

      this._emitPlayerStatus(`/games/${game.id}`, playerId, 'offline');
    });
  }

  /*
   * Create a new game and save it to persistent storage.
   */
  onCreateGameRequest(client, stateData) {
    let clientPara = this.clientPara.get(client.id);
    this.throttle(clientPara.playerId, 'createGame');

    return dataAdapter.createGame(stateData).then(game => game.id);
  }

  onGetGameRequest(client, gameId) {
    this.throttle(client.address, 'getGame');

    /*
     * When getting a game, leave out the turn history as an efficiency measure.
     */
    let game = this._getGame(gameId).toJSON();
    game.state = game.state.getData();

    // Conditionally leave out the team sets as a security measure.  We don't
    // want people getting set information about teams before the game starts.
    if (!game.state.started)
      game.state.teams.forEach(t => {
        if (!t) return;
        delete t.set;
      });

    return game;
  }
  onGetPlayerStatusRequest(client, gameId) {
    let game = gameId instanceof Game ? gameId : this._getGame(gameId);
    let playerStatus = new Map();

    game.state.teams.forEach(team => {
      if (!team) return;

      let playerId = team.playerId;
      if (playerStatus.has(playerId)) return;

      let playerPara = this.playerPara.get(playerId);

      let status;
      if (!playerPara)
        status = 'offline';
      else if (!playerPara.watchedGames.has(game.id))
        status = 'online';
      else
        status = 'ingame';

      playerStatus.set(playerId, { playerId, status });
    });

    return [...playerStatus.values()];
  }

  onListMyGamesRequest(client, query) {
    let clientPara = this.clientPara.get(client.id);

    return dataAdapter.listPlayerGames(clientPara.playerId, query);
  }

  /*
   * Start sending change events to the client about this game.
   */
  onJoinGroup(client, groupPath, params) {
    let match;
    if (match = groupPath.match(/^\/games\/(.+)$/))
      return this.onJoinGameGroup(client, groupPath, match[1], params);
    else
      throw new ServerError(404, 'No such group');
  }

  onJoinGameGroup(client, groupPath, gameId, params) {
    let clientPara = this.clientPara.get(client.id);
    let playerPara = this.playerPara.get(clientPara.playerId);
    let gamePara = this.gamePara.get(gameId);
    let game = gamePara ? gamePara.game : this._getGame(gameId);

    if (gamePara)
      gamePara.clients.add(clientPara);
    else {
      // Can't watch ended games.
      if (game.ended)
        throw new ServerError(409, 'The game has ended');

      let listener = event => {
        this._emit({
          type: 'event',
          body: {
            group: groupPath,
            type:  event.type,
            data:  event.data,
          },
        });

        if (event.type === 'joined' || event.type === 'action' || event.type === 'revert')
          // Since games are saved before they are removed from memory this only
          // serves as a precaution against a server crash.  It would also be
          // useful in a multi-server context, but that requires more thinking.
          dataAdapter.saveGame(game);
        else if (event.type === 'endGame')
          this.onGameEnd(gameId);
      };

      game.state
        .on('joined', listener)
        .on('startGame', listener)
        .on('startTurn', listener)
        .on('action', listener)
        .on('revert', listener)
        .on('endGame', listener);

      this.gamePara.set(gameId, gamePara = {
        game:     game,
        clients:  new Set([clientPara]),
        listener: listener,
      });
    }

    if (clientPara.watchedGames)
      clientPara.watchedGames.set(game.id, game);
    else
      clientPara.watchedGames = new Map([[game.id, game]]);

    if (playerPara.watchedGames.has(game.id))
      playerPara.watchedGames.get(game.id).add(client.id);
    else {
      playerPara.watchedGames.set(game.id, new Set([client.id]));
      this._emitPlayerStatus(groupPath, clientPara.playerId, 'ingame');
    }

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   clientPara.playerId,
          name: clientPara.name,
        },
      },
    });

    let response = {
      playerStatus: this.onGetPlayerStatusRequest(client, game),
    };

    // Parameters are used to resume a game from a given point.
    if (params) {
      response.events = [];
      response.undoRequest = null;

      // Get any additional actions made in the provided turn.
      let actions = game.state.getTurnActions(params.turnId)
        .slice(params.actions);

      if (actions.length)
        response.events.push({ type:'action', data:actions });

      // Get actions made in any subsequent turns.
      for (let i = params.turnId+1; i <= game.state.currentTurnId; i++) {
        response.events.push({
          type: 'startTurn',
          data: {
            turnId: i,
            teamId: i % game.state.teams.length,
          },
        });

        actions = game.state.getTurnActions(i);

        if (actions.length)
          response.events.push({ type:'action', data:actions });
      }

      if (game.state.ended)
        response.events.push({
          type: 'endGame',
          data: { winnerId:game.state.winnerId },
        });
      else if (game.undoRequest)
        // Make sure the client is aware of the last undo request.
        response.undoRequest = Object.assign({}, game.undoRequest, {
          accepts: [...game.undoRequest.accepts],
        });
    }
    else {
      let gameData = game.toJSON();
      gameData.state = game.state.getData();

      response.gameData = gameData;
    }

    return response;
  }

  /*
   * No longer send change events to the client about this game.
   */
  onLeaveGameGroup(client, groupPath, gameId) {
    let clientPara = this.clientPara.get(client.id);
    let playerPara = this.playerPara.get(clientPara.playerId);
    let game = gameId instanceof Game ? gameId : this._getGame(gameId);

    // Already not watching?
    if (!clientPara.watchedGames)
      return;
    if (!clientPara.watchedGames.has(game.id))
      return;

    let gamePara = this.gamePara.get(game.id);
    if (gamePara.clients.size > 1)
      gamePara.clients.delete(clientPara);
    else {
      // TODO: Don't shut down the game state until all bots have made their turns.
      let listener = gamePara.listener;

      game.state
        .off('joined', listener)
        .off('startGame', listener)
        .off('startTurn', listener)
        .off('action', listener)
        .off('revert', listener)
        .off('endGame', listener);

      this.gamePara.delete(game.id);

      // Save the game before it is wiped from memory.
      dataAdapter.saveGame(gamePara.game);
    }

    if (clientPara.watchedGames.size === 1)
      delete clientPara.watchedGames;
    else
      clientPara.watchedGames.delete(game.id);

    let watchingClientIds = playerPara.watchedGames.get(game.id);

    // Only say the player is online if another client isn't ingame.
    if (watchingClientIds.size === 1) {
      playerPara.watchedGames.delete(game.id);

      // Don't say the player is online if the player is going offline.
      if (playerPara.clients.size > 1 || !client.closing)
        this._emitPlayerStatus(groupPath, clientPara.playerId, 'online');
    }
    else
      watchingClientIds.delete(client.id);

    this._emit({
      type:   'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   clientPara.playerId,
          name: clientPara.name,
        },
      },
    });
  }

  onJoinGameRequest(client, gameId, {set, slot} = {}) {
    let clientPara = this.clientPara.get(client.id);
    let game = this._getGame(gameId);
    if (game.state.started)
      throw new ServerError(409, 'The game has already started.');

    let team = {
      playerId: clientPara.playerId,
      name: clientPara.name,
    };
    if (set)
      team.set = set;

    game.state.join(team, slot);
    dataAdapter.saveGame(game);
  }
  onGetTurnDataRequest(client, gameId, ...args) {
    return this._getGame(gameId).state.getTurnData(...args);
  }
  onGetTurnActionsRequest(client, gameId, ...args) {
    return this._getGame(gameId).state.getTurnActions(...args);
  }
  onRestartRequest(client, gameId, ...args) {
    return this._getGame(gameId).state.restart(...args);
  }

  /*
   * Make sure the connected client is authorized to post this event.
   *
   * The GameState class is responsible for making sure the authorized client
   * may make the provided action.
   */
  onActionEvent(client, groupPath, action) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let gamePara = this.gamePara.get(gameId);
    if (!gamePara)
      throw new ServerError(403, 'You have not joined the game group');

    let playerId = this.clientPara.get(client.id).playerId;

    let game = gamePara.game;
    let undoRequest = game.undoRequest || {};
    if (undoRequest.status === 'pending')
      throw new ServerError(409, 'An undo request is still pending');

    let myTeams = game.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(401, 'You are not a player in this game.');

    if (!Array.isArray(action))
      action = [action];

    if (action[0].type === 'surrender')
      if (myTeams.length === game.state.teams.length)
        action[0].teamId = game.state.currentTeamId;
      else
        action = myTeams.map(t => ({ type:'surrender', teamId:t.id }));
    else if (myTeams.includes(game.state.currentTeam))
      action.forEach(a => a.teamId = game.state.currentTeamId);
    else
      throw new ServerError(401, 'Not your turn!');

    game.state.postAction(action);
    // Clear a rejected undo request after an action is performed.
    game.undoRequest = null;

    dataAdapter.saveGame(game);
  }
  onUndoEvent(client, groupPath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let gamePara = this.gamePara.get(gameId);
    if (!gamePara)
      throw new ServerError(403, 'You have not joined the game group');

    let game = gamePara.game;
    let playerId = this.clientPara.get(client.id).playerId;

    // Determine the team that is requesting the undo.
    let team = game.state.currentTeam;
    while (team.playerId !== playerId) {
      let prevTeamId = (team.id === 0 ? game.state.teams.length : team.id) - 1;
      team = game.state.teams[prevTeamId];
    }

    let undoRequest = game.undoRequest;
    if (undoRequest) {
      if (undoRequest.status === 'pending')
        throw new ServerError(409, 'An undo request is still pending');
      else if (undoRequest.status === 'rejected')
        if (undoRequest.teamId === team.id)
          throw new ServerError(403, 'Your undo request was rejected');
    }

    // In case a player controls multiple teams...
    let myTeams = game.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(401, 'You are not a player in this game.');

    let canUndo = game.state.canUndo(team);
    if (canUndo === false)
      // The undo is rejected.
      throw new ServerError(403, 'You can not undo right now');
    else if (canUndo === true)
      // The undo is auto-approved.
      game.state.undo(team);
    else {
      // The undo request requires approval from the other player(s).
      game.undoRequest = {
        status: 'pending',
        teamId: team.id,
        accepts: new Set(myTeams.map(t => t.id)),
      };

      // The request is sent to all players.  The initiator may cancel.
      this._emit({
        type: 'event',
        body: {
          group: groupPath,
          type:  'undoRequest',
          data:  Object.assign({}, game.undoRequest, {
            accepts: [...game.undoRequest.accepts],
          }),
        },
      });
    }

    dataAdapter.saveGame(game);
  }
  onUndoAcceptEvent(client, groupPath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = this._getGame(gameId);
    let undoRequest = game.undoRequest;
    if (!undoRequest)
      throw new ServerError(400, 'No undo request');
    else if (undoRequest.status !== 'pending')
      throw new ServerError(400, 'Undo request is not pending');

    let playerId = this.clientPara.get(client.id).playerId;
    let teams = game.state.teams;
    let myTeams = teams.filter(t => t.playerId === playerId);

    myTeams.forEach(t => undoRequest.accepts.add(t.id));

    this._emit({
      type: 'event',
      body: {
        group: groupPath,
        type:  'undoAccept',
        data: {
          playerId: playerId,
        },
      },
    });

    if (undoRequest.accepts.size === teams.length) {
      undoRequest.status = 'completed';

      this._emit({
        type: 'event',
        body: {
          group: groupPath,
          type:  'undoComplete',
        },
      });

      game.state.undo(teams[undoRequest.teamId], true);
    }

    dataAdapter.saveGame(game);
  }
  onUndoRejectEvent(client, groupPath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = this._getGame(gameId);
    let undoRequest = game.undoRequest;
    if (!undoRequest)
      throw new ServerError(400, 'No undo request');
    else if (undoRequest.status !== 'pending')
      throw new ServerError(400, 'Undo request is not pending');

    let playerId = this.clientPara.get(client.id).playerId;

    this._emit({
      type: 'event',
      body: {
        group: groupPath,
        type:  'undoReject',
        data: {
          playerId: playerId,
        },
      },
    });

    undoRequest.status = 'rejected';
    undoRequest.rejectedBy = playerId;

    dataAdapter.saveGame(game);
  }
  onUndoCancelEvent(client, groupPath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = this._getGame(gameId);
    let undoRequest = game.undoRequest;
    if (!undoRequest)
      throw new ServerError(400, 'No undo request');
    else if (undoRequest.status !== 'pending')
      throw new ServerError(400, 'Undo request is not pending');

    let playerId = this.clientPara.get(client.id).playerId;
    let requestorId = game.state.teams[undoRequest.teamId].playerId;
    if (playerId !== requestorId)
      throw new ServerError(403, 'Only requesting player may cancel undo');

    this._emit({
      type: 'event',
      body: {
        group: groupPath,
        type:  'undoCancel',
      },
    });

    undoRequest.status = 'cancelled';

    dataAdapter.saveGame(game);
  }

  /*******************************************************************************
   * Helpers
   ******************************************************************************/
  _getGame(gameId) {
    let game;
    if (this.gamePara.has(gameId))
      game = this.gamePara.get(gameId).game;
    else
      game = dataAdapter.getGame(gameId);

    return game;
  }

  _emitPlayerStatus(groupPath, playerId, status) {
    this._emit({
      type: 'event',
      body: {
        group: groupPath,
        type: 'playerStatus',
        data: { playerId, status },
      },
    });
  }
}

// This class is a singleton
export default new GameService();
