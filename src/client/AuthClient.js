import config from 'config/client.js';
import EventEmitter from 'events';

export default class AuthClient {
  constructor(server) {
    Object.assign(this, {
      name: 'auth',
      token: null,
      _identity: null,
      _server: server,

      _emitter: new EventEmitter(),
    });

    let token = this.getToken();
    if (token)
      this._identity = this._getIdentity(token);
  }

  get userId() {
    return this._identity && this._identity.id;
  }
  get userName() {
    return this._identity && this._identity.name;
  }

  on() {
    this._emitter.addListener(...arguments);
  }
  off() {
    this._emitter.removeListener(...arguments);
  }

  /*
   * The business logic in this method is specific to the MVP server release.
   * Creating an account should ultimately be an intentional user decision.
   */
  setAccountName(newName) {
    let server = this.server;
    let token = this.getToken();

    if (token)
      return this.refreshToken()
        .catch(error => {
          if (error.code === 404) {
            this.clearToken();
            return this.setAccountName(newName);
          }

          throw error;
        })
        .then(() => this.authorize())
        .then(() => this.saveProfile({ name:newName }));

    return this.register({ name:newName });
  }

  register(profile) {
    return this._server.request(this.name, 'register', [profile])
      .then(token => this.setToken(token));
  }

  refreshToken() {
    let token = this.getToken();

    return this._server.request(this.name, 'refreshToken', [token])
      .then(token => this.setToken(token));
  }
  refreshTokenIfPresent() {
    let token = this.getToken();
    if (!token) return Promise.resolve(null);

    return this.refreshToken();
  }

  authorize() {
    let token = this.getToken();

    return this._server.authorize(this.name, { token });
  }

  saveProfile(profile) {
    return this._server.request(this.name, 'saveProfile', [profile])
      .then(token => this.setToken(token));
  }

  setToken(token) {
    localStorage.setItem('token', this.token = token);
    this._identity = this._getIdentity(token);

    this._emit({ type:'token', token });
    return token;
  }
  getToken() {
    return this.token = localStorage.getItem('token');
  }
  clearToken() {
    localStorage.removeItem('token');
    this.token = null;
  }

  _getIdentity(token) {
    // Unpack the payload in the JWT.
    let claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));

    return {
      id: claims.sub,
      name: claims.name,
    };
  }
  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
