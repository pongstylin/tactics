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
    let claims = jwt.verify(token, config.publicKey);

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
      type:   'closeGroup',
      client: client.id,
      body: {
        group: groupPath,
      },
    });

    // Save the game before it is wiped from memory.
    dataAdapter.saveGame(gamePara.game);
  }
  onPlayerOnline(playerId) {
    this.gamePara.forEach(gamePara => {
      let game = gamePara.game;
      let gamePlayerIds = game.state.teams.map(t => t.playerId);
      if (!gamePlayerIds.includes(playerId))
        return;

      this._emitPlayerStatus(`/games/${game.id}`, playerId, 'online');
    });
  }
  onPlayerOffline(playerId) {
    this.gamePara.forEach(gamePara => {
      let game = gamePara.game;
      let gamePlayerIds = game.state.teams.map(t => t.playerId);
      if (!gamePlayerIds.includes(playerId))
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

    let game = dataAdapter.createGame(stateData);
    return game.id;
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
      game.state.teams.forEach(t => delete t.set);

    return game;
  }

  /*
   * Start sending change events to the client about this game.
   */
  onJoinGroup(client, groupPath) {
    let match;
    if (match = groupPath.match(/^\/games\/(.+)$/))
      return this.onJoinGameGroup(client, groupPath, match[1]);
    else
      throw new ServerError(404, 'No such group');
  }

  onJoinGameGroup(client, groupPath, gameId) {
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

        if (event.type === 'joined' || event.type === 'action' || event.type === 'reset')
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
        .on('reset', listener)
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

    return game.state.teams.map(team => {
      if (!team) return null;
      let playerId = team.playerId;
      let teamPlayerPara = this.playerPara.get(playerId);

      let status;
      if (!teamPlayerPara)
        status = 'offline';
      else if (!teamPlayerPara.watchedGames.has(game.id))
        status = 'online';
      else
        status = 'ingame';

      return { playerId, status };
    });
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
        .off('reset', listener)
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
    if (!gamePara || gamePara.undoRequest) return;

    let playerId = this.clientPara.get(client.id).playerId;
    let game = gamePara.game;

    if (!Array.isArray(action))
      action = [action];

    let myTeams = game.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(401, 'You are not a player in this game.');
    else if (action[0].type === 'surrender')
      if (myTeams.length === game.state.teams.length)
        action[0].teamId = game.state.currentTeamId;
      else
        action = myTeams.map(t => ({ type:'surrender', teamId:t.id }));
    else if (myTeams.includes(game.state.currentTeam))
      action.forEach(a => a.teamId = game.state.currentTeamId);
    else
      throw new ServerError(401, 'Not your turn!');

    game.state.postAction(action);
  }
  // Undo mechanic is not yet complete.  The following code is incomplete.
  /*
  onUndoEvent(client, gamePath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = this._getGame(gameId);
    if (game.undoRequest) return;

    let clientPara = this.clientPara.get(client.id);

    // TODO: Conditionally request an undo depending on luck.
    if (false) {
      game.undoRequest = {
        playerId: clientPara.playerId,
        accepts: new Set([clientPara.playerId]),
      };
      dataAdapter.saveGame(game);

      this._emit({
        type: 'event',
        body: {
          group: groupPath,
          data: {
            type: 'undoRequest',
            requestedBy: {
              id:   clientPara.playerId,
              name: clientPara.name,
            },
          },
        },
      });
    }
    else
      // TODO: Determine how much to undo since the undo request may be made by
      // either the current turn's player or a previous turn's player.
      game.state.undo();
  }
  onUndoRejectEvent(client, gamePath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = this._getGame(gameId);
    if (!game.undoRequest) return;

    delete game.undoRequest;
    dataAdapter.saveGame(game);

    this._emit({
      type: 'event',
      body: {
        group: groupPath,
        data: {
          type: 'undoReject',
          rejectedBy: {
            id:   clientPara.playerId,
            name: clientPara.name,
          },
        },
      },
    });
  }
  onUndoAcceptEvent(client, gamePath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = this._getGame(gameId);
    if (!game.undoRequest) return;

    let clientPara = this.clientPara.get(client.id);

    game.undoRequest.accepts.add(clientPara.playerId);

    if (game.undoRequest.accepts.size === game.state.teams.length) {
      delete game.undoRequest;

      game.state.undo();
    }

    dataAdapter.saveGame(game);
  }
  */

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
