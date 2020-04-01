import uuid from 'uuid/v4';
import getTextWidth from 'string-pixel-width';
import XRegExp from 'xregexp';
import uaparser from 'ua-parser-js';

import IdentityToken from 'server/IdentityToken.js';
import AccessToken from 'server/AccessToken.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';
import Player from 'models/Player.js';

const dataAdapter = adapterFactory();

/*
 * Player names may have the following characters:
 *   Letter, Number, Punctuation, Symbol, Space
 *
 * Other restrictions are imposed by the _validatePlayerName() method.
 */
XRegExp.install('astral');
let rUnicodeLimit = XRegExp('^(\\pL|\\pN|\\pP|\\pS| )+$');

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
    let now = new Date();

    // An authorized player cannot register an account.
    if (session.token)
      throw new ServerError(403, 'Already registered');

    this._validatePlayerName(playerData.name);

    /*
     * More than one client may be registered to a given IP address, e.g.
     * two mobile phones on the same wireless network.  Just don't register
     * more than one account per minute to protect against DoS.
     */
    this.throttle(client.address, 'register', 1, 60);

    let player = await dataAdapter.createPlayer(playerData);
    let device = player.addDevice({
      agents: new Map([[
        client.agent, 
        new Map([[client.address, now]]),
      ]]),
    });
    device.token = player.createAccessToken(device.id);

    return dataAdapter.savePlayer(player).then(() => device.token);
  }

  onCreateIdentityTokenRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let player = session.player;
    player.identityToken = player.createIdentityToken();

    return dataAdapter.savePlayer(player).then(() => player.identityToken);
  }
  onRevokeIdentityTokenRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let player = session.player;
    player.identityToken = null;

    dataAdapter.savePlayer(player);
  }

  onGetIdentityTokenRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let player = session.player;
    let token = IdentityToken.verify(player.identityToken, { ignoreExpiration:true });
    if (!token) return null;

    return token.isExpired ? null : token;
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
    if (player.identityToken !== identityToken)
      throw new ServerError(403, 'Identity token was revoked');

    let device = player.addDevice({
      agents: new Map([[
        client.agent, 
        new Map([[client.address, now]]),
      ]]),
    });
    device.token = player.createAccessToken(device.id);
    player.identityToken = null;

    dataAdapter.savePlayer(player);

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

    return dataAdapter.refreshAccessToken(player.id, device.id).then(token => {
      if (!token.equals(device.token) && !token.equals(device.nextToken))
        this.debug(`New token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);

      return token;
    });
  }

  /*
   * Save player profile data.  This results in generating a new token.
   *
   * Right now, the client must first register or refresh token first.
   */
  onSaveProfileRequest(client, profile) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    if ('name' in profile)
      this._validatePlayerName(profile.name);

    let player = session.player;
    player.update(profile);
    dataAdapter.savePlayer(player);

    // A new token is generated with the new name, if any, but the old token is
    // not revoked until the new token is used to ensure the client received it.
    return player.createAccessToken(session.token.deviceId);
  }

  _validatePlayerName(name) {
    if (!name)
      throw new ServerError(422, 'Player name is required');
    if (name.length > 20)
      throw new ServerError(403, 'Player name length limit is 20 characters');

    let width = getTextWidth(name, { font: 'Arial', size: 12 });
    if (width > 110)
      throw new ServerError(403, 'Player name visual length is too long');

    if (!rUnicodeLimit.test(name))
      throw new ServerError(403, 'Name contains forbidden characters');
    if (name.startsWith(' '))
      throw new ServerError(403, 'Name may not start with a space');
    if (name.endsWith(' '))
      throw new ServerError(403, 'Name may not end with a space');
    if (name.includes('  '))
      throw new ServerError(403, 'Name may not contain consecutive spaces');
    if (name.includes('#'))
      throw new ServerError(403, 'The # symbol is reserved');
    if (/<[a-z].*?>|<\//i.test(name) || /&[#a-z0-9]+;/i.test(name))
      throw new ServerError(403, 'The name may not contain markup');
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
      dataAdapter.savePlayer(player);
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
