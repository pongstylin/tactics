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
  will(client, eventName) {
    let session = this.sessions.get(client.id);
    if (!session)
      throw new ServerError(401, 'Authorization is required');
    if (session.expires < (new Date() / 1000))
      throw new ServerError(401, 'Token is expired');
  }

  dropClient(client) {
    let session = this.sessions.get(client.id);
    if (session) {
      this.gameWatches.forEach(gameWatch =>
        this.onUnwatchGameEvent(client, gameWatch.game)
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

  onGetGameEvent(client, gameId) {
    return this._getGame(gameId);
  }

  /*
   * Start sending change events to the client about this game.
   */
  onWatchGameEvent(client, gameId) {
    let session = this.sessions.get(client.id);
    let game = this._getGame(gameId);

    // Ignore an attempt to watch an ended game.
    if (game.ended) return game;

    let groupName = 'game-' + gameId;

    // Already watching?
    if (this.isClientInGroup(groupName, client))
      return game;
    this.addClientToGroup(groupName, client);

    if (this.gameWatches.has(gameId))
      this.gameWatches.get(gameId).clients++;
    else {
      let listener = event => {
        this.sendToGroup(groupName, {
          type: event.type,
          data: { gameId:gameId, event },
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

    return game;
  }

  /*
   * No longer send change events to the client about this game.
   */
  onUnwatchGameEvent(client, gameId) {
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

  onJoinGameRequest(client, gameId, {set, slot}) {
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

  /*
   * Taking an action in a game automatically watches it.
   */
  onActionEvent(client, gameId, action) {
    let game = this.onWatchGameEvent(client, gameId);
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
