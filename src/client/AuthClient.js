import Client from 'client/Client.js';
import Auth from 'components/Modal/Auth.js';
import config from 'config/client.js';
import { CLOSE_CLIENT_LOGOUT } from 'client/ServerSocket.js';
import { AccessToken } from 'client/Token.js';

const LOCAL_ENDPOINT = '/local.json';
let auth = null;

const reUUIDv4 = new RegExp(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export default class AuthClient extends Client {
  constructor(server) {
    super('auth', server);

    Object.assign(this, {
      token: this._fetchLocalToken(),
      sharedToken: this._fetchSharedToken(),
      authIsRequired: false,
      isLoggedIn: false,

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

      this._syncToken();
    });

    // If the server connection is already open, fire the open event.
    // The open event is typically used to send authorization.
    if (server.isOpen)
      this._emit({ type:'open', data:{ reason:'new' }});
  }

  get playerId() {
    return this.token && this.token.playerId;
  }
  get isVerified() {
    return this.token && this.token.isVerified;
  }
  get playerName() {
    return this.token && this.token.playerName;
  }
  get confirmPlayerName() {
    return this.token && this.token.confirmPlayerName;
  }
  get deviceId() {
    return this.token && this.token.deviceId;
  }
  get tokenIsShared() {
    if (this.token === null)
      return false;

    return this.token.equals(this.sharedToken);
  }

  /*
   * The business logic in this method is specific to the MVP server release.
   * Creating an account should ultimately be an intentional user decision.
   */
  async setAccountName(newName) {
    await this.whenReady;

    const token = this.token;
    if (token)
      return this.saveProfile({ name:newName });

    return this.register({ name:newName });
  }

  register(profile) {
    return this._server.request(this.name, 'register', [profile])
      .then(token => this._storeToken(token, true));
  }

  saveProfile(profile) {
    return this._server.requestAuthorized(this.name, 'saveProfile', [profile])
      .then(token => this._storeToken(token));
  }

  getIdentityToken() {
    return this._server.requestAuthorized(this.name, 'getIdentityToken')
      .catch(error => {
        if (error === 'Connection reset')
          return this.getIdentityToken();
        throw error;
      });
  }
  createIdentityToken(playerId = null) {
    return this._server.requestAuthorized(this.name, 'createIdentityToken', [ playerId ]);
  }
  revokeIdentityToken() {
    return this._server.requestAuthorized(this.name, 'revokeIdentityToken');
  }

  async openAuthProvider(provider) {
    location.href = await this.makeAuthProviderURL({
      provider,
      // Just in case we are logging into the same account as the shared token
      deviceId: this.sharedToken?.deviceId,
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
      .then(token => this._storeToken(token ?? this.token, true))
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
    const promise = this.token ? this.logout() : Promise.resolve();

    return promise.then(() =>
      this._server.request(this.name, 'addDevice', [ identityToken ])
        .then(token => this._storeToken(token, true))
        .catch(() => {
          if (error === 'Connection reset')
            return this.addDevice(identityToken);
          throw error;
        })
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
      });
  }

  // Admin actions
  toggleGlobalMute(playerId) {
    return this._server.requestAuthorized(this.name, 'toggleGlobalMute', [ playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.toggleGlobalMute(playerId);
        throw error;
      });
  }
  promoteToVerified(playerId = null) {
    return this._server.requestAuthorized(this.name, 'promoteToVerified', [ playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.promoteToVerified(playerId);
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
  setACL(acl) {
    return this._server.requestAuthorized(this.name, 'setACL', [ acl ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.setACL(acl);
        throw error;
      });
  }
  getActiveRelationships() {
    return this._server.requestAuthorized(this.name, 'getActiveRelationships')
      .catch(error => {
        if (error === 'Connection reset')
          return this.getActiveRelationships();
        throw error;
      });
  }
  getRelationship(playerId) {
    return this._server.requestAuthorized(this.name, 'getRelationship', [ playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getRelationship(playerId);
        throw error;
      });
  }
  setRelationship(playerId, relationship) {
    return this._server.requestAuthorized(this.name, 'setRelationship', [ playerId, relationship ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.setRelationship(playerId, relationship);
        throw error;
      });
  }
  clearRelationship(playerId) {
    return this._server.requestAuthorized(this.name, 'clearRelationship', [ playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.clearRelationship(playerId);
        throw error;
      });
  }

  queryRatedPlayers(query) {
    return this._server.requestAuthorized(this.name, 'queryRatedPlayers', [ query ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.queryRatedPlayers(query);
        throw error;
      });
  }
  async getRatedPlayer(playerId) {
    const players = await this.getRatedPlayers([ playerId ]);

    return players.get(playerId);
  }
  async getRatedPlayers(inPlayerIds) {
    const playerIds = inPlayerIds.filter(pId => reUUIDv4.test(pId));
    if (playerIds.length === 0)
      return new Map();

    return this._server.requestAuthorized(this.name, 'getRatedPlayers', [ playerIds ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getRatedPlayers(playerIds);
        throw error;
      });
  }

  getRankings() {
    return this._server.requestAuthorized(this.name, 'getRankings', [])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getRankings();
        throw error;
      });
  }
  getRanks(rankingId) {
    return this._server.requestAuthorized(this.name, 'getRanks', [ rankingId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getRanks(rankingId);
        throw error;
      });
  }
  getTopRanks(rankingId = null, playerId = this.playerId) {
    return this._server.requestAuthorized(this.name, 'getTopRanks', [ rankingId, playerId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getTopRanks(rankingId, playerId);
        throw error;
      });
  }
  getPlayerRanks(playerId, rankingId) {
    return this._server.requestAuthorized(this.name, 'getPlayerRanks', [ playerId, rankingId ])
      .catch(error => {
        if (error === 'Connection reset')
          return this.getPlayerRanks(playerId, rankingId);
        throw error;
      });
  }

  async _onOpen({ data }) {
    // If this is the first connection upon loading the page...
    if (!this.whenReady.isResolved) {
      /*
       * Auth callbacks may pass a link to the page.
       */
      const params = new URLSearchParams(location.search.slice(1));
      const authLink = params.get('link');

      if (authLink) {
        history.replaceState(null, '', location.origin + location.pathname);

        if (authLink === 'failed')
          this.requireAuth('Please try again.  Temporary authorization failure.');
        else if (await this.linkAuthProvider(authLink) === false)
          this.requireAuth('Please try again.  Authorization token expired.');
      } else if (this.token === null) {
        await this._restoreToken();
        await this._refreshToken();
      } else
        await this._refreshToken();

      this.whenReady.resolve();
    } else if (data.reason === 'resume') {
      // Since a connection can only be resumed for 30 seconds after disconnect
      // and a token is refreshed 1 minute before it expires, a token refresh
      // should not be immediately necessary after resuming a connection.
      if (this.isAuthorized)
        this._setRefreshTimeout();
    } else // reason in 'new' or 'reset'
      await this._refreshToken();
  }
  _onClose({ data }) {
    if (data.code === CLOSE_CLIENT_LOGOUT)
      this._purgeToken();
    else
      this._clearRefreshTimeout();
  }

  /*
   * Returns true if authorization was required.
   */
  async requireAuth(notice) {
    this.authIsRequired = true;
    await this.whenReady;

    if (auth === null)
      auth = new Auth({ config:config.auth }, { autoShow:false, closeOnCancel:false });

    if (notice !== undefined)
      auth.notice = notice;

    if (!this.token)
      return auth.showAuth().then(() => true);
    else if (this.token.confirmPlayerName !== null)
      return auth.showIdentify().then(() => true);

    return false;
  }

  async _refreshToken() {
    // No point in queueing a token refresh if the session is not open.
    // A new attempt to refresh will be made once it is open.
    if (!this._server.isOpen)
      return this.whenAuthorized;

    // Just in case a shared token was changed, but we haven't got the event yet
    await this._syncToken();

    const token = this.token;
    if (!token) return null;

    return this._server.request(this.name, 'refreshToken', [ token ])
      .then(token => this._storeToken(token))
      .catch(error => {
        // If the device was deleted or if the account doesn't exist anymore,
        // pretend as if we were never authenticated in the first place.
        if (error.code === 401 || error.code === 404)
          return this._purgeToken();

        if (error !== 'Connection reset')
          throw error;
      });
  }

  /*
   * Local tokens are stored in session storage and only affect this tab/window.
   * Exception: A local token is frequently shared with other tabs/windows.
   */
  _fetchLocalToken() {
    const tokenValue = sessionStorage.getItem('token');

    return tokenValue ? new AccessToken(tokenValue) : null;
  }
  _storeLocalToken(token) {
    sessionStorage.setItem('token', token.value);
    this.token = token;
  }
  _purgeLocalToken() {
    sessionStorage.removeItem('token');
    this.token = null;
  }

  /*
   * Shared tokens are stored in local storage and may affect multiple tabs/windows.
   */
  _fetchSharedToken() {
    const tokenValue = localStorage.getItem('token');

    return tokenValue ? new AccessToken(tokenValue) : null;
  }
  _storeSharedToken(token) {
    localStorage.setItem('token', token.value);
    this.sharedToken = token;
  }
  _purgeSharedToken() {
    localStorage.removeItem('token');
    this.sharedToken = null;
  }

  // In older versions of iOS, the localStorage data is not shared between PWA
  // and in-browser contexts, but the Cache API in a service worker IS shared.
  // So, tokens are cached and, if the cached token is newer than one found in
  // local storage, then it is restored.
  // The local endpoint is handled by the service worker.
  async _fetchCachedToken() {
    // The local endpoint is handled by the service worker.
    const sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return null;

    const response = await fetch(LOCAL_ENDPOINT);
    // Log evidence described a user visiting the site and registering service
    // worker for the first time.  Somehow, the above 'controller' check passed,
    // but the fetch to the local endpoint was not handled by the controller.
    // The request either bypassed or passed through the service worker and was
    // received by the server, which returned a 404 error.  An error was thrown
    // by 'response.json' since the response was not in JSON format.  The root
    // cause escapes me, but the next line handles this condition.
    if (!response.ok) return null;

    const json = await response.json();

    return json.token ? new AccessToken(json.token) : null;
  }
  async _storeCachedToken(token) {
    const sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return;

    await fetch(LOCAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
  }
  async _purgeCachedToken() {
    // The local endpoint is handled by the service worker.
    const sw = navigator.serviceWorker;
    if (!sw || !sw.controller)
      return;

    await fetch(LOCAL_ENDPOINT, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /*
   * Use case: A new tab/window needs to obtain the shared token.
   * Use case: A new iOS context needs to obtain the cached token.
   *   (Only possible on older versions of iOS)
   */
  async _restoreToken() {
    const sharedToken = this._fetchSharedToken();
    if (sharedToken)
      return this._storeLocalToken(sharedToken);

    const cachedToken = await this._fetchCachedToken();
    if (cachedToken)
      return this._storeLocalToken(cachedToken);
  }
  /*
   * This is called when a storage token event occurs.
   * This is also called before refreshing a token.
   */
  async _syncToken() {
    const sharedToken = this._fetchSharedToken();
    if (this.sharedToken?.value === sharedToken?.value)
      return;

    // If token WAS shared...
    if (this.tokenIsShared) {
      // Purge local token if logged out.
      if (sharedToken === null)
        return this._purgeToken();
      // Sync local token if refreshed
      else if (sharedToken.playerId === this.token.playerId) {
        // Ignore token change events while we are still refreshing the token.
        if (this.whenReady.isResolved)
          return this._storeToken(sharedToken);
      }
      // Local token is no longer shared if shared token is a different player
    } else {
      // If shared token was logged out, share local token.
      if (sharedToken === null && this.token !== null)
        return this._storeSharedToken(this.token);
    }

    this.sharedToken = sharedToken;
  }
  async _storeToken(newToken, overwrite = false) {
    const oldToken = this.token;

    if (typeof newToken === 'string')
      newToken = new AccessToken(newToken);

    if (!newToken.equals(oldToken)) {
      const tokenIsShared = this.tokenIsShared;
      this._storeLocalToken(newToken);

      if (tokenIsShared || overwrite) {
        this._storeSharedToken(newToken);
        await this._storeCachedToken(newToken);
      }
    }

    const isLogin = !this.isAuthorized;
    const isRefresh = !newToken.equals(oldToken);

    if (isLogin || isRefresh) {
      this._setRefreshTimeout();
      this._authorize(this.token);
      this._emit({ type:'token', data:this.token });
      if (isLogin) {
        this.isLoggedIn = true;
        this._emit({ type:'login' });
      } else if (this.token.playerName !== oldToken.playerName)
        this._emit({ type:'name-change' });
    }
  }
  async _purgeToken() {
    const tokenIsShared = this.tokenIsShared;

    if (this.isLoggedIn) {
      this.isLoggedIn = false;
      this._emit({ type:'logout' });
    }

    this._purgeLocalToken();

    if (tokenIsShared) {
      this._purgeSharedToken();
      await this._purgeCachedToken();
    }

    this._clearRefreshTimeout();
    if (this.authIsRequired)
      this.requireAuth();
  }

  _setRefreshTimeout() {
    this._clearRefreshTimeout();

    const token = this.token;
    // Being defensive.  Not expected to happen.
    if (!token) return;

    // Remaining time before expiration minus a 1m safety buffer (in ms)
    const timeout = Math.max(0, token.expiresIn - 60000);

    this._refreshTimeout = setTimeout(() => this._refreshToken(), timeout);
  }
  _clearRefreshTimeout() {
    clearTimeout(this._refreshTimeout);
  }
}
