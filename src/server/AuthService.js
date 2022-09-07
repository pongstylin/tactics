import 'isomorphic-fetch';
import uuid from 'uuid/v4';
import uaparser from 'ua-parser-js';
import { Issuer, generators } from 'openid-client';

import config from 'config/server.js';
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
      requests: {
        register: [ 'auth:profile' ],
        saveProfile: [ 'auth:profile' ],
        refreshToken: `tuple([ 'AccessToken({ ignoreExpiration:true })' ], 0)`,

        createIdentityToken: [],
        getIdentityToken: [],
        revokeIdentityToken: [],

        makeAuthProviderURL: [ { provider:'auth:provider', 'redirectURL?':'string' } ],
        linkAuthProvider: [ 'string' ],
        unlinkAuthProviders: [],
        hasAuthProviderLinks: [],

        addDevice: [ IdentityToken ],
        getDevices: [],
        setDeviceName: [ 'uuid', 'string | null' ],
        removeDevice: [ 'uuid' ],
        logout: [],

        isAccountAtRisk: [],

        getACL: [],
        getPlayerACL: [ 'uuid' ],
        setPlayerACL: [ 'uuid', 'auth:acl' ],
        clearPlayerACL: [ 'uuid' ],
      },
      definitions: {
        profile: {
          name: 'string',
        },
        provider: `enum([ ${Object.keys(config.auth.providers).map(p => `'${p}'`)} ])`,
        acl: {
          type: `enum([ 'friended', 'muted', 'blocked' ])`,
          name: 'string',
        },
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
    player.checkout(client, clientPara.device.id);
    this.data.closePlayer(player.id);

    this.clientPara.delete(client.id);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  /*
   * The router guards against parallel calls to this method by the same client.
   * This method guards against a client getting dropped between authorization
   * starting and completing.  To this end, it aborts if the client is closed
   * after each async call.  It also waits until all async calls are complete
   * before adding the client to the clientPara.
   */
  async onAuthorize(client, { token }) {
    const { player, device } = await this._validateAccessToken(client, token);
    if (client.closed)
      return;

    const clientPara = this.clientPara.get(client.id) ?? {};
    clientPara.token = token;

    if (clientPara.playerId !== token.playerId) {
      if (clientPara.playerId)
        this.data.closePlayer(clientPara.playerId);

      // Keep this player open for the duration of the session.
      await this.data.openPlayer(player.id);
      if (client.closed) {
        this.data.closePlayer(player.id);
        return;
      }

      clientPara.playerId = player.id;
    }

    if (clientPara.device === undefined)
      clientPara.device = device;
    else if (clientPara.device.id !== device.id)
      throw new ServerError(501, 'Unsupported change of device');

    this.clientPara.set(client.id, clientPara);
  }

  async onRegisterRequest(client, playerData) {
    // An authorized player cannot register an account.
    if (this.clientPara.has(client.id))
      throw new ServerError(403, 'Already registered');

    const player = Player.create(playerData);

    /*
     * More than one client may be registered to a given IP address, e.g.
     * two mobile phones on the same wireless network.  Just don't register
     * more than one account within 30 seconds to protect against DoS.
     */
    this.throttle(client.address, 'register', 1, 30);

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

  async onMakeAuthProviderURLRequest(client, state) {
    if (!config.auth.enabled)
      throw new ServerError(501, 'Not Implemented');

    const providerConfig = config.auth.providers[state.provider];
    const issuer = typeof providerConfig.openId === 'string'
      ? await Issuer.discover(providerConfig.openId)
      : new Issuer();
    Object.assign(issuer, providerConfig.issuer);

    const iClient = new issuer.Client(providerConfig.client);
    Object.assign(state, {
      playerId: this.clientPara.get(client.id)?.playerId,
      expiresAt: Date.now() + 60000,
      codeVerifier: generators.codeVerifier(),
    });

    return iClient.authorizationUrl(Object.assign({}, providerConfig.authorization, {
      state: config.auth.encryptState(JSON.stringify(state)),
      code_challenge: generators.codeChallenge(state.codeVerifier),
    }));
  }
  async onLinkAuthProviderRequest(client, link) {
    const playerId = this.clientPara.get(client.id)?.playerId;
    const params = JSON.parse(config.auth.decryptState(link));
    const state = JSON.parse(config.auth.decryptState(params.state));
    if (state.expiresAt < Date.now())
      throw new ServerError(401, 'Auth request has expired');
    if (state.playerId && playerId && state.playerId !== playerId)
      throw new ServerError(401, 'Mismatched auth request');

    const providerConfig = config.auth.providers[state.provider];
    const issuer = typeof providerConfig.openId === 'string'
      ? await Issuer.discover(providerConfig.openId)
      : new Issuer();
    Object.assign(issuer, providerConfig.issuer);

    const iClient = new issuer.Client(providerConfig.client);
    const callback = typeof providerConfig.openId === 'string' ? 'callback' : 'oauthCallback';
    const tokenSet = await iClient[callback](providerConfig.authorization.redirect_uri, params, {
      response_type: providerConfig.authorization.response_type,
      state: params.state,
      code_verifier: state.codeVerifier,
    }).catch(error => {
      if (error.name === 'OPError')
        throw new ServerError(401, 'Authorization not granted');

      throw error;
    });
    if (tokenSet === false)
      return;

    const userinfo = await iClient.userinfo(tokenSet.access_token);

    if (state.playerId) {
      await this.data.linkAuthPlayerId(state.provider, userinfo.id, state.playerId);
      return;
    }

    let name;

    if (state.provider === 'discord') {
      const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

      try {
        const rsp = await fetch(`http://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`, {
          headers: {
            Authorization: `Bearer ${tokenSet.access_token}`,
          },
        });

        if (rsp.status === 200)
          userinfo.guild = await rsp.json();
        else if (rsp.status !== 404)
          throw new ServerError(rsp.status, rsp.statusText);

        name = userinfo.guild.nick ?? userinfo.username;
      } catch (error) {
        console.log('Error while fetching guild:', error);
        name = userinfo.username;
      }
    } else if (state.provider === 'facebook')
      name = userinfo.name;

    try {
      Player.validatePlayerName(name);
    } catch (error) {
      name = 'Noob';
    }

    const oldPlayerId = await this.data.getAuthPlayerId(state.provider, userinfo.id);
    const player = oldPlayerId
      ? await this.data.getPlayer(oldPlayerId)
      : await this.data.createPlayer({ name, confirmName:true });
    const token = player.addDevice(client).token;
    await this.data.linkAuthPlayerId(state.provider, userinfo.id, player.id);

    return token;
  }
  onUnlinkAuthProvidersRequest(client) {
    if (!config.auth.enabled)
      throw new ServerError(501, 'Not Implemented');
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);

    return this.data.unlinkAuthProviders(clientPara.playerId, Object.keys(config.auth.providers));
  }
  onHasAuthProviderLinksRequest(client) {
    if (!config.auth.enabled)
      throw new ServerError(501, 'Not Implemented');
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);

    return this.data.hasAuthProviderLinks(clientPara.playerId, Object.keys(config.auth.providers));
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
      checkoutAt: device.checkoutAt,
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
    if (deviceId === clientPara.device.id)
      throw new ServerError(403, 'To remove current device, logout');

    const player = this.data.getOpenPlayer(clientPara.playerId);

    this.push.clearPushSubscription(player.id, deviceId);

    player.removeDevice(deviceId);
  }
  async onLogoutRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const { playerId, device } = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(playerId);

    this.push.clearPushSubscription(player.id, device.id);
    this._emit({
      type: 'logout',
      clientId: client.id,
    });

    player.removeDevice(device.id);
  }

  async onIsAccountAtRiskRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    // Not at risk if they (assumedly) saved an active identity token somewhere.
    if (player.getIdentityToken())
      return false;

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const device of player.devices.values()) {
      if (device.id === clientPara.device.id)
        continue;

      // Not at risk if another device has been used in the past 7 days.
      if (device.checkoutAt > oneWeekAgo)
        return false;
    }

    const authLinks = await this.data.hasAuthProviderLinks(player.id, Object.keys(config.auth.providers));
    for (const isLinked of authLinks.values()) {
      // Not at risk if an auth provider was linked
      if (isLinked)
        return false;
    }

    return true;
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
      throw new ServerError(409, 'Token revoked');
    }

    return { player, device };
  }
}
