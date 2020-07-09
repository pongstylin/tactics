import uuid from 'uuid/v4';
import uaparser from 'ua-parser-js';

import IdentityToken from 'server/IdentityToken.js';
import AccessToken from 'server/AccessToken.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';
import Player from 'models/Player.js';

const dataAdapter = adapterFactory();

class AuthService extends Service {
  constructor() {
    super({
      name: 'auth',

      // Session data for each client.
      sessions: new Map(),
    });
  }

  dropClient(client) {
    this.sessions.delete(client.id);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  async onAuthorize(client, { token:tokenValue }) {
    let session = await this._validateAccessToken(client, tokenValue);
    if (session.token.isExpired)
      throw new ServerError(401, 'Token expired');

    this.sessions.set(client.id, session);
  }

  async onRegisterRequest(client, playerData) {
    let session = this.sessions.get(client.id) || {};

    // An authorized player cannot register an account.
    if (session.token)
      throw new ServerError(403, 'Already registered');

    /*
     * More than one client may be registered to a given IP address, e.g.
     * two mobile phones on the same wireless network.  Just don't register
     * more than one account within 30 seconds to protect against DoS.
     */
    this.throttle(client.address, 'register', 1, 30);

    let { player, device } = await dataAdapter.register(playerData, client);

    return player.getAccessToken(device.id);
  }

  async onCreateIdentityTokenRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    session.player = await dataAdapter.createIdentityToken(session.player.id);

    return session.player.identityToken;
  }
  async onRevokeIdentityTokenRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    session.player = await dataAdapter.revokeIdentityToken(session.player.id);
  }

  async onGetIdentityTokenRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let player = session.player;
    let token = player.identityToken;

    if (token && token.isExpired) {
      session.player = await dataAdapter.revokeIdentityToken(session.player.id);
      token = null;
    }

    return token;
  }

  onGetDevicesRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let player = session.player;

    return [...player.devices].map(([deviceId, device]) => ({
      id: deviceId,
      name: device.name,
      agents: [...device.agents].map(([agent, addresses]) => {
        let digest = uaparser(agent);

        if (digest.os.name === undefined)
          digest.os = null;
        if (digest.browser.name === undefined)
          digest.browser = null;
        if (digest.device.vendor === undefined)
          digest.device = null;

        return {
          agent: agent,
          os: digest.os,
          browser: digest.browser,
          device: digest.device,
          addresses: [...addresses].map(([address, lastSeenAt]) => ({
            address: address,
            lastSeenAt: lastSeenAt,
          })),
        }
      }),
    }));
  }
  /*
   * Add device to account using the identity token.  Return access token.
   * (Authorization not required)
   */
  async onAddDeviceRequest(client, identityTokenValue) {
    let now = new Date();
    let token = IdentityToken.verify(identityTokenValue);

    let player = await dataAdapter.getPlayer(token.playerId);
    if (!token.equals(player.identityToken))
      throw new ServerError(403, 'Identity token was revoked');

    player.identityToken = null;
    let device = player.addDevice(client);

    await dataAdapter.savePlayer(player);

    return device.token;
  }
  onSetDeviceNameRequest(client, deviceId, deviceName) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    if (deviceName !== null) {
      if (typeof deviceName !== 'string')
        throw new ServerError(400, 'Expected device name');
      if (deviceName.length > 20)
        throw new ServerError(400, 'Device name may not exceed 20 characters');
    }

    let player = session.player;
    let device = player.getDevice(deviceId);
    if (!device)
      throw new ServerError(404, 'No such device');

    device.name = deviceName;

    dataAdapter.savePlayer(player);
  }
  onRemoveDeviceRequest(client, deviceId) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    dataAdapter.removePlayerDevice(session.player, deviceId);
  }

  /*
   * To refresh an access token, a couple things must be true:
   *   1) It must be a verified JWT.  It may be expired, however.
   *   2) Token must not be revoked, which happens once a newer token is used.
   *
   * Avoiding Race Conditions
   *   For passwordless accounts, it is imperative that the client always has an
   *   active token.  But for good security, old tokens must be revoked.  It is
   *   also possible for multiple windows/tabs to request a token at the same
   *   time.  If you are not careful, this can result in one of the tokens being
   *   activated and the other revoked and the revoked one replacing the active
   *   one in client storage.  At this point, the account is unreachable on that
   *   device.  We take a few steps to avoid this:
   *     1) Don't revoke the token until the next token is USED.  This
   *        guarantees that the client received and had a chance to store the
   *        next token.
   *     2) Allow refreshing either the token or the next token, if the next
   *        token hadn't been used yet.
   *     3) Don't generate multiple next tokens in a short time period.  This is
   *        accomplished by:
   *
   *        a) When refreshing the token, but a next token exists, return it
   *           if it is still fresh.
   *        b) When refreshing the next token, activating it, return it if it is
   *           still fresh.
   *        c) Use the data adapter to atomically/serially refresh tokens.
   */
  async onRefreshTokenRequest(client, tokenValue) {
    let session = this.sessions.get(client.id) || {};

    // An authorized player does not have to provide the token.
    if (!tokenValue)
      tokenValue = session.token.value;

    let { player, device } = await this._validateAccessToken(client, tokenValue);
    let oldToken = player.getAccessToken(device.id);

    session.player = await dataAdapter.refreshAccessToken(player.id, device.id);
    session.device = session.player.getDevice(device.id);

    let newToken = session.player.getAccessToken(device.id);
    if (!newToken.equals(oldToken))
      this.debug(`New token: playerId=${player.id}; deviceId=${device.id}; token-sig=${newToken.signature}`);

    return newToken;
  }

  /*
   * Save player profile data.  This results in generating a new token.
   *
   * Right now, the client must first register or refresh token first.
   */
  async onSaveProfileRequest(client, profile) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let { player, device } = session;
    let oldToken = player.getAccessToken(device.id);

    session.player = await dataAdapter.savePlayerProfile(player.id, profile);
    session.device = session.player.getDevice(device.id);

    let newToken = session.player.getAccessToken(device.id);
    if (!newToken.equals(oldToken))
      this.debug(`New token: playerId=${player.id}; deviceId=${device.id}; token-sig=${newToken.signature}`);

    return newToken;
  }

  async _validateAccessToken(client, tokenValue) {
    let now = new Date();
    let token = AccessToken.verify(tokenValue, { ignoreExpiration:true });
    let player = await dataAdapter.getPlayer(token.playerId);
    let device = player.getDevice(token.deviceId);

    if (!device)
      throw new ServerError(401, 'Device deleted');

    if (token.equals(device.token)) {
      this.debug(`Accepted token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
    }
    else if (token.equals(device.nextToken)) {
      this.debug(`Activate token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);

      if (device.agents.has(client.agent))
        device.agents.get(client.agent).set(client.address, now);
      else
        device.agents.set(client.agent, new Map([[client.address, now]]));

      device.token = token;
      device.nextToken = null;
      await dataAdapter.savePlayer(player);
    }
    else {
      // This should never happen unless tokens are leaked and used without permission.
      this.debug(`Revoked token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
      throw new ServerError(409, 'Token revoked');
    }

    return { token, player, device };
  }
}

// This class is a singleton
export default new AuthService();
