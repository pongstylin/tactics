import getTextWidth from 'string-pixel-width';
import XRegExp from 'xregexp';

import AccessToken from 'server/AccessToken.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';
import serviceFactory from 'server/serviceFactory.js';
import Game from 'models/Game.js';

const dataAdapter = adapterFactory();
const chatService = serviceFactory('chat');
const pushService = serviceFactory('push');

/*
 * Team names may have the following characters:
 *   Letter, Number, Punctuation, Symbol, Space
 *
 * Other restrictions are imposed by the _validateTeamName() method.
 */
XRegExp.install('astral');
let rUnicodeLimit = XRegExp('^(\\pL|\\pN|\\pP|\\pS| )+$');

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
    if (bodyType === 'getGameTypeConfig') return true;

    // Authorization required
    let clientPara = this.clientPara.get(client.id);
    if (!clientPara)
      throw new ServerError(401, 'Authorization is required');
    if (clientPara.token.isExpired)
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
  onAuthorize(client, { token:tokenValue }) {
    if (!tokenValue)
      throw new ServerError(422, 'Required authorization token');

    let clientPara = this.clientPara.get(client.id) || {};
    let token = AccessToken.verify(tokenValue);

    let playerId = clientPara.playerId = token.playerId;
    clientPara.name = token.playerName;
    clientPara.token = token;
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
  async onCreateGameRequest(client, gameTypeId, gameOptions) {
    let clientPara = this.clientPara.get(client.id);
    this.throttle(clientPara.playerId, 'createGame');

    gameOptions.createdBy = clientPara.playerId;

    if (!await dataAdapter.hasGameType(gameTypeId))
      throw new ServerError(400, 'No such game type');

    if (!gameOptions || !gameOptions.teams)
      throw new ServerError(400, 'Required teams');
    else if (gameOptions.teams.length !== 2 && gameOptions.teams.length !== 4)
      throw new ServerError(400, 'Required 2 or 4 teams');

    let gameType = await dataAdapter.getGameType(gameTypeId);
    let teams = gameOptions.teams;

    for (let team of teams) {
      if (!team) continue;

      if (!team.playerId)
        throw new ServerError(400, 'Each team must have a valid player ID');

      let player = await dataAdapter.getPlayer(team.playerId);
      if (!player)
        throw new ServerError(400, 'Player ID not found for team');

      if (!team.name)
        team.name = player.name;
    }

    await this._validateTeamsSets(gameType, teams);

    gameOptions.teams = new Array(teams.length);

    let game = await dataAdapter.createGame(gameType, gameOptions);

    for (let [slot, team] of teams.entries()) {
      if (!team) continue;

      await this._joinGame(game, team, slot);
    }

    // Save the game before generating a notification to ensure it is accurate.
    await dataAdapter.saveGame(game);

    /*
     * Notify the player that goes first that it is their turn.
     * ...unless the player to go first just started the game.
     */
    if (game.state.started) {
      let playerId = teams[game.state.currentTeamId].playerId;
      if (playerId !== clientPara.playerId)
        this._notifyYourTurn(game, game.state.currentTeamId);
    }

    return game.id;
  }
  async onJoinGameRequest(client, gameId, { name, set, slot } = {}) {
    this.debug(`joinGame: gameId=${gameId}; slot=${slot}`);

    let clientPara = this.clientPara.get(client.id);
    let game = await this._getGame(gameId);
    if (game.state.started)
      throw new ServerError(409, 'The game has already started.');

    let gameType = await dataAdapter.getGameType(game.state.type);
    let teams = game.state.teams.slice();

    if (slot === undefined || slot === null) {
      slot = teams.findIndex(t => !t);

      // If still not found, can't join!
      if (slot === -1)
        throw new ServerError(409, 'No slots are available');
    }
    if (slot >= teams.length)
      throw new ServerError(400, 'The slot does not exist');
    if (teams[slot] && teams[slot].playerId !== clientPara.playerId)
      throw new ServerError(409, 'The slot is taken');

    let team = teams[slot] = teams[slot] || {
      playerId: clientPara.playerId,
      name: clientPara.name,
    };

    if (name !== undefined) {
      this._validateTeamName(name);

      team.name = name;
    }

    if (set)
      team.set = set;

    await this._validateTeamsSets(gameType, teams);

    await this._joinGame(game, team, slot);

    // Save the game before generating a notification to ensure it is accurate.
    await dataAdapter.saveGame(game);

    /*
     * Notify the player that goes first that it is their turn.
     * ...unless the player to go first just started the game.
     */
    if (game.state.started) {
      let playerId = teams[game.state.currentTeamId].playerId;
      if (playerId !== clientPara.playerId)
        this._notifyYourTurn(game, game.state.currentTeamId);
    }
  }

  async onCancelGameRequest(client, gameId) {
    let clientPara = this.clientPara.get(client.id);
    this.debug(`cancel game ${gameId}`);
    let game = await dataAdapter.getGame(gameId);
    if (clientPara.playerId !== game.createdBy) {
      throw new ServerError(403, 'You cannot cancel other users\' game');
    } else if (game.started) {
      throw new ServerError(400, 'You cannot cancel a game which has already started');
    }

    let fileDeleted = await dataAdapter.cancelGame(game);
    if (!fileDeleted) {
      throw new ServerError(400, 'Game cannot be cancelled');
    }
    if (this.gamePara.get(gameId)) {
      for (let clientId of this.gamePara.get(gameId).clients) {
        let clientToKick = this.clientPara.get(clientId);
        if (clientToKick.joinedGroups.size === 1) {
          delete clientToKick.joinedGroups;
        } else {
          clientToKick.joinedGroups.delete(game.id);
        }
      }
      this.gamePara.delete(gameId);
    }
  }

  async onGetGameTypeConfigRequest(client, gameTypeId) {
    return dataAdapter.getGameType(gameTypeId);
  }

  async onHasCustomPlayerSetRequest(client, gameTypeId, setName) {
    let clientPara = this.clientPara.get(client.id);

    return dataAdapter.hasCustomPlayerSet(clientPara.playerId, gameTypeId, setName);
  }
  async onGetPlayerSetRequest(client, gameTypeId, setName) {
    let clientPara = this.clientPara.get(client.id);

    return dataAdapter.getPlayerSet(clientPara.playerId, gameTypeId, setName);
  }
  async onSavePlayerSetRequest(client, gameTypeId, setName, set) {
    let clientPara = this.clientPara.get(client.id);

    let gameType = await dataAdapter.getGameType(gameTypeId);
    gameType.validateSet(set);

    return dataAdapter.setPlayerSet(clientPara.playerId, gameTypeId, setName, set);
  }

  async onGetGameRequest(client, gameId) {
    this.throttle(client.address, 'getGame');

    /*
     * When getting a game, leave out the turn history as an efficiency measure.
     */
    let game = await this._getGame(gameId);
    let gameData = game.toJSON();
    gameData.state = gameData.state.getData();

    let teamPlayerIds = new Set(gameData.state.teams.map(t => t && t.playerId));
    let isPracticeGame = teamPlayerIds.size === 1;

    // Don't allow people to view sets for a non-practice game before it starts.
    if (!gameData.state.started && !isPracticeGame)
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
            .then(() => this._notifyYourTurn(game, event.data.teamId));
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

      let state = game.state;
      let turnData;

      if (params.since === 'start') {
        if (state.started) {
          params.since = new Date(state.started);
          params.turnId = 0;
          params.actions = 0;
          turnData = state.getTurnData(params.turnId);

          response.events.push(
            {
              type: 'startGame',
              data: {
                started: state.started,
                teams: state.teams,
                units: state.units,
              },
            },
            {
              type: 'startTurn',
              data: {
                started: turnData.started,
                turnId: turnData.id,
                teamId: turnData.teamId,
              },
            },
          );
        }
      }
      else {
        params.since = new Date(params.since);
        turnData = state.getTurnData(params.turnId);

        /*
         * Determine if the turn data has changed due to reversion.
         * If so, revert to the last known point and play forward from there.
         *
         * This is accomplished by the client providing the date of the last seen
         * event in the game, which could be turn start or action creation.  Using
         * the provided turn ID and action ID, we should come up with the same
         * date.  But, if it is a newer date or if the turn or action no longer
         * exists then a reversion has taken place with possible new activity.
         */
        let since;
        if (!turnData)
          since = new Date();
        else if (!params.actions)
          since = turnData.started;
        else if (!turnData.actions[params.actions-1])
          since = new Date();
        else
          since = turnData.actions[params.actions-1].created;

        if (since > params.since) {
          // Find the last turn that the client saw start
          for (let turnId = state.currentTurnId; turnId > -1; turnId--) {
            let thisTurnData = state.getTurnData(turnId);
            if (thisTurnData.started > params.since) continue;

            // Reset the turn of context
            turnData = thisTurnData;
            params.turnId = turnData.id;
            break;
          }

          // Find the first action that the client didn't see, if any.
          params.actions = turnData.actions.length;
          for (let actionId = 0; actionId < turnData.actions.length; actionId++) {
            if (turnData.actions[actionId].created <= params.since) continue;

            // Reset the action of context
            params.actions = actionId;
            break;
          }

          // Revert to the point of context
          response.events.push({
            type: 'revert',
            data: {
              started: turnData.started,
              turnId:  turnData.id,
              teamId:  turnData.teamId,
              actions: turnData.actions.slice(0, params.actions),
              units:   turnData.units,
            }
          });
        }
      }

      if (turnData) {
        // Get any actions made since the point of context
        let actions = turnData.actions.slice(params.actions);

        if (actions.length)
          response.events.push({ type:'action', data:actions });

        // Get actions made in any subsequent turns.
        for (let i = params.turnId+1; i <= game.state.currentTurnId; i++) {
          let turnData = game.state.getTurnData(i);

          response.events.push({
            type: 'startTurn',
            data: {
              started: turnData.started,
              turnId: i,
              teamId: i % game.state.teams.length,
            },
          });

          actions = turnData.actions;

          if (actions.length)
            response.events.push({ type:'action', data:actions });
        }
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
      throw new ServerError(409, 'The game has ended');

    let undoRequest = game.undoRequest || {};
    if (undoRequest.status === 'pending')
      throw new ServerError(409, 'An undo request is still pending');

    let myTeams = game.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(403, 'You are not a player in this game.');

    if (!Array.isArray(action))
      action = [action];

    if (action[0].type === 'surrender') {
      action[0].declaredBy = playerId;

      if (!action[0].teamId) {
        if (myTeams.length === game.state.teams.length)
          action[0].teamId = game.state.currentTeamId;
        else
          // FIXME: Multiple surrender actions are not handled correctly.
          // Basically, the submitAction() method will stop processing
          // events if the current turn ends.
          action.splice(0, 1, ...myTeams.map(t => Object.assign({
            teamId: t.id,
          }, action[0])));
      }
    }
    else if (myTeams.includes(game.state.currentTeam))
      action.forEach(a => a.teamId = game.state.currentTeamId);
    else
      throw new ServerError(409, 'Not your turn!');

    game.state.submitAction(action);
    // Clear a rejected undo request after an action is performed.
    game.undoRequest = null;

    dataAdapter.saveGame(game);
  }
  onUndoRequest(client, gameId) {
    let gamePara = this.gamePara.get(gameId);
    if (!gamePara)
      throw new ServerError(401, 'You must first join the game group');
    if (!gamePara.clients.has(client.id))
      throw new ServerError(401, 'You must first join the game group');

    let game = gamePara.game;
    let playerId = this.clientPara.get(client.id).playerId;

    // Determine the team that is requesting the undo.
    let team = game.state.currentTeam;
    while (team.playerId !== playerId) {
      let prevTeamId = (team.id === 0 ? game.state.teams.length : team.id) - 1;
      team = game.state.teams[prevTeamId];
    }

    // In case a player controls multiple teams...
    let myTeams = game.state.teams.filter(t => t.playerId === playerId);
    if (myTeams.length === 0)
      throw new ServerError(401, 'You are not a player in this game.');

    if (game.state.ended)
      throw new ServerError(403, 'The game has ended');

    let undoRequest = game.undoRequest;
    if (undoRequest) {
      if (undoRequest.status === 'pending')
        throw new ServerError(409, 'An undo request is still pending');
      else if (undoRequest.status === 'rejected')
        if (undoRequest.teamId === team.id)
          throw new ServerError(403, 'Your undo request was rejected');
    }

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
        createdAt: new Date(),
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
  async _validateTeamsSets(gameType, teams) {
    /*
     * Resolve default sets before resolving opponent sets
     */
    let opponentSetTeams = [];

    for (let team of teams) {
      if (!team)
        continue;

      if (!gameType.isCustomizable)
        team.set = gameType.getDefaultSet();
      else if (team.set === undefined || Array.isArray(team.set))
        continue;
      else if (typeof team.set === 'object')
        team.set = await dataAdapter.getPlayerSet(team.playerId, gameType.id, team.set.name);
      else if (team.set === 'same')
        opponentSetTeams.push(team);
      else if (team.set === 'mirror')
        opponentSetTeams.push(team);
      else
        throw new ServerError(400, 'Unrecognized set choice');
    }

    if (opponentSetTeams.length) {
      if (teams.length !== 2)
        throw new ServerError(400, `The 'same' and 'mirror' set options are only available for 2-player games`);

      let opponentSet = teams.find(t => t && t.set && typeof t.set !== 'string').set;
      for (let team of opponentSetTeams) {
        if (team.set === 'same')
          team.set = opponentSet;
        else if (team.set === 'mirror') {
          if (gameType.hasFixedPositions)
            throw new ServerError(403, 'May not use a mirror set with this game type');

          team.set = opponentSet.map(u => {
            let unit = {...u};
            unit.assignment = [...unit.assignment];
            unit.assignment[0] = 10 - unit.assignment[0];
            return unit;
          });
        }
      }
    }
  }
  async _joinGame(game, team, slot) {
    game.state.join(team, slot);

    /*
     * If no open slots remain, start the game.
     */
    if (game.state.teams.findIndex(t => !t || !t.set) === -1) {
      let teams = game.state.teams;
      let players = new Map();

      teams.forEach(team => {
        let playerId = team.playerId;
        if (!playerId || players.has(playerId))
          return;

        players.set(playerId, team.name);
      });

      if (players.size > 1)
        await chatService.createRoom(
          [...players].map(([id, name]) => ({ id, name })),
          { id:game.id }
        );

      // Now that the chat room is created, start the game.
      game.state.start();
    }
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

  async _notifyYourTurn(game, teamId) {
    let teams = game.state.teams;
    let playerId = teams[teamId].playerId;

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

  _validateTeamName(name) {
    if (!name)
      throw new ServerError(422, 'Player name is required');
    if (name.length > 20)
      throw new ServerError(403, 'Player name length limit is 20 characters');

    let width = getTextWidth(name, { font: 'Arial', size: 12 });
    if (width > 110)
      throw new ServerError(403, 'Player name visual length is too long');

    if (!rUnicodeLimit.test(name))
      throw new ServerError(403, 'Name contains forbidden characters');
    if (name.startsWith(' '))
      throw new ServerError(403, 'Name may not start with a space');
    if (name.endsWith(' '))
      throw new ServerError(403, 'Name may not end with a space');
    if (name.includes('  '))
      throw new ServerError(403, 'Name may not contain consecutive spaces');
    if (name.includes('#'))
      throw new ServerError(403, 'The # symbol is reserved');
    if (/<[a-z].*?>|<\//i.test(name) || /&[#a-z0-9]+;/i.test(name))
      throw new ServerError(403, 'The name may not contain markup');
  }
}

// This class is a singleton
export default new GameService();
