import emitter from 'utils/emitter.js';

export default class Client {
  constructor(serviceName, server) {
    Object.assign(this, {
      name: serviceName,

      _server: server,
    });

    this.on('open', this._onOpen.bind(this));

    server
      .on('open',  event => this._emit(event))
      .on('close', event => this._emit(event));
  }

  get serverNow() {
    return this._server.now;
  }
  get isOnline() {
    return this._server.isOpen;
  }

  get whenAuthorized() {
    return this._server.whenAuthorized(this.name);
  }
  get isAuthorized() {
    return this.whenAuthorized.isResolved;
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
};

emitter(Client);
