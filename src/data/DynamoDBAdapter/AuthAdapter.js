import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

import '#server/AccessToken.js';
import Identities from '#models/Identities.js';
import Identity from '#models/Identity.js';
import Player from '#models/Player.js';
import Provider from '#models/Provider.js';

export default class extends DynamoDBAdapter {
  constructor(options = {}) {
    super({
      name: 'auth',
      state: {},
      readonly: options.readonly ?? process.env.READONLY === 'true',
      hasState: options.hasState ?? true,
      fileTypes: new Map([
        [
          'player', {
            saver: '_savePlayer',
          },
        ],
        [
          'playerDevice', {
            saver: '_savePlayerDevice',
          },
        ],
        [
          'identity', {
            saver: '_saveIdentity',
          },
        ],
        [
          'provider', {
            saver: '_saveProvider',
          },
        ],
      ]),
      gameTypes: null,
    });
  }

  async bootstrap() {
    const state = (await super.bootstrap()).state;
    const cache = this.cache.get('identity');
    const identities = state.identities ||= Identities.create();
    identities.on('change', () => this.saveState());
    identities.on('change:merge', ({ data:{ identity } }) => this._deleteIdentity(identity));

    cache.on('expire', ({ data:items }) => {
      for (const identity of items.values())
        identities.archive(identity);
    });

    await Promise.all(identities.getIds().map(iId => this._getIdentity(iId).then(identity => {
      identities.addValue(identity);
      cache.add(identity.id, identity, identity.expireAt);
    }).catch(() => {
      identities.deleteId(iId);
      console.warn(`Warning: Failed to load identity: ${iId}`);
    })));

    Player.identities = this.state.identities;

    return this;
  }

