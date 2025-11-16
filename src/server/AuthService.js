import 'isomorphic-fetch';
import uaparser from 'ua-parser-js';
import { Issuer, generators } from 'openid-client';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

import config from '#config/server.js';
import IdentityToken from '#server/IdentityToken.js';
import AccessToken from '#server/AccessToken.js';
import Service from '#server/Service.js';
import ServerError from '#server/Error.js';

const AUTH_PROVIDERS = Object.keys(config.auth.providers);

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

        createIdentityToken: [ 'uuid | null' ],
        getIdentityToken: [],
        revokeIdentityToken: [],

        makeAuthProviderURL: [ {
          provider: 'auth:provider',
          redirectURL: 'string',
          'deviceId?': 'string',
        } ],
        linkAuthProvider: [ 'string' ],
        unlinkAuthProviders: [],
        hasAuthProviderLinks: [],

        addDevice: [ IdentityToken ],
        getDevices: [],
        setDeviceName: [ 'uuid', 'string | null' ],
        removeDevice: [ 'uuid' ],
        logout: [],

        // Admin actions
        toggleGlobalMute: [ 'uuid' ],
        promoteToVerified: [ 'uuid | null' ],

        getACL: [],
        setACL: [ 'auth:acl' ],
        getActiveRelationships: [],
        getRelationship: [ 'uuid' ],
        setRelationship: [ 'uuid', 'auth:relationship' ],
        clearRelationship: [ 'uuid' ],

        queryRatedPlayers: [ 'string' ],
        getRatedPlayers: [ 'uuid[]' ],

        getRankings: [],
        getRanks: [ 'string' ],
        getTopRanks: [ 'string | null', 'uuid' ],
        getPlayerRanks: [ 'uuid', 'string | null' ],
      },
      definitions: {
        profile: {
          name: 'string',
        },
        provider: config.auth.enabled ? `enum([ ${AUTH_PROVIDERS.map(p => `'${p}'`)} ])` : 'string',
        acl: {
          newAccounts: `enum([ 'muted', 'blocked' ]) | null`,
          guestAccounts: `enum([ 'muted', 'blocked' ]) | null`,
        },
        relationship: {
          'type?': `enum([ 'friended', 'muted', 'blocked' ])`,
          'name?': 'string',
        },
      },
    });
  }

  syncRankings(gameTypes) {
    this.data.syncRankings(gameTypes);
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
  unlinkAuthProvider(provider, userId) {
    return this.data.unlinkAuthProvider(provider, userId);
  }
  getPlayerRanks(playerIds, rankingIds) {
    return this.data.getPlayerRanks(playerIds, rankingIds);
  }

  dropClient(client) {
    const clientPara = this.clientPara.get(client.id);
    if (!clientPara) return;

    const player = this.data.getOpenPlayer(clientPara.playerId);
    player.checkout(client, clientPara.device);
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
    const { player, device } = await this._validateAccessToken(token);
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
    player.checkin(client, clientPara.device);
  }

  async onRegisterRequest(client, playerData) {
    // An authorized player cannot register an account.
    if (this.clientPara.has(client.id))
      throw new ServerError(403, 'Already registered');

    const player = await this.data.createPlayer(playerData);
    const device = player.createDevice(client);
    await this.data.createPlayerDevice(player, device);

    /*
     * More than one client may be registered to a given IP address, e.g.
     * two mobile phones on the same wireless network.  Just don't register
     * more than one account within 30 seconds to protect against DoS.
     */
    this.throttle(client.address, 'register', 1, 30);

    return player.getAccessToken(device.id);
  }

  async onCreateIdentityTokenRequest(client, playerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    let player = this.data.getOpenPlayer(clientPara.playerId);

    if (playerId && playerId !== clientPara.playerId) {
      if (!player.identity.admin)
        throw new ServerError(401, 'You must be an admin to create identity tokens for other players.');
      player = await this.data.getPlayer(playerId);
    }

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
      expiresAt: Date.now() + 300000, // 15min
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

    /*
     * If a playerId is present, then this is linking a provider to an existing account.
     * If not present, player is logging in either for the first time or not.
     */
    if (state.playerId) {
      await this.data.linkAuthProvider(state.provider, userinfo.id, state.playerId);
      return;
    }

    const linkedPlayerId = await this.data.getAuthProviderPlayerId(state.provider, userinfo.id);
    let player;
    if (linkedPlayerId) {
      player = await this.data.getPlayer(linkedPlayerId);
    } else {
      const nameCandidates = [ 'Noob' ];

      if (state.provider === 'discord') {
        nameCandidates.unshift(userinfo.global_name, userinfo.username);

        const client = new REST({ version:'10',authPrefix:'Bearer' }).setToken(tokenSet.access_token);

        try {
          const guild = await client.get(Routes.userGuildMember(process.env.DISCORD_GUILD_ID));
          if (guild && guild.nick !== null)
            nameCandidates.unshift(guild.nick);
        } catch (error) {
          if (error.status !== 404)
            console.log('Error while fetching guild:', error);
        }
      } else if (state.provider === 'facebook')
        nameCandidates.unshift(userinfo.name);

      const name = nameCandidates.find(nc => nc !== undefined && nc !== null);

      player = await this.data.createPlayer({ confirmName:name });
      await this.data.linkAuthProvider(state.provider, userinfo.id, player.id);
    }

    if (!state.deviceId) {
      const device = player.createDevice(client);
      await this.data.createPlayerDevice(player, device);
      state.deviceId = device.id;
    }

    // state.deviceId is set by AuthClient.openAuthProvider() when available.
    // Necessary because logging in does not log in all tabs.
    const device = await this.data.getPlayerDevice(player.id, state.deviceId);
    if (!device)
      throw new ServerError(404, 'Device not found');

    return device.token;
  }
  onUnlinkAuthProvidersRequest(client) {
    if (!config.auth.enabled)
      throw new ServerError(501, 'Not Implemented');
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);

    return this.data.unlinkAuthProviders(clientPara.playerId, AUTH_PROVIDERS);
  }
  onHasAuthProviderLinksRequest(client) {
    if (!config.auth.enabled)
      throw new ServerError(501, 'Not Implemented');
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);

    return this.data.hasAuthProviderLinks(clientPara.playerId, AUTH_PROVIDERS);
  }

  async onGetIdentityTokenRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    return player.getIdentityToken();
  }
  async onGetDevicesRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);
    const devices = await this.data.getAllPlayerDevices(player.id);

    return devices.map(device => ({
      id: device.id,
      name: device.name,
      agents: Array.from(device.agents.entries()).map(([agent, addresses]) => {
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

  async onToggleGlobalMuteRequest(client, targetPlayerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    if (process.env.NODE_ENV !== 'development') {
      const clientPara = this.clientPara.get(client.id);
      const player = this.data.getOpenPlayer(clientPara.playerId);
      if (!player.identity.admin)
        throw new ServerError(403, 'You must be an admin to use this feature.');
    }

    const target = await this.data.getPlayer(targetPlayerId);
    return target.toggleGlobalMute();
  }
  async onPromoteToVerifiedRequest(client, targetPlayerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);

    if (process.env.NODE_ENV !== 'development') {
      const player = this.data.getOpenPlayer(clientPara.playerId);
      if (!player.identity.admin)
        throw new ServerError(403, 'You must be an admin to use this feature.');
    }

    const target = await this.data.getPlayer(targetPlayerId ?? clientPara.playerId);
    if (target.verified)
      throw new ServerError(400, 'Player is already verified');

    target.verified = true;
  }

  onGetACLRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    return player.acl;
  }
  onSetACLRequest(client, acl) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    player.acl = acl;
  }
  /*
   * Add device to account using the identity token.  Return access token.
   * (Authorization not required)
   */
  async onAddDeviceRequest(client, token) {
    if (this.clientPara.has(client.id))
      throw new ServerError(400, 'To add a device, you must first logout');

    const player = await this.data.getPlayer(token.playerId);
    const device = player.createDevice(client, token);
    await this.data.createPlayerDevice(player, device);

    return device.token;
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

    await this.removeDevice(player, deviceId);
  }
  async onLogoutRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const { playerId, device } = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(playerId);

    await this.removeDevice(player, device.id);
  }
  async removeDevice(player, deviceId) {
    /*
     * Logout all clients on this device.
     */
    for (const [ clientId, { device } ] of this.clientPara.entries())
      if (device.id === deviceId)
        this._emit({ type:'logout', clientId });

    await this.data.removePlayerDevice(player.id, deviceId);
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

    if (config.auth.enabled) {
      const authLinks = await this.data.hasAuthProviderLinks(player.id, AUTH_PROVIDERS);
      for (const isLinked of authLinks.values()) {
        // Not at risk if an auth provider was linked
        if (isLinked)
          return false;
      }
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

    const { player, device } = await this._validateAccessToken(token);

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

    if (await player.updateProfile(profile)) {
      const newToken = player.getAccessToken(device.id);
      this.debug(`New token: playerId=${player.id}; deviceId=${device.id}; token-sig=${newToken.signature}`);
    }

    return player.getAccessToken(device.id);
  }

  async onGetActiveRelationshipsRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const player = this.data.getOpenPlayer(clientPara.playerId);

    return player.getActiveRelationships();
  }
  async onGetRelationshipRequest(client, targetPlayerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    if (clientPara.playerId === targetPlayerId)
      throw new ServerError(403, 'May not get player info for yourself.');

    const me = this.data.getOpenPlayer(clientPara.playerId);
    const them = await this.data.getPlayer(targetPlayerId);

    return {
      ...me.getRelationship(them),
      acl: new Map([
        [ 'me', me.acl ],
        [ 'them', them.acl ],
      ]),
      isNew: new Map([
        [ 'me', me.isNew ],
        [ 'them', them.isNew ],
      ]),
      isVerified: new Map([
        [ 'me', me.verified ],
        [ 'them', them.verified ],
      ]),
    };
  }
  async onSetRelationshipRequest(client, playerId, relationship) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const playerA = this.data.getOpenPlayer(clientPara.playerId);
    const playerB = await this.data.getPlayer(playerId);
    playerA.setRelationship(playerB, relationship);

    if (relationship.type === 'blocked')
      this.game.blockPlayer(playerA.id, playerId);
  }
  async onClearRelationshipRequest(client, playerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const clientPara = this.clientPara.get(client.id);
    const playerA = this.data.getOpenPlayer(clientPara.playerId);
    const playerB = await this.data.getPlayer(playerId);
    playerA.clearRelationship(playerB);
  }

  async onQueryRatedPlayersRequest(client, query) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    return this.data.queryRatedPlayers(query, this.clientPara.get(client.id).playerId);
  }
  async onGetRatedPlayersRequest(client, playerIds) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    return this.data.getRatedPlayers(playerIds, this.clientPara.get(client.id).playerId);
  }

  async onGetRankingsRequest(client) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    return this.data.getRankings();
  }
  async onGetRanksRequest(client, rankingId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const ranksByRankingId = await this.data.getRanks([ rankingId ]);

    return ranksByRankingId.get(rankingId);
  }
  async onGetTopRanksRequest(client, rankingId, playerId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    return this.data.getTopRanks(rankingId ? [ rankingId ] : [], playerId);
  }
  async onGetPlayerRanksRequest(client, playerId, rankingId) {
    if (!this.clientPara.has(client.id))
      throw new ServerError(401, 'Authorization is required');

    const ranksByPlayerId = await this.data.getPlayerRanks([ playerId ], rankingId ? [ rankingId ] : []);

    return ranksByPlayerId.get(playerId);
  }

  async _validateAccessToken(token) {
    const player = await this.data.getPlayer(token.playerId).catch(error => {
      if (error.code === 404)
        throw new ServerError(401, 'Player deleted');
      throw error;
    });
    const device = await this.data.getPlayerDevice(token.playerId, token.deviceId);
    if (!device)
      throw new ServerError(401, 'Device deleted');

    if (token.equals(device.token)) {
      this.debug(`Accepted token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
    } else if (token.equals(device.nextToken)) {
      player.activateAccessToken(token);
      this.debug(`Activate token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
    } else {
      // This should never happen unless tokens are leaked and used without permission.
      this.debug(`Revoked token: playerId=${player.id}; deviceId=${device.id}; token-sig=${token.signature}`);
      throw new ServerError(401, 'Token revoked');
    }

    return { player, device };
  }
}
