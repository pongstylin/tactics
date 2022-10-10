import Client from 'client/Client.js';
import { AccessToken } from 'client/Token.js';

const LOCAL_ENDPOINT = '/local.json';

export default class AuthClient extends Client {
  constructor(server) {
    super('auth', server);

    Object.assign(this, {
      token: this._fetchToken(),

      // The client is ready once the token, if any, is refreshed.
      whenReady: new Promise(),

      _refreshTimeout: null,
    });

    this.on('close', this._onClose.bind(this));

    /*
     * This event gets fired when a token is stored by another window/tab.  This
     * allows this tab to fetch and use the most recent token.  Warning: the
     * 'event.newValue' property does not always contain the most recent token.
     * Always obtain the token from storage.
     */
    window.addEventListener('storage', event => {
      if (event.key !== 'token') return;

      // Ignore token change events while we are still refreshing the token.
      if (this.whenReady.isResolved)
        this._setToken();
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
      .catch(error => {
        if (error === 'Connection reset')
          return this.getIdentityToken();
        throw error;
      });
  }
  createIdentityToken() {
    return this._server.requestAuthorized(this.name, 'createIdentityToken');
  }
  revokeIdentityToken() {
    return this._server.requestAuthorized(this.name, 'revokeIdentityToken');
  }

  async openAuthProvider(provider) {
    location.href = await this.makeAuthProviderURL({
      provider,
      redirectURL: location.href,
    });
  }
  makeAuthProviderURL(state) {
    return this._server.request(this.name, 'makeAuthProviderURL', [ state ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.makeAuthProviderURL(state);
        throw error;
      });
  }
  linkAuthProvider(link) {
    return this._server.request(this.name, 'linkAuthProvider', [ link ])
      .then(token => token && this._setToken(token))
      .then(() => true)
      .catch(error => {
        if (error.code === 401)
          return false;
        throw error;
      });
  }
  unlinkAuthProviders() {
    return this._server.requestAuthorized(this.name, 'unlinkAuthProviders')
      .catch(error => {
        if (error === 'Connection reset')
          return this.unlinkAuthProviders();
        throw error;
      });
  }
  hasAuthProviderLinks() {
    return this._server.requestAuthorized(this.name, 'hasAuthProviderLinks')
      .catch(error => {
        if (error === 'Connection reset')
          return this.hasAuthProviderLinks();
        throw error;
      });
  }
  getDevices() {
    return this._server.requestAuthorized(this.name, 'getDevices');
  }
  addDevice(identityToken) {
    let promise;
    if (this.token)
      promise = this.removeDevice(this.deviceId);
    else
      promise = Promise.resolve();

    return promise.then(() =>
      this._server.request(this.name, 'addDevice', [ identityToken ])
        .then(token => this._setToken(token))
    );
  }
  setDeviceName(deviceId, deviceName) {
    return this._server.requestAuthorized(this.name, 'setDeviceName', [ deviceId, deviceName ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.setDeviceName(playerId, playerName);
        throw error;
      });
  }
  removeDevice(deviceId) {
    return this._server.requestAuthorized(this.name, 'removeDevice', [ deviceId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.removeDevice(deviceId);
        throw error;
      });
  }
  logout() {
    return this._server.request(this.name, 'logout')
      .catch(error => {
        // A connection reset is expected as a result of logging out
        if (error === 'Connection reset')
          return;
        throw error;
      })
      .then(() => this._purgeToken())
      .then(() => this._purgeCachedToken());
  }

  isAccountAtRisk() {
    return this._server.requestAuthorized(this.name, 'isAccountAtRisk')
      .catch(error => {
        if (error === 'Connection reset')
          return this.isAccountAtRisk();
        throw error;
      });
  }

  getACL() {
    return this._server.requestAuthorized(this.name, 'getACL')
      .catch(error => {
        if (error === 'Connection reset')
          return this.getACL();
        throw error;
      });
  }
  getPlayerACL(playerId) {
    return this._server.requestAuthorized(this.name, 'getPlayerACL', [ playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerACL(playerId);
        throw error;
      });
  }
  setPlayerACL(playerId, playerACL) {
    return this._server.requestAuthorized(this.name, 'setPlayerACL', [ playerId, playerACL ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.setPlayerACL(playerId, playerACL);
        throw error;
      });
  }
  clearPlayerACL(playerId) {
    return this._server.requestAuthorized(this.name, 'clearPlayerACL', [ playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.clearPlayerACL(playerId);
        throw error;
      });
  }

  async _onOpen({ data }) {
    // In older versions of iOS, the localStorage data is not shared between PWA
    // and in-browser contexts, but the Cache API in a service worker IS shared.
    // So, tokens are cached and, if the cached token is newer than one found in
    // local storage, then it is restored.
    if (!this.whenReady.isResolved) {
      const token = await this._restoreToken();
      if (token)
        await this._refreshToken();
    } else {
      // Since a connection can only be resumed for 30 seconds after disconnect
      // and a token is refreshed 1 minute before it expires, a token refresh
      // should not be immediately necessary after resuming a connection.
      if (this.isAuthorized && data.reason === 'resume')
        this._setRefreshTimeout();
      else
        await this._refreshToken();
    }

    if (data.reason === 'new') {
      /*
       * Auth callbacks may pass a link to the page.
       */
      const params = new URLSearchParams(location.search.slice(1));
      const authLink = params.get('link');
      if (authLink) {
        history.replaceState(null, '', location.origin + location.pathname);

        await this.linkAuthProvider(authLink);
      }

      this.whenReady.resolve();
    }
  }
  _onClose() {
    this._clearRefreshTimeout();
  }

  async _restoreToken() {
    const cachedToken = await this._fetchCachedToken();
    let token = this._fetchToken();

    if (cachedToken) {
      if (!token)
        this._storeToken(token = cachedToken);
      else if (token.createdAt < cachedToken.createdAt)
        this._storeToken(token = cachedToken);
    }

    return token;
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
        // If the device was deleted or if the account doesn't exist anymore,
        // pretend as if we were never authenticated in the first place.
        if (error.code === 401 || error.code === 404)
          return this._unsetToken();

        if (error !== 'Connection reset')
          throw error;
      });
  }
  _fetchToken() {
    const tokenValue = localStorage.getItem('token');

    return tokenValue ? new AccessToken(tokenValue) : null;
  }
  _storeToken(token) {
    localStorage.setItem('token', token.value);
  }
  _purgeToken() {
    localStorage.removeItem('token');
  }
  async _fetchCachedToken() {
    // The local endpoint is handled by the service worker.
    let sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return null;

    let response = await fetch(LOCAL_ENDPOINT);
    // Log evidence described a user visiting the site and registering service
    // worker for the first time.  Somehow, the above 'controller' check passed,
    // but the fetch to the local endpoint was not handled by the controller.
    // The request either bypassed or passed through the service worker and was
    // received by the server, which returned a 404 error.  An error was thrown
    // by 'response.json' since the response was not in JSON format.  The root
    // cause escapes me, but the next line handles this condition.
    if (!response.ok) return null;

    let json = await response.json();

    return json.token ? new AccessToken(json.token) : null;
  }
  async _storeCachedToken(token) {
    // The local endpoint is handled by the service worker.
    let sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return;

    return fetch(LOCAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
  }
  async _purgeCachedToken() {
    // The local endpoint is handled by the service worker.
    let sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return;

    return fetch(LOCAL_ENDPOINT, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  async _setToken(token) {
    const storedToken = this._fetchToken();

    if (!token) {
      if (!storedToken)
        return this.token = null;

      token = storedToken;
    } else {
      if (typeof token === 'string')
        token = new AccessToken(token);

      if (!token.equals(storedToken)) {
        this._storeToken(token);
        await this._storeCachedToken(token);
      }
    }

    if (!this.isAuthorized || !token.equals(this.token)) {
      this.token = token;
      this._setRefreshTimeout();
      this._authorize(token);
      this._emit({ type:'token', data:token });
    }
  }
  async _unsetToken() {
    this.token = null;

    await fetch(LOCAL_ENDPOINT, {
      method: 'DELETE',
    });

    localStorage.removeItem('token');
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
