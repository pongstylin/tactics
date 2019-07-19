import uuid from 'uuid/v4';
import jwt from 'jsonwebtoken';
import getTextWidth from 'string-pixel-width';
import XRegExp from 'xregexp';
import uaparser from 'ua-parser-js';

import config from 'config/server.js';
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
    super.dropClient(client);

    this.sessions.delete(client);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    let session = this.sessions.get(client.id);
    let tokenData = this._validateToken(client, token);

    if (tokenData.isExpired)
      throw new ServerError(401, 'Token expired');

    let player = tokenData.player;
    let device = tokenData.device;

    this.sessions.set(client.id, { token, player, device });
  }

  onRegisterRequest(client, playerData) {
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

    let player = dataAdapter.createPlayer(playerData);
    let device = player.addDevice({
      agents: new Map([[
        client.agent, 
        new Map([[client.address, now]]),
      ]]),
    });
    device.token = player.createAccessToken(device.id);

    dataAdapter.savePlayer(player);

    return device.token;
  }

  onCreateIdentityTokenRequest(client) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let player = session.player;
    player.identityToken = player.createIdentityToken();

    dataAdapter.savePlayer(player);

    return player.identityToken;
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
    let token = player.identityToken;
    if (!token) return null;

    let claims = jwt.verify(token, config.publicKey, {
      ignoreExpiration: true,
    });
    let isExpired = new Date() > new Date(claims.exp * 1000);

    return isExpired ? null : token;
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
    if (session.device.id === deviceId)
      throw new ServerError(403, 'You may not remove the current device.');

    let player = session.player;
    player.removeDevice(deviceId);

    dataAdapter.savePlayer(player);
  }

  /*
   * Have identity token, want to create access token for a new device.
   * (Authorization not required)
   */
  onCreateAccessTokenRequest(client, identityToken) {
    let claims = jwt.verify(identityToken, config.publicKey);
    let player = dataAdapter.getPlayer(claims.sub);
    if (player.identityToken !== identityToken)
      throw new ServerError(401, 'Identity token was revoked');

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

  /*
   * To refresh an access token, a couple things must be true:
   *   1) It must be a verified JWT.  It may be expired, however.
   *   2) Token must not be revoked, which happens once a newer token is used.
   */
  onRefreshTokenRequest(client, token) {
    let session = this.sessions.get(client.id) || {};

    // An authorized player does not have to provide the token.
    if (!token)
      token = session.token;

    let tokenData = this._validateToken(client, token);
    let newToken;

    // Cowardly refuse to refresh a token that has lived for <10% of its life.
    if (tokenData.age < (tokenData.ttl * 0.1))
      newToken = token;
    else
      // A new token is generated but the old token is not revoked until the new
      // token is used to ensure the client received it.
      newToken = tokenData.player.createAccessToken(tokenData.device.id);

    return newToken;
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

    let claims = jwt.verify(session.token, config.publicKey);
    let player = session.player;
    player.update(profile);
    dataAdapter.savePlayer(player);

    // A new token is generated with the new name, if any, but the old token is
    // not revoked until the new token is used to ensure the client received it.
    return player.createAccessToken(claims.deviceId);
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
    if (/<[a-z]+>/i.test(name) || /&[#a-z0-9]+;/i.test(name))
      throw new ServerError(403, 'The name may not contain markup');
  }

  _validateToken(client, token) {
    let now = new Date();
    let tokenSig = token.split('.')[2];

    /*
     * Get some information about the token.
     */
    let claims;

    try {
      claims = jwt.verify(token, config.publicKey, {
        ignoreExpiration: true,
      });
    }
    catch (error) {
      throw new ServerError(401, error.message);
    }

    let playerId  = claims.sub;
    let deviceId  = claims.deviceId;
    let createdAt = new Date(claims.iat * 1000);
    let expiresAt = new Date(claims.exp * 1000);
    let age       = now - createdAt;
    let ttl       = expiresAt - createdAt;
    let isExpired = now > expiresAt;

    let player = dataAdapter.getPlayer(playerId);
    let device = player.getDevice(deviceId);

    if (!device)
      throw new ServerError(401, 'Device deleted');
    if (device.disabled)
      throw new ServerError(401, 'Device disabled');

    /*
     * Get some information about the old token.
     */
    let oldClaims = jwt.verify(device.token, config.publicKey, {
      ignoreExpiration: true,
    });
    let oldCreatedAt = new Date(oldClaims.iat * 1000);

    /*
     * Determine if the submitted token has been revoked.
     * 5 seconds too old is permitted in case a race condition is responsible.
     * A token is revoked once a newer token is used.
     */
    if (createdAt < (oldCreatedAt - 5000)) {
      this.debug(`Revoked token: playerId=${playerId}; deviceId=${deviceId}; token-sig=${tokenSig}`);
      throw new ServerError(409, 'Token revoked');
    }

    /*
     * If the submitted token is newer, revoke the old token.
     *
     * Maintain a history of addresses and agents on this device and the last
     * time they were used.  This information can be made available to the
     * account owner so that they can audit the security of their account.
     */
    if (createdAt > oldCreatedAt) {
      this.debug(`New token: playerId=${playerId}; deviceId=${deviceId}; token-sig=${tokenSig}`);

      if (device.agents.has(client.agent))
        device.agents.get(client.agent).set(client.address, now);
      else
        device.agents.set(client.agent, new Map([[client.address, now]]));

      device.token = token;
      dataAdapter.savePlayer(player);
    }
    else
      this.debug(`Accepted token: playerId=${playerId}; deviceId=${deviceId}; token-sig=${tokenSig}`);

    return { player, device, age, ttl, isExpired };
  }
}

// This class is a singleton
export default new AuthService();
