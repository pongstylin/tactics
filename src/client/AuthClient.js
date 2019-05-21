import config from 'config/client.js';
import EventEmitter from 'events';

export default class AuthClient {
  constructor(server) {
    Object.assign(this, {
      name: 'auth',
      token: null,
      whenReady: new Promise(resolve => this._nowReady = resolve),
      whenAuthorized: new Promise(resolve => this._nowAuthorized = resolve),

      _identity: null,
      _refreshTimeout: null,
      _server: server,

      _emitter: new EventEmitter(),
    });

    let token = this._getToken();
    if (token)
      this._refreshToken(token).then(this._nowReady);
    else
      this._nowReady();

    /*
     * When a token is stored by another window/tab, this event gets fired.
     * Handle the new token as if it was obtained locally
     */
    window.addEventListener('storage', event => {
      if (event.key !== 'token') return;
      let token = event.newValue;

      if (token)
        this._setToken(token);
      else
        this.token = null;
    });

    this.whenReady.then(() =>
      server
        .on('open', event => this._authorize())
        .on('reset', event => {
          this.whenAuthorized = new Promise(resolve => this._nowAuthorized = resolve);

          this._refreshToken();
        })
    );
  }

  get userId() {
    return this._identity && this._identity.id;
  }
  get userName() {
    return this._identity && this._identity.name;
  }
  get tokenCreatedAt() {
    return this._identity && this._identity.createdAt;
  }
  get tokenExpiresAt() {
    return this._identity && this._identity.expiresAt;
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
    return this.whenReady.then(() => {
      let token = this.token;
      if (token)
        return this.saveProfile({ name:newName });

      return this.register({ name:newName });
    });
  }

  register(profile) {
    return this._server.request(this.name, 'register', [profile])
      .then(token => this._storeToken(token));
  }

  saveProfile(profile) {
    return this._server.request(this.name, 'saveProfile', [profile])
      .then(token => this._storeToken(token));
  }

  _refreshToken(token = this.token) {
    return this._server.request(this.name, 'refreshToken', [token])
      .then(token => this._storeToken(token))
      .catch(error => {
        // This usually means we lost a race with another window/tab refreshing
        // a token at the same time.  So, wait for a storage event to inform us
        // of the new token, if we haven't received one already.
        if (error.message === 'Token revoked') return;

        localStorage.removeItem('token');
        this.token = null;
        throw error;
      });
  }
  _getToken() {
    return this.token = localStorage.getItem('token');
  }
  _storeToken(token) {
    localStorage.setItem('token', token);
    this._setToken(token);
  }
  _setToken(token) {
    // Decode the Base64 encoded payload in the JWT.
    let payload = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    // Convert UTF-8 sequences to characters.
    payload = decodeURIComponent(
      payload.split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    let claims = JSON.parse(payload);

    this.token = token;
    this._identity = {
      id: claims.sub,
      name: claims.name,
      createdAt: new Date(claims.iat * 1000),
      expiresAt: new Date(claims.exp * 1000),
    };

    // The absolute date the token expires
    let expiresAt = this.tokenExpiresAt;
    // Remaining time before expiration minus a 1m safety buffer (in ms)
    let timeout = Math.max(0, expiresAt - new Date() - 60000);

    clearTimeout(this._refreshTimeout);
    this._refreshTimeout = setTimeout(() => this._refreshToken(), timeout);

    this._authorize();
    this._emit({ type:'token', data:token });
  }
  _authorize() {
    let token = this.token;
    if (!token) return;

    /*
     * Even if a connection to the server is not currently open, authorization
     * will be sent upon a connection being opened.  At that point, the returned
     * promise will be resolved.
     */
    let server = this._server;
    if (server.isOpen())
      return server.authorize(this.name, { token })
        .then(() => this._nowAuthorized());

    return this.whenAuthorized;
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
}
