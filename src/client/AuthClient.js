import config from 'config/client.js';
import Client from 'client/Client.js';
import Token from 'client/Token.js';

const LOCAL_ENDPOINT = '/local.json';

export default class AuthClient extends Client {
  constructor(server) {
    super('auth', server);

    Object.assign(this, {
      token: this._fetchToken(),

      // The client is ready once the token, if any, is refreshed.
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

      if (tokenValue)
        this._setToken(tokenValue);
      else
        this.token = null;
    });

    // If the server connection is already open, fire the open event.
    // The open event is typically used to send authorization.
    if (server.isOpen)
      this._emit({ type:'open', data:{ reason:'new' }});
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
      .then(token => this._setToken(token));
  }

  saveProfile(profile) {
    return this._server.requestAuthorized(this.name, 'saveProfile', [profile])
      .then(token => this._setToken(token));
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
        .then(token => this._setToken(token))
    );
  }
  setDeviceName(deviceId, deviceName) {
    return this._server.requestAuthorized(this.name, 'setDeviceName', [deviceId, deviceName]);
  }
  removeDevice(deviceId) {
    return this._server.requestAuthorized(this.name, 'removeDevice', [deviceId]);
  }

  async _onOpen({ data }) {
    // On iOS (iPhone, iPad), the localStorage data is not shared between Safari
    // and a PWA added to the home screen.  However, the Cache API in a service
    // worker IS shared.  When opening a new connection, e.g. opening a page in
    // Safari or opening the PWA, restore the token from cache to make sure both
    // contexts use the same account and always have the most recent token.
    await this._restoreToken();

    if (this.token) {
      // Since a connection can only be resumed for 30 seconds after disconnect
      // and a token is refreshed 1 minute before it expires, a token refresh
      // should not be immediately necessary after resuming a connection.
      if (data.reason === 'resume')
        this._setRefreshTimeout();
      else
        await this._refreshToken();
    }

    if (data.reason === 'new')
      this._resolveReady();
  }
  _onClose() {
    this._clearRefreshTimeout();
  }

  async _restoreToken() {
    let token = await this._fetchCachedToken();

    if (token) {
      if (!this.token)
        this._storeToken(this.token = token);
      else if (this.token.playerId !== token.playerId)
        this._storeToken(this.token = token);
      else if (this.token.createdAt < token.createdAt)
        this._storeToken(this.token = token);
    }
  }
  async _refreshToken() {
    // No point in queueing a token refresh if the session is not open.
    // A new attempt to refresh will be made once it is open.
    if (!this._server.isOpen)
      return this.whenAuthorized;

    // Make sure to use the most recently stored token.
    let token = this._fetchToken();
    if (!token) return;

    return this._server.request(this.name, 'refreshToken', [token])
      .then(token => this._setToken(token))
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
  _fetchToken() {
    let tokenValue = localStorage.getItem('token');

    return tokenValue ? new Token(tokenValue) : null;
  }
  _storeToken(token) {
    localStorage.setItem('token', token.value);
  }
  async _fetchCachedToken() {
    // The local endpoint is handled by the service worker.
    let sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return null;

    let response = await fetch(LOCAL_ENDPOINT);
    let json = await response.json();

    return json.token ? new Token(json.token) : null;
  }
  async _storeCachedToken(token) {
    // The local endpoint is handled by the service worker.
    let sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return;

    return await fetch(LOCAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
  }
  _setToken(tokenValue) {
    let token = new Token(tokenValue);
    let storedToken = this._fetchToken();
    let myToken = this.token;

    // Ignore the provided token if it is older than the stored token.
    if (storedToken && storedToken.createdAt > token.createdAt)
      token = storedToken;
    // Ignore the provided token if it is older than my token.
    if (myToken && myToken.createdAt > token.createdAt)
      token = myToken;
    // Store the newest token if it is newer than the stored token.
    if (!storedToken || storedToken.createdAt < token.createdAt) {
      this._storeToken(token);
      this._storeCachedToken(token);
    }

    if (this.isAuthorized && token.equals(myToken))
      return;

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
