import config from 'config/client.js';
import Client from 'client/Client.js';
import Token from 'client/Token.js';

export default class AuthClient extends Client {
  constructor(server) {
    super('auth', server);

    Object.assign(this, {
      token: this._getToken(),

      // The client is ready once a current token, if any, is obtained.
      whenReady: new Promise(resolve => this._resolveReady = resolve),

      _refreshTimeout: null,
    });

    this.on('close', this._onClose.bind(this));

    /*
     * When a token is stored by another window/tab, this event gets fired.
     * Handle a newer token as if it was obtained locally.
     */
    window.addEventListener('storage', event => {
      if (event.key !== 'token') return;
      let tokenValue = event.newValue;

      if (tokenValue) {
        let token = new Token(tokenValue);

        if (this.token) {
          // Shouldn't happen, but shouldn't do anything either.
          if (token.equals(this.token))
            return;

          // Replace an older token with a newer one.
          if (token.createdAt < this.token.createdAt)
            return this._storeToken(token.value);
        }

        this._setToken(token);
      }
      else
        this.token = null;
    });
  }

  get playerId() {
    return this.token && this.token.playerId;
  }
  get playerName() {
    return this.token && this.token.playerName;
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
    return this._server.requestAuthorized(this.name, 'saveProfile', [profile])
      .then(token => this._storeToken(token));
  }

  _onOpen() {
    if (this.token)
      this._refreshToken().then(this._resolveReady);
    else
      this._resolveReady();
  }
  _onClose() {
    clearTimeout(this._refreshTimeout);
  }

  _refreshToken(token = this.token) {
    // No point in queueing a token refresh if the session is not open.
    // A new attempt to refresh will be made once it is open.
    if (!this._server.isOpen)
      return this.whenAuthorized;

    return this._server.request(this.name, 'refreshToken', [token])
      .then(token => this._storeToken(token))
      .catch(error => {
        if (error.code === 401 || error.code === 404) {
          localStorage.removeItem('token');
          this.token = null;
        }

        throw error;
      });
  }
  _getToken() {
    let tokenValue = localStorage.getItem('token');

    return tokenValue ? new Token(tokenValue) : null;
  }
  _storeToken(tokenValue) {
    let oldToken = this._getToken();
    let newToken = new Token(tokenValue);

    // Guard against overwriting newer tokens with older tokens.
    // A race condition can still occur between reading and writing, but any
    // difference in created timestamps should be immaterial since the server
    // offers a 5 second forgiveness differential.
    if (newToken.createdAt > oldToken.createdAt)
      localStorage.setItem('token', tokenValue);
    else
      newToken = oldToken;

    this._setToken(newToken);
  }
  _setToken(token) {
    this.token = token;

    // Remaining time before expiration minus a 1m safety buffer (in ms)
    let timeout = Math.max(0, token.expiresIn - 60000);

    clearTimeout(this._refreshTimeout);
    this._refreshTimeout = setTimeout(() => this._refreshToken(), timeout);

    this._authorize(token);
    this._emit({ type:'token', data:token });
  }
}
