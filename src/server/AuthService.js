import uuid from 'uuid/v4';
import uaparser from 'ua-parser-js';

import IdentityToken from 'server/IdentityToken.js';
import AccessToken from 'server/AccessToken.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import Player from 'models/Player.js';

export default class AuthService extends Service {
  constructor(props) {
    super({
      ...props,

      clientPara: new Map(),
    });

    this.setValidation({
      authorize: { token:AccessToken },
      request: {
        addDevice: [ IdentityToken ],
        refreshToken: [{
          $type: AccessToken,
          $validation: { ignoreExpiration:true },
          $required: false,
        }],
      },
    });
  }

  openPlayer(playerId) {
    return this.data.openPlayer(playerId);
  }
  closePlayer(playerId) {
    return this.data.closePlayer(playerId);
  }
  getPlayer(playerId) {
    return this.data.getPlayer(playerId);
  }

  dropClient(client) {
    const clientPara = this.clientPara.get(client.id);
    if (!clientPara) return;

    const player = this.data.getOpenPlayer(clientPara.playerId);
    player.checkout(client);
    this.data.closePlayer(player.id);

    this.clientPara.delete(client.id);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  async onAuthorize(client, { token }) {
    const { player, device } = await this._validateAccessToken(client, token);

    if (this.clientPara.has(client.id)) {
      const clientPara = this.clientPara.get(client.id);
      clientPara.token = token;

      if (clientPara.playerId !== token.playerId) {
        this.data.closePlayer(clientPara.playerId);
        clientPara.playerId = player.id;
        clientPara.device = device;

        await this.data.openPlayer(token.playerId);
      } else if (clientPara.device.id !== device.id)
        throw new ServerError(501, 'Unsupported change of device');
    } else {
      const clientPara = {};

      clientPara.token = token;
      clientPara.playerId = player.id;
      clientPara.device = device;
      this.clientPara.set(client.id, clientPara);

      // Keep this player open for the duration of the session.
      await this.data.openPlayer(player.id);
    }
  }

  async onRegisterRequest(client, playerData) {
    // An authorized player cannot register an account.
    if (this.clientPara.has(client.id))
      throw new ServerError(403, 'Already registered');

    /*
     * More than one client may be registered to a given IP address, e.g.
     * two mobile phones on the same wireless network.  Just don't register
     * more than one account within 30 seconds to protect against DoS.
     */
    this.throttle(client.address, 'register', 1, 30);

    const player = Player.create(playerData);
    const device = player.addDevice(client);
    await this.data.createPlayer(player);

    return player.getAccessToken(device.id);
  }

  async onCreateIdentityTokenRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);
    player.setIdentityToken();

    return player.identityToken;
  }
  async onRevokeIdentityTokenRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);
    player.clearIdentityToken();
  }

  async onGetIdentityTokenRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    return player.getIdentityToken();
  }

  onGetDevicesRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    return [...player.devices].map(([deviceId, device]) => ({
      id: deviceId,
      name: device.name,
      agents: [...device.agents].map(([agent, addresses]) => {
        const digest = uaparser(agent);

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
  onGetACLRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    return player.acl;
  }
  /*
   * Add device to account using the identity token.  Return access token.
   * (Authorization not required)
   */
  async onAddDeviceRequest(client, token) {
    const player = await this.data.getPlayer(token.playerId);

    return player.addDevice(client, token).token;
  }
  async onSetDeviceNameRequest(client, deviceId, deviceName) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);
    player.setDeviceName(deviceId, deviceName);
  }
  async onRemoveDeviceRequest(client, deviceId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);
    player.removeDevice(deviceId);

    this.push.clearPushSubscription(player.id, deviceId);
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
   */
  async onRefreshTokenRequest(client, token) {
    // An authorized player does not have to provide the token.
    if (!token)
      if (this.clientPara.has(client.id))
        token = this.clientPara.get(client.id).token;
      else
        throw new ServerError(401, 'Required access token');

    const { player, device } = await this._validateAccessToken(client, token);

    if (player.refreshAccessToken(device.id)) {
      const newToken = player.getAccessToken(device.id);
      this.debug(`New token: playerId=${player.id}; deviceId=${device.id}; token-sig=${newToken.signature}`);
    }

    return player.getAccessToken(device.id);
  }

  /*
   * Save player profile data.  This results in generating a new token.
   *
   * Right now, the client must first register or refresh token first.
   */
  async onSaveProfileRequest(client, profile) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const { playerId, device } = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(playerId);

    if (player.updateProfile(profile)) {
      const newToken = player.getAccessToken(device.id);
      this.debug(`New token: playerId=${player.id}; deviceId=${device.id}; token-sig=${newToken.signature}`);
    }

    return player.getAccessToken(device.id);
  }

  async onGetPlayerACLRequest(client, playerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    return player.getPlayerACL(playerId);
  }
  async onSetPlayerACLRequest(client, playerId, playerACL) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const playerA = this.data.getOpenPlayer(clientPara.playerId);
    const playerB = await this.data.getPlayer(playerId);
    playerA.setPlayerACL(playerB, playerACL);

    if (playerACL.type === 'blocked')
      this.game.blockPlayer(playerA.id, playerId);
  }
  async onClearPlayerACLRequest(client, playerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const playerA = this.data.getOpenPlayer(clientPara.playerId);
    const playerB = await this.data.getPlayer(playerId);
    playerA.clearPlayerACL(playerB);
  }

  async _validateAccessToken(client, token) {
    const player = await this.data.getPlayer(token.playerId);
    const device = player.getDevice(token.deviceId);

    if (!device)
      throw new ServerError(401, 'Device deleted');

    if (token.equals(device.token)) {
      this.debug(`Accepted token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
    } else if (token.equals(device.nextToken)) {
      player.activateAccessToken(client, token);
      this.debug(`Activate token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
    } else {
      // This should never happen unless tokens are leaked and used without permission.
      this.debug(`Revoked token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
      //throw new ServerError(409, 'Token revoked');
    }

    return { player, device };
  }
}
