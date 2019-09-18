import jwt from 'jsonwebtoken';

import config from 'config/server.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';
import serviceFactory from 'server/serviceFactory.js';
import Game from 'models/Game.js';

const dataAdapter = adapterFactory();
const chatService = serviceFactory('chat');
const pushService = serviceFactory('push');

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
   * Test if the service will handle the message from client
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

  async dropClient(client) {
    let clientPara = this.clientPara.get(client.id);
    if (!clientPara) return;

    if (clientPara.joinedGroups)
      await Promise.all(
        [...clientPara.joinedGroups.values()].map(game =>
          this.onLeaveGameGroup(client, `/games/${game.id}`, game.id)
        )
      );

    let playerPara = this.playerPara.get(clientPara.playerId);
    if (playerPara.clients.size > 1)
      playerPara.clients.delete(client.id);
    else {
      this.playerPara.delete(clientPara.playerId);

      // Let people who needs to know that this player went offline.
      this.onPlayerOffline(clientPara.playerId);
    }

    this.clientPara.delete(client.id);
  }

  /*
   * Generate a 'yourTurn' notification to indicate that it is currently the
   * player's turn for X number of games.  If only one game, then it provides
   * details for the game and may link to that game.  Otherwise, it indicates
   * the number of games and may link to the active games page.
   */
  async getYourTurnNotification(playerId) {
    let gamesSummary = await dataAdapter.listMyTurnGamesSummary(playerId);

    /*
     * Exclude games the player is actively playing.
     */
    let playerPara = this.playerPara.get(playerId);
    if (playerPara)
      gamesSummary = gamesSummary
        .filter(gs => !playerPara.joinedGroups.has(gs.id));

    let notification = {
      type: 'yourTurn',
      createdAt: new Date(),
      gameCount: gamesSummary.length,
    };

    if (gamesSummary.length === 0)
      return notification;
    else if (gamesSummary.length > 1) {
      notification.turnStartedAt = new Date(
        Math.max(...gamesSummary.map(gs => new Date(gs.updated)))
      );
      return notification;
    }
    else
      notification.turnStartedAt = new Date(gamesSummary[0].updated);

    // Search for the next opponent team after this team.
    // Useful for 4-team games.
    let teams = gamesSummary[0].teams;
    let teamId = gamesSummary[0].currentTeamId;
    let opponentTeam;
    for (let i=1; i<teams.length; i++) {
      let nextTeam = teams[(teamId + i) % teams.length];
      if (nextTeam.playerId === playerId) continue;

      opponentTeam = nextTeam;
      break;
    }

    return Object.assign(notification, {
      gameId: gamesSummary[0].id,
      opponent: opponentTeam.name,
    });
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
    clientPara.name = claims.name;
    clientPara.expires = claims.exp;
    this.clientPara.set(client.id, clientPara);

    let playerPara = this.playerPara.get(playerId);
    if (playerPara)
      // This operation would be redundant if client authorizes more than once.
      playerPara.clients.add(client.id);
    else {
      this.playerPara.set(playerId, {
        clients: new Set([client.id]),
        joinedGroups: new Map(),
      });

      // Let people who needs to know that this player is online.
      this.onPlayerOnline(playerId);
    }
  }

