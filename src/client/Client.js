import config from 'config/client.js';
import EventEmitter from 'events';

export default class GameClient {
  constructor(serviceName, server) {
    Object.assign(this, {
      name: serviceName,

      _server: server,

      _emitter: new EventEmitter(),
    });

    this.on('open', this._onOpen.bind(this));

    server
      .on('open',  event => this._emit(event))
      .on('close', event => this._emit(event));

    // If the server connection is already open, fire the open event.
    // The open event is typically used to send authorization.
    if (server.isOpen)
      this._emit({ type:'open', data:{ reason:'new' }});
  }

  get whenAuthorized() {
    return this._server.whenAuthorized(this.name);
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  _onOpen(event) {
    // stub
  }

  _authorize(token) {
    let server = this._server;
    if (server.isOpen)
      return server.authorize(this.name, { token });

    // Even if a connection to the server is not currently open, authorization
    // will be sent upon a connection being opened.  At that point, the returned
    // promise will be resolved.
    return this.whenAuthorized;
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
