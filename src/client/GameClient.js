import config from 'config/client.js';

export default class GameClient {
  constructor(server) {
    Object.assign(this, {
      name: 'game',
      _server: server,
    });
  }

  authorize(token) {
    return this._server.authorize(this.name, { token });
  }

  createGame(stateData) {
    return this._server.request(this.name, 'createGame', [stateData]);
  }

  joinGame(gameId, options) {
    return this._server.request(this.name, 'joinGame', [gameId, options]);
  }
}
