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

      // Session data for each client.
      sessions: new Map(),

      // Game watch data by game ID.
      gameWatches: new Map(),
    });
  }

  /*
   * Test if the service will handle the eventName from client
   */
  will(client, messageType, bodyType) {
    // No authorization required
    if (bodyType === 'getGame') return true;

    // Authorization required
    let session = this.sessions.get(client.id);
    if (!session)
      throw new ServerError(401, 'Authorization is required');
    if (session.expires < (new Date() / 1000))
      throw new ServerError(401, 'Token is expired');
  }

  dropClient(client) {
    let session = this.sessions.get(client.id);
    if (session) {
      this.gameWatches.forEach((gameWatch, gameId) =>
        this.onLeaveGameGroup(client, `/games/${gameId}`, gameId)
      );

      this.sessions.delete(client.id);
    }

    super.dropClient(client);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    if (!token)
      throw new ServerError(422, 'Required authorization token');

    let session = this.sessions.get(client.id) || {};
    let claims = jwt.verify(token, config.publicKey);

    session.playerId = claims.sub;
    session.deviceId = claims.deviceId;
    session.name = claims.name;
    session.expires = claims.exp;
    this.sessions.set(client.id, session);
  }

  /*
   * Create a new game and save it to persistent storage.
   */
  onCreateGameRequest(client, stateData) {
    let session = this.sessions.get(client.id);
    this.throttle(session.deviceId, 'createGame');

    let game = dataAdapter.createGame(stateData);
    return game.id;
  }

  onGetGameRequest(client, gameId) {
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
      this.onJoinGameGroup(client, groupPath, match[1]);
    else
      throw new ServerError(404, 'No such group');
  }

  onJoinGameGroup(client, groupPath, gameId) {
    let session = this.sessions.get(client.id);
    let game = this._getGame(gameId);

    // Can't watch ended games.
    if (game.ended)
      throw new ServerError(409, 'The game has ended');

    if (this.gameWatches.has(gameId))
      this.gameWatches.get(gameId).clients++;
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

        if (event.type === 'joined' || event.type === 'action')
          dataAdapter.saveGame(game);
      };

      game.state
        .on('joined', listener)
        .on('startGame', listener)
        .on('startTurn', listener)
        .on('action', listener)
        .on('reset', listener)
        .on('endGame', listener);

      this.gameWatches.set(gameId, {
        game:     game,
        clients:  1,
        listener: listener,
      });
    }

    this._emit({
      type:   'join',
      client: client.id,
      body: {
        group: groupPath,
        user: {
          id:   session.playerId,
          name: session.name,
        },
      },
    });
  }

  /*
   * No longer send change events to the client about this game.
   */
  onLeaveGameGroup(client, groupPath, gameId) {
    let session = this.sessions.get(client.id);
    let game = gameId instanceof Game ? gameId : this._getGame(gameId);
    let groupName = 'game-' + game.id;

    // Already not watching?
    if (!this.isClientInGroup(groupName, client))
      return game;
    this.dropClientFromGroup(groupName, client);

    let gameWatch = this.gameWatches.get(game.id);
    if (gameWatch.clients > 1)
      gameWatch.clients--;
    else {
      // TODO: Don't shut down the game state until all bots have made their turns.
      let listener = gameWatch.listener;

      game.state
        .off('joined', listener)
        .off('startGame', listener)
        .off('startTurn', listener)
        .off('action', listener)
        .off('reset', listener)
        .off('endGame', listener);

      this.gameWatches.delete(game.id);
    }

    return true;
  }

  onJoinGameRequest(client, gameId, {set, slot} = {}) {
    let session = this.sessions.get(client.id);
    let game = this._getGame(gameId);

    let team = {
      playerId: session.playerId,
      name: session.name,
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
  onUndoRequest(client, gameId, ...args) {
    return this._getGame(gameId).state.undo(...args);
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
    let session = this.sessions.get(client.id);
    let gameId = groupPath.replace(/^\/games\//, '');
    let game = this._getGame(gameId);

    if (!Array.isArray(action))
      action = [action];

    let myTeams = game.state.teams.filter(t => t.playerId === session.playerId);
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

  /*******************************************************************************
   * Helpers
   ******************************************************************************/
  _getGame(gameId) {
    let game;
    if (this.gameWatches.has(gameId))
      game = this.gameWatches.get(gameId).game;
    else
      game = dataAdapter.getGame(gameId);

    return game;
  }
}

// This class is a singleton
export default new GameService();
