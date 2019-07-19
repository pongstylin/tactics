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
  get deviceId() {
    return this.token && this.token.deviceId;
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

  getIdentityToken() {
    return this._server.requestAuthorized(this.name, 'getIdentityToken')
      .then(token => token ? new Token(token) : null);
  }
  createIdentityToken() {
    return this._server.requestAuthorized(this.name, 'createIdentityToken')
      .then(token => new Token(token));
  }
  revokeIdentityToken() {
    return this._server.requestAuthorized(this.name, 'revokeIdentityToken');
  }

  getDevices() {
    return this._server.requestAuthorized(this.name, 'getDevices')
      .then(devices => {
        devices.forEach(device => {
          device.agents.forEach(agent => {
            agent.addresses.forEach(address => {
              address.lastSeenAt = new Date(address.lastSeenAt);
            });
          });
        });

        return devices;
      });
  }
  addDevice(identityToken) {
    let promise;
    if (this.token)
      promise = this.removeDevice(this.deviceId);
    else
      promise = Promise.resolve();

    return promise.then(() =>
      this._server.request(this.name, 'addDevice', [identityToken])
        .then(token => this._storeToken(token))
    );
  }
  setDeviceName(deviceId, deviceName) {
    return this._server.requestAuthorized(this.name, 'setDeviceName', [deviceId, deviceName]);
  }
  removeDevice(deviceId) {
    return this._server.requestAuthorized(this.name, 'removeDevice', [deviceId]);
  }

  _onOpen({ data }) {
    if (this.token) {
      // Since a connection can only be resumed for 30 seconds after disconnect
      // and a token is refreshed 1 minute before it expires, a token refresh
      // should not be immediately necessary after resuming a connection.
      if (data.reason === 'resume')
        this._setRefreshTimeout();
      else
        this._refreshToken().then(this._resolveReady);
    }
    else
      this._resolveReady();
  }
  _onClose() {
    this._clearRefreshTimeout();
  }

  _refreshToken() {
    // No point in queueing a token refresh if the session is not open.
    // A new attempt to refresh will be made once it is open.
    if (!this._server.isOpen)
      return this.whenAuthorized;

    // Make sure to use the most recently stored token.
    let token = this._getToken();
    if (!token) return;

    return this._server.request(this.name, 'refreshToken', [token])
      .then(token => this._storeToken(token))
      .catch(error => {
        // Ignore 'Revoked token' errors in the assumption that another tab
        // is about to inform this one that a new token is available.
        if (error.code === 409) return;

        // If the device was deleted or if the account doesn't exist anymore,
        // pretend as if we were never authenticated in the first place.
        if (error.code === 401 || error.code === 404) {
          localStorage.removeItem('token');
          this.token = null;
          return;
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
    if (!oldToken || newToken.createdAt > oldToken.createdAt)
      localStorage.setItem('token', tokenValue);
    else
      newToken = oldToken;

    this._setToken(newToken);
  }
  _setToken(token) {
    this.token = token;

    this._setRefreshTimeout();
    this._authorize(token);
    this._emit({ type:'token', data:token });
  }
  _setRefreshTimeout() {
    this._clearRefreshTimeout();

    let token = this.token;
    // Being defensive.  Not expected to happen.
    if (!token) return;

    // Remaining time before expiration minus a 1m safety buffer (in ms)
    let timeout = Math.max(0, token.expiresIn - 60000);

    this._refreshTimeout = setTimeout(() => this._refreshToken(), timeout);
  }
  _clearRefreshTimeout() {
    clearTimeout(this._refreshTimeout);
  }
}
