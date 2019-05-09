import config from 'config/client.js';
import EventEmitter from 'events';

export default class GameClient {
  constructor(server) {
    Object.assign(this, {
      name: 'game',
      _server: server,

      _emitter: new EventEmitter(),
      _listener: event => {
        if (event.body.service !== this.name) return;

        this._emit(event);
      },
    });

    server
      .on('event', this._listener)
      .on('join',  this._listener)
      .on('leave', this._listener)
      .on('enter', this._listener)
      .on('exit',  this._listener);
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  authorize(token) {
    return this._server.authorize(this.name, { token });
  }

  createGame(stateData) {
    return this._server.request(this.name, 'createGame', [stateData]);
  }

  joinGame(gameId, options) {
    let args = [gameId];
    if (options) args.push(options);

    return this._server.request(this.name, 'joinGame', args);
  }

  getGameData(gameId) {
    return this._server.request(this.name, 'getGame', [gameId]);
  }

  watchGame(gameId) {
    return this._server.join(this.name, `/games/${gameId}`);
  }
  getTurnData() {
    return this._server.request(this.name, 'getTurnData', [...arguments]);
  }
  getTurnActions() {
    return this._server.request(this.name, 'getTurnActions', [...arguments]);
  }
  undo() {
    return this._server.request(this.name, 'undo', [...arguments]);
  }
  restart() {
    return this._server.request(this.name, 'restart', [...arguments]);
  }

  postAction(gameId, action) {
    this._server.send(this.name, `/games/${gameId}`, 'action', action);
  }
  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