  syncRankings(gameTypes) {
    const identityCache = this.cache.get('identity');
    this.gameTypes = gameTypes;

    for (const identity of identityCache.values())
      identity.pruneRanks(gameTypes);
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  async createPlayer(player) {
    if (!(player instanceof Player))
      player = await Player.create(player);

    await this._createPlayer(player);
    this.cache.get('player').add(player.id, player);
    this.cache.get('identity').add(player.identityId, player.identity);
    return player;
  }
  async openPlayer(playerId) {
    const playerCache = this.cache.get('player');
    const player = await this._getPlayer(playerId);
    playerCache.open(playerId, player);
    this.cache.get('identity').sync(playerCache, playerId, player.identityId, player.identity);
    for (const device of player.devices.values())
      this.cache.get('playerDevice').sync(playerCache, playerId, device.id, device);
    return player;
  }
  closePlayer(playerId) {
    const playerCache = this.cache.get('player');
    const player = playerCache.close(playerId);
    this.cache.get('identity').sync(playerCache, playerId, player.identityId, player.identity, player.identity.expireAt);
    for (const device of player.devices.values())
      this.cache.get('playerDevice').sync(playerCache, playerId, device.id, device);
    return player;
  }
  async getPlayer(playerId) {
    const playerCache = this.cache.get('player');
    const player = await this._getPlayer(playerId);
    playerCache.add(playerId, player);
    this.cache.get('identity').add(player.identityId, player.identity);
    for (const device of player.devices.values())
      this.cache.get('playerDevice').sync(playerCache, playerId, device.id, device);
    return player;
  }
  getOpenPlayer(playerId) {
    return this.cache.get('player').getOpen(playerId);
  }

  async createPlayerDevice(player, device) {
    await this._createPlayerDevice(player, device);
    return device;
  }
  async getAllPlayerDevices(playerId) {
    const player = await this.getPlayer(playerId);
    return this._getAllPlayerDevices(player);
  }
  async getPlayerDevice(playerId, deviceId) {
    const player = await this.getPlayer(playerId);
    return this._getPlayerDevice(player, deviceId);
  }
  async removePlayerDevice(playerId, deviceId) {
    const player = await this.getPlayer(playerId);
    await this._removePlayerDevice(player, deviceId);
  }

  async linkAuthProvider(providerId, memberId, newLinkPlayerId) {
    const provider = await this._getProvider(providerId);
    this.cache.get('provider').add(providerId, provider);

    const oldLink = provider.getLinkByMemberId(memberId);
    const oldLinkPlayer = oldLink && await this._getPlayer(oldLink.playerId);
    if (oldLink?.active) {
      if (oldLink.playerId === newLinkPlayerId)
        return;
      else
        oldLinkPlayer.unlinkAuthProvider(provider);
    }

    const newLinkPlayer = await this.getPlayer(newLinkPlayerId);
    newLinkPlayer.linkAuthProvider(provider, memberId);

    // Identities are unaffected if linking a player to a new member
    if (oldLinkPlayer === null)
      return;

    // Identities are unaffected if moving a link to a different player under the same identity.
    if (oldLinkPlayer.identityId === newLinkPlayer.identityId)
      return;

    const newLinkPlayers = await Promise.all(newLinkPlayer.identity.playerIds.map(pId => this._getPlayer(pId)));

    this.state.identities.merge(oldLinkPlayer.identity, newLinkPlayer.identity, newLinkPlayers);
  }
  async getAuthProviderPlayerId(providerId, memberId) {
    const provider = await this._getProvider(providerId);
    this.cache.get('provider').add(providerId, provider);
    return provider.getActivePlayerId(memberId);
  }
  async unlinkAuthProvider(providerId, memberId) {
    const provider = await this._getProvider(providerId);
    this.cache.get('provider').add(providerId, provider);

    const playerId = provider.getActivePlayerId(memberId);
    if (playerId === null)
      return;

    const player = await this.getPlayer(playerId);

    player.unlinkAuthProvider(provider);
  }
  async unlinkAuthProviders(playerId) {
    const player = await this.getPlayer(playerId);

    for (const providerId of player.getAuthProviderLinkIds()) {
      const provider = await this._getProvider(providerId);
      this.cache.get('provider').add(providerId, provider);

      player.unlinkAuthProvider(provider);
    }
  }
  async hasAuthProviderLinks(playerId, providerIds) {
    const player = await this.getPlayer(playerId);
    const authLinks = new Map();

    for (const providerId of providerIds)
      authLinks.set(providerId, player.hasAuthProviderLink(providerId));

    return authLinks;
  }

  async queryRatedPlayers(query, myPlayerId) {
    const myPlayer = await this._getPlayer(myPlayerId);
    return this.state.identities.queryRated(query, myPlayer);
  }
  async getRatedPlayers(playerIds, myPlayerId) {
    const myPlayer = await this._getPlayer(myPlayerId);
    return this.state.identities.getRated(playerIds, myPlayer);
  }

  async getRankings() {
    return this.state.identities.getRankings();
  }
  async getRanks(rankingIds) {
    return this.state.identities.getRanks(rankingIds);
  }
  /*
   * Returns a map of ranking id to a summary of ranks.
   * The summary includes the top 3 ranks and the player's rank, if any.
   */
  async getTopRanks(rankingIds, playerId) {
    const rankings = this.state.identities.getRanks(rankingIds);

    for (const [ rankingId, ranking ] of rankings.entries())
      rankings.set(rankingId, ranking.filter(r => r.num < 4 || r.playerId === playerId));

    return rankings;
  }
  async getPlayerRanks(playerId, rankingId) {
    return this.state.identities.getPlayerRanks(playerId, rankingId);
  }

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  async _createPlayer(player) {
    player.identity = Identity.create(player);

    await Promise.all([
      this.createItem({ id:player.id, type:'player' }, player),
      this._createIdentity(player.identity),
    ]);
    this._subscribePlayer(player);
  }
  async _getPlayer(playerId) {
    const cache = this.cache.get('player');
    const buffer = this.buffer.get('player');

    if (cache.has(playerId))
      return cache.get(playerId);
    else if (buffer.has(playerId))
      return buffer.get(playerId);

    const player = await this.getItem({
      id: playerId,
      type: 'player',
      name: `player_${playerId}`,
    });
    player.identity = await this._getIdentity(player.identityId, player);

    return this._subscribePlayer(player);
  }
  async _subscribePlayer(player) {
    const buffer = this.buffer.get('player');
    const deviceBuffer = this.buffer.get('playerDevice');

    player.on('change', () => buffer.has(player.id) || buffer.add(player.id, player));
    player.on('device:change', ({ device }) => deviceBuffer.has(device.id) || deviceBuffer.add(device.id, device));

    return player;
  }
  async _savePlayer(player, { fromFile = false } = {}) {
    const ts = new Date().toISOString();
    const clone = player.cloneWithoutDevices();

    await this.putItem({
      id: player.id,
      type: 'player',
      data: clone,
      indexes: {
        GPK0: 'player',
        GSK0: `instance&${ts}`,
      },
      ttl: clone.ttl,
    });
    if (fromFile)
      await Promise.all(Array.from(player.devices.values()).map(device => this._savePlayerDevice(device)));
  }

  async _createPlayerDevice(player, device) {
    this._addPlayerDevice(player, device);

    await this.createItem({
      id: device.player.id,
      type: 'player',
      childId: device.id,
      childType: 'device',
      data: device,
      // Make sure the device is deleted before the player
      ttl: device.ttl - 7 * 86400,
    });
  }
  async _addPlayerDevice(player, device) {
    // Redundant, but prevents destroying the device if it is not in the cache
    const playerCache = this.cache.get('player');
    const deviceCache = this.cache.get('playerDevice');
    deviceCache.sync(playerCache, player.id, device.id, device);

    device.player = player;
    player.addDevice(device);
  }
  async _getAllPlayerDevices(player) {
    if (player.hasAllDevices)
      return Array.from(player.devices.values());

    const devices = await this.queryItemChildren({
      id: player.id,
      type: 'player',
      query: {
        indexValue: `device#`,
      },
    });
    devices.forEach(d => this._addPlayerDevice(player, d));
    player.hasAllDevices = true;

    return devices;
  }
  async _getPlayerDevice(player, deviceId) {
    if (player.hasAllDevices)
      return player.getDevice(deviceId);
    if (player.devices.has(deviceId))
      return player.getDevice(deviceId);

    const device = await this.getItem({
      id: player.id,
      type: 'player',
      childId: deviceId,
      childType: 'device',
    }, {}, null);
    if (device)
      this._addPlayerDevice(player, device);

    return device;
  }
  async _savePlayerDevice(device) {
    await this.putItem({
      id: device.player.id,
      type: 'player',
      childId: device.id,
      childType: 'device',
      data: device,
      // Make sure the device is deleted before the player
      ttl: device.ttl - 7 * 86400,
    });
  }
  async _removePlayerDevice(player, deviceId) {
    const device = player.getDevice(deviceId);
    if (!device)
      return;
    player.removeDevice(deviceId);

    this.cache.get('playerDevice').delete(deviceId);
    this.buffer.get('playerDevice').delete(deviceId);
    device.destroy();

    this._emit({
      type: 'player:removeDevice',
      data: { player, deviceId },
    });
    await this.deleteItem({
      id: player.id,
      type: 'player',
      childId: deviceId,
      childType: 'device',
    });
  }

  async _createIdentity(identity) {
    await this.createItem({ id:identity.id, type:'identity' }, identity);
    this._subscribeIdentity(identity);
  }
  async _getIdentity(identityId, player = null) {
    const cache = this.cache.get('identity');
    const buffer = this.buffer.get('identity');

    if (cache.has(identityId))
      return cache.get(identityId);
    else if (buffer.has(identityId))
      return buffer.get(identityId);

    const identity = await this.getItem({
      id: identityId,
      type: 'identity',
      name: `identity_${identityId}`,
    }, {}, () => player ? Identity.create(player) : undefined);
    identity.pruneRanks(this.gameTypes);

    return this._subscribeIdentity(identity);
  }
  async _saveIdentity(identity) {
    identity.once('change', () => this.buffer.get('identity').add(identity.id, identity));

    await this.putItem({
      id: identity.id,
      type: 'identity',
      data: identity,
      // Make sure the identity is deleted after the player
      ttl: identity.ttl + 7 * 86400,
    });
  }
  async _deleteIdentity(identity) {
    const cache = this.cache.get('identity');
    const buffer = this.buffer.get('identity');

    if (cache.has(identity.id))
      cache.delete(identity.id);
    if (buffer.has(identity.id))
      buffer.delete(identity.id);
    identity.destroy();

    await this.deleteItem({ id:identity.id, type:'identity' });
  }
  _subscribeIdentity(identity) {
    const identities = this.state.identities;
    const cache = this.cache.get('identity');
    const buffer = this.buffer.get('identity');

    identity.once('change', () => buffer.add(identity.id, identity));
    identity.on('change:lastSeenAt', () => {
      identities.add(identity);
      cache.add(identity.id, identity, identity.expireAt);
    });

    return identity;
  }

  async _getProvider(providerId) {
    const cache = this.cache.get('provider');
    const buffer = this.buffer.get('provider');

    if (cache.has(providerId))
      return cache.get(providerId);
    else if (buffer.has(providerId))
      return buffer.get(providerId);

    const provider = await this.getItem({
      id: providerId,
      type: 'provider',
      name: `provider_${providerId}`,
    }, {}, () => Provider.create(providerId));

    provider.once('change', () => buffer.add(providerId, provider));
    return provider;
  }
  async _saveProvider(provider) {
    provider.once('change', () => this.buffer.get('provider').add(provider.id, provider));

    await this.putItem({
      id: provider.id,
      type: 'provider',
      data: provider,
    });
  }

  /*
   * Not intended for use by applications.
   */
  async *listAllPlayerIds(since = null) {
    const children = this._query({
      indexName: 'GPK0-GSK0',
      attributes: [ 'PK' ],
      filters: {
        GPK0: 'player',
        GSK0: since
          ? { gt:`instance&${since.toISOString()}` }
          : { beginsWith:`instance&` },
      },
    });

    for await (const child of children)
      yield child.PK.slice(7);
  }
  listAllIdentityIds() {
    throw new Error('Not implemented');
  }
};
