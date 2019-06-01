import config from 'config/client.js';
import EventEmitter from 'events';

export default class GameClient {
  constructor(server) {
    Object.assign(this, {
      name: 'game',
      whenAuthorized: new Promise(resolve => this._nowAuthorized = resolve),

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
      .on('exit',  this._listener)
      .on('open', event => this._emit(event))
      .on('reset', event => {
        // Filter lost messages to game events.
        let emitEvent = {
          type: 'reset',
          data: event.data.filter(message => {
            if (message.type !== 'event') return;
            if (message.body.service !== 'game') return;
            return true;
          }),
        };

        this.whenAuthorized = new Promise(resolve => this._nowAuthorized = resolve)
          .then(() => this._emit(emitEvent));
      })
      .on('close', event => this._emit(event));
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
    return this._server.authorize(this.name, { token })
      .then(this._nowAuthorized);
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
  getPlayerStatus(gameId) {
    return this._server.request(this.name, 'getPlayerStatus', [gameId]);
  }

  watchGame(gameId, resume) {
    return this._server.join(this.name, `/games/${gameId}`, resume);
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