/*
 * The group SHOULD be closed on game end because no more events or requests are
 * accepted for the game.  But there are two things that still require it:
 *  1) Resuming or replaying a game.  Someone may have gone inactive mid-game
 *  and wish to resume it post-game.  This function should be separated from the
 *  game group as we add support for replaying completed games.
 *
 *  2) Player status.  The players may continue to chat after game end, but wish
 *  to know if their opponent is still present.  For active game groups, we want
 *  to track the player's online or ingame status.  But for chat groups, we only
 *  want to track whether the player is inchat or not.  This should be managed
 *  separately from game groups.
 *
  onGameEnd(gameId) {
    let gamePara = this.gamePara.get(gameId);
    gamePara.clients.forEach(clientPara =>
      clientPara.joinedGroups.delete(gameId)
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
*/
  onPlayerOnline(playerId) {
    this.gamePara.forEach(gamePara => {
      let game = gamePara.game;
      if (game.state.ended)
        return;
      if (!game.state.teams.find(t => t && t.playerId === playerId))
        return;

      this._emitPlayerStatus(`/games/${game.id}`, playerId, 'online');
    });
  }
  onPlayerOffline(playerId) {
    this.gamePara.forEach(gamePara => {
      let game = gamePara.game;
      if (game.state.ended)
        return;
      if (!game.state.teams.find(t => t && t.playerId === playerId))
        return;

      this._emitPlayerStatus(`/games/${game.id}`, playerId, 'offline');
    });
  }

  /*
   * Create a new game and save it to persistent storage.
   */
  onCreateGameRequest(client, gameOptions) {
    let clientPara = this.clientPara.get(client.id);
    this.throttle(clientPara.playerId, 'createGame');

    return dataAdapter.createGame(gameOptions).then(game => game.id);
  }

  async onGetGameRequest(client, gameId) {
    this.throttle(client.address, 'getGame');

    /*
     * When getting a game, leave out the turn history as an efficiency measure.
     */
    let game = await this._getGame(gameId);
    let gameData = game.toJSON();
    gameData.state = gameData.state.getData();

    // Conditionally leave out the team sets as a security measure.  We don't
    // want people getting set information about teams before the game starts.
    if (!gameData.state.started)
      gameData.state.teams.forEach(t => {
        if (!t) return;
        delete t.set;
      });

    return gameData;
  }
  async onGetPlayerStatusRequest(client, gameId) {
    let game = gameId instanceof Game ? gameId : await this._getGame(gameId);
    let playerStatus = new Map();

    game.state.teams.forEach(team => {
      if (!team) return;

      let playerId = team.playerId;
      if (playerStatus.has(playerId)) return;

      playerStatus.set(playerId, {
        playerId: playerId,
        status: this._getPlayerStatus(playerId, game),
      });
    });

    return [...playerStatus.values()];
  }

  onSearchPlayerGamesRequest(client, playerId, query) {
    return dataAdapter.searchPlayerGames(playerId, query);
  }
  onSearchOpenGamesRequest(client, query) {
    return dataAdapter.searchOpenGames(query);
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

  async onJoinGameGroup(client, groupPath, gameId, params) {
    let gamePara = this.gamePara.get(gameId);
    let game = gamePara ? gamePara.game : await this._getGame(gameId);

    if (gamePara)
      gamePara.clients.add(client.id);
    else {
      let listener = event => {
        this._emit({
          type: 'event',
          body: {
            group: groupPath,
            type:  event.type,
            data:  event.data,
          },
        });

        if (event.type === 'startTurn')
          dataAdapter.saveGame(game)
            .then(() => this._notifyYourTurn(game, event.data));
        else if (
          event.type === 'joined' ||
          event.type === 'action' ||
          event.type === 'revert' ||
          event.type === 'endGame'
        )
          // Since games are saved before they are removed from memory this only
          // serves as a precaution against a server crash.  It would also be
          // useful in a multi-server context, but that requires more thinking.
          dataAdapter.saveGame(game);
      };

      game.state.on('event', listener);

      this.gamePara.set(gameId, gamePara = {
        game:     game,
        clients:  new Set([client.id]),
        listener: listener,
      });
    }

    let clientPara = this.clientPara.get(client.id);
    if (clientPara.joinedGroups)
      clientPara.joinedGroups.set(game.id, game);
    else
      clientPara.joinedGroups = new Map([[game.id, game]]);

    let playerId = clientPara.playerId;
    let playerPara = this.playerPara.get(playerId);
    if (playerPara.joinedGroups.has(game.id))
      playerPara.joinedGroups.get(game.id).add(client.id);
    else {
      playerPara.joinedGroups.set(game.id, new Set([client.id]));
      this._emitPlayerStatus(groupPath, playerId, 'ingame');
    }

    this._emit({
      type: 'joinGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   playerId,
          name: clientPara.name,
        },
      },
    });

    let response = {
      playerStatus: await this.onGetPlayerStatusRequest(client, game),
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
   * Only called internally since the client does not yet leave intentionally.
   */
  async onLeaveGameGroup(client, groupPath, gameId) {
    let gamePara = this.gamePara.get(gameId);
    if (!gamePara || !gamePara.clients.has(client.id))
      throw new Error(`Expected client (${client.id}) to be in group (${groupPath})`);

    let game = gamePara.game;

    if (gamePara.clients.size > 1)
      gamePara.clients.delete(client.id);
    else {
      // TODO: Don't shut down the game state until all bots have made their turns.
      let listener = gamePara.listener;

      game.state.off('event', listener);

      this.gamePara.delete(game.id);

      // Save the game before it is wiped from memory.
      dataAdapter.saveGame(game);
    }

    let clientPara = this.clientPara.get(client.id);
    if (clientPara.joinedGroups.size === 1)
      delete clientPara.joinedGroups;
    else
      clientPara.joinedGroups.delete(game.id);

    let playerId = clientPara.playerId;
    let playerPara = this.playerPara.get(playerId);
    let watchingClientIds = playerPara.joinedGroups.get(game.id);

    // Only say the player is online if another client isn't ingame.
    if (watchingClientIds.size === 1) {
      playerPara.joinedGroups.delete(game.id);

      // Don't say the player is online if the player is going offline.
      if (playerPara.clients.size > 1 || !client.closing)
        this._emitPlayerStatus(
          groupPath,
          playerId,
          game.state.ended ? 'offline' : 'online',
        );
    }
    else
      watchingClientIds.delete(client.id);

    this._emit({
      type:   'leaveGroup',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   playerId,
          name: clientPara.name,
        },
      },
    });
  }

  async onJoinGameRequest(client, gameId, {set, slot} = {}) {
    this.debug(`joinGame: gameId=${gameId}; slot=${slot}`);

    let clientPara = this.clientPara.get(client.id);
    let game = await this._getGame(gameId);
    if (game.state.started)
      throw new ServerError(409, 'The game has already started.');

    let team = {
      playerId: clientPara.playerId,
      name: clientPara.name,
    };
    if (set)
      team.set = set;

    let numOpenSlots = game.state.teams.filter(t => !t).length;

    return new Promise((resolve, reject) => {
      let startTurnListener = event => {
        game.state.off('startTurn', startTurnListener);
        resolve(event);
      };

      if (numOpenSlots === 1)
        game.state.on('startTurn', startTurnListener);

      try {
        game.state.join(team, slot);
      }
      catch (error) {
        game.state.off('startTurn', startTurnListener);
        reject(error);
      }

      if (numOpenSlots > 1)
        resolve();
    }).then(async event => {
      await dataAdapter.saveGame(game);
      if (!event) return;

      let teams = game.state.teams;
      let players = new Map();

      teams.forEach(team => {
        let playerId = team.playerId;
        if (!playerId || players.has(playerId))
          return;

        let teamName = team.name;
        if (teams.filter(t => t.name === teamName).length > 1)
          teamName = team.color;

        players.set(playerId, teamName);
      });

      if (players.size > 1)
        await chatService.createRoom(
          [...players].map(([id, name]) => ({ id, name })),
          { id:gameId }
        );

      /*
       * Notify the player that goes first that it is their turn.
       * ...unless the player to go first just joined.
       */
      let playerId = teams[event.data.teamId].playerId;
      if (playerId !== clientPara.playerId)
        this._notifyYourTurn(game, event.data);
    });
  }
  async onGetTurnDataRequest(client, gameId, ...args) {
    let game = await this._getGame(gameId);
    
    return game.state.getTurnData(...args);
  }
  async onGetTurnActionsRequest(client, gameId, ...args) {
    let game = await this._getGame(gameId);
    
    return game.state.getTurnActions(...args);
  }
  async onRestartRequest(client, gameId, ...args) {
    let game = await this._getGame(gameId);
    
    return game.state.restart(...args);
  }

  /*
   * Make sure the connected client is authorized to post this event.
   *
   * The GameState class is responsible for making sure the authorized client
   * may make the provided action.
   */
  onActionRequest(client, gameId, action) {
    let gamePara = this.gamePara.get(gameId);
    if (!gamePara)
      throw new ServerError(403, 'You must first join the game group');
    if (!gamePara.clients.has(client.id))
      throw new ServerError(403, 'You must first join the game group');

    let game = gamePara.game;
    let playerId = this.clientPara.get(client.id).playerId;

    if (game.state.ended)
      throw new ServerError(403, 'The game has ended');

    let undoRequest = game.undoRequest || {};
    if (undoRequest.status === 'pending')
      throw new ServerError(409, 'An undo request is still pending');

    let myTeams = game.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(401, 'You are not a player in this game.');

    if (!Array.isArray(action))
      action = [action];

    if (action[0].type === 'surrender') {
      if (action[0].teamId !== undefined) {
        // If surrender is not requested for themself, it is forced.
        if (!myTeams.find(t => t.id === action[0].teamId))
          action[0].forced = true;
      }
      else if (myTeams.length === game.state.teams.length)
        action[0].teamId = game.state.currentTeamId;
      else
        action = myTeams.map(t => ({ type:'surrender', teamId:t.id }));
    }
    else if (myTeams.includes(game.state.currentTeam))
      action.forEach(a => a.teamId = game.state.currentTeamId);
    else
      throw new ServerError(401, 'Not your turn!');

    game.state.submitAction(action);
    // Clear a rejected undo request after an action is performed.
    game.undoRequest = null;

    dataAdapter.saveGame(game);
  }
  onUndoRequest(client, gameId) {
    let gamePara = this.gamePara.get(gameId);
    if (!gamePara)
      throw new ServerError(403, 'You must first join the game group');
    if (!gamePara.clients.has(client.id))
      throw new ServerError(403, 'You must first join the game group');

    let game = gamePara.game;
    let playerId = this.clientPara.get(client.id).playerId;

    if (game.state.ended)
      throw new ServerError(403, 'The game has ended');

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
          group: `/games/${gameId}`,
          type:  'undoRequest',
          data:  Object.assign({}, game.undoRequest, {
            accepts: [...game.undoRequest.accepts],
          }),
        },
      });
    }

    dataAdapter.saveGame(game);
  }

  async onUndoAcceptEvent(client, groupPath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = await this._getGame(gameId);
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
  async onUndoRejectEvent(client, groupPath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = await this._getGame(gameId);
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
  async onUndoCancelEvent(client, groupPath) {
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = await this._getGame(gameId);
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
  async _getGame(gameId) {
    let game;
    if (this.gamePara.has(gameId))
      game = this.gamePara.get(gameId).game;
    else
      game = await dataAdapter.getGame(gameId);

    return game;
  }
  _getPlayerStatus(playerId, game) {
    let playerPara = this.playerPara.get(playerId);

    let status;
    if (!playerPara)
      status = 'offline';
    else if (!playerPara.joinedGroups.has(game.id))
      status = game.state.ended ? 'offline' : 'online';
    else
      status = 'ingame';

    return status;
  }

  async _notifyYourTurn(game, startTurnData) {
    let teamId = startTurnData.teamId;
    let playerId = game.state.teams[teamId].playerId;
    let teams = game.state.teams;

    // Only notify if the next player is not already in-game.
    let status = this._getPlayerStatus(playerId, game);
    if (status === 'ingame')
      return;

    // Search for the next opponent team after this team.
    // Useful for 4-team games.
    let opponentTeam;
    for (let i=1; i<teams.length; i++) {
      let nextTeam = teams[(teamId + i) % teams.length];
      if (nextTeam.playerId === playerId) continue;

      opponentTeam = nextTeam;
      break;
    }

    // Only notify if this is a multiplayer game.
    if (!opponentTeam)
      return;

    let notification = await this.getYourTurnNotification(playerId);
    // Game count should always be >= 1, but just in case...
    if (notification.gameCount === 0)
      return;

    pushService.pushNotification(playerId, notification);
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
