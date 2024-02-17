import fs from 'fs';

import serializer from '#utils/serializer.js';
import FileAdapter from '#data/FileAdapter.js';
import migrate, { getLatestVersionNumber } from '#data/migrate.js';

import Identities from '#models/Identities.js';
import Identity from '#models/Identity.js';
import Player from '#models/Player.js';
import Provider from '#models/Provider.js';

export default class extends FileAdapter {
  constructor(options = {}) {
    super({
      name: 'auth',
      state: {},
      hasState: options.hasState ?? true,
      fileTypes: new Map([
        [
          'player', {
            saver: '_savePlayer',
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

    identities.setValues(await Promise.all(identities.getIds().map(iId => this._getIdentity(iId))));
    for (const identity of identities.values())
      cache.add(identity.id, identity, identity.expireAt)

    Player.identities = this.state.identities;

    return this;
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  async createPlayer(player) {
    if (!(player instanceof Player))
      player = Player.create(player);

    await this._createPlayer(player);
    this.cache.get('player').add(player.id, player);
    this.cache.get('identity').add(player.identityId, player.identity);
    return player;
  }
  async openNewPlayer(player) {
    await this._createPlayer(player);
    this.cache.get('player').open(player.id, player);
    this.cache.get('identity').open(player.identityId, player.identity);
  }
  async openPlayer(playerId) {
    const player = await this._getPlayer(playerId);
    this.cache.get('player').open(playerId, player);
    this.cache.get('identity').open(player.identityId, player.identity);
    return player;
  }
  closePlayer(playerId) {
    const player = this.cache.get('player').close(playerId);
    const expireAt = new Date(Math.max(this.cache.get('player').getExpireAt(playerId), player.identity.expireAt));
    this.cache.get('identity').close(player.identityId, expireAt);
    return player;
  }
  async getPlayer(playerId) {
    const player = await this._getPlayer(playerId);
    this.cache.get('player').add(playerId, player);
    this.cache.get('identity').add(player.identityId, player.identity);
    return player;
  }
  getOpenPlayer(playerId) {
    return this.cache.get('player').getOpen(playerId);
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

    for (const providerId of providerIds) {
      authLinks.set(providerId, player.hasAuthProviderLink(providerId));
    }

    return authLinks;
  }

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  async _createPlayer(player) {
    const buffer = this.buffer.get('player');

    player.identity = Identity.create(player);

    await Promise.all([
      this.createFile(`player_${player.id}`, () => {
        const data = serializer.transform(player);
        data.version = getLatestVersionNumber('player');

        player.once('change', () => buffer.add(player.id, player));
        return data;
      }),
      this._createIdentity(player.identity),
    ]);
  }
  async _getPlayer(playerId) {
    const cache = this.cache.get('player');
    const buffer = this.buffer.get('player');

    if (cache.has(playerId))
      return cache.get(playerId);
    else if (buffer.has(playerId))
      return buffer.get(playerId);

    return this.getFile(`player_${playerId}`, async data => {
      if (data === undefined) return;

      const player = serializer.normalize(migrate('player', data));

      player.identity = await this._getIdentity(player.identityId, player);

      player.once('change', event => buffer.add(playerId, player));
      player.on('change:removeDevice', event => this._emit({
        type: 'player:removeDevice',
        data: { player, deviceId:event.data.deviceId },
      }));
      return player;
    });
  }
  async _savePlayer(player) {
    const buffer = this.buffer.get('player');

    await this.putFile(`player_${player.id}`, () => {
      const data = serializer.transform(player);
      data.version = getLatestVersionNumber('player');

      player.once('change', () => buffer.add(player.id, player));
      return data;
    });
  }

  async _createIdentity(identity) {
    await this.createFile(`identity_${identity.id}`, () => {
      const data = serializer.transform(identity);
      data.version = getLatestVersionNumber('identity');

      this._subscribeIdentity(identity);
      return data;
    });
  }
  async _getIdentity(identityId, player = null) {
    const cache = this.cache.get('identity');
    const buffer = this.buffer.get('identity');

    if (cache.has(identityId))
      return cache.get(identityId);
    else if (buffer.has(identityId))
      return buffer.get(identityId);

    return this.getFile(`identity_${identityId}`, data => {
      if (data === undefined && player === null) return;

      const identity = data === undefined
        ? Identity.create(player)
        : serializer.normalize(migrate('identity', data));

      return this._subscribeIdentity(identity);
    });
  }
  async _saveIdentity(identity) {
    const buffer = this.buffer.get('identity');

    await this.putFile(`identity_${identity.id}`, () => {
      const data = serializer.transform(identity);
      data.version = getLatestVersionNumber('identity');

      identity.once('change', () => buffer.add(identity.id, identity));
      return data;
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

    await this.deleteFile(`identity_${identity.id}`);
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

    return this.getFile(`provider_${providerId}`, data => {
      const provider = data === undefined
        ? Provider.create(providerId)
        : serializer.normalize(migrate('provider', data));

      provider.once('change', () => buffer.add(providerId, provider));
      return provider;
    });
  }
  async _saveProvider(provider) {
    const buffer = this.buffer.get('provider');

    await this.putFile(`provider_${provider.id}`, () => {
      const data = serializer.transform(provider);

      provider.once('change', () => buffer.add(provider.id, provider));
      return data;
    });
  }

  /*
   * Only used for testing right now.
   */
  async deletePlayer(playerId) {
    await this.deleteFile(`player_${playerId}`);
    //await this.deleteFile(`player_${playerId}_sets`);
    //await this.deleteFile(`player_${playerId}_games`);
    //await this.deleteFile(`identity_${player.identityId}`);
    // Also need to delete all other players in this identity.
  }

  /*
   * Not intended for use by applications.
   */
  listAllPlayerIds() {
    return new Promise((resolve, reject) => {
      const playerIds = [];
      const regex = /^player_(.{8}-.{4}-.{4}-.{4}-.{12})\.json$/;

      fs.readdir(this.filesDir, (err, fileNames) => {
        for (let i=0; i<fileNames.length; i++) {
          const match = regex.exec(fileNames[i]);
          if (!match) continue;

          playerIds.push(match[1]);
        }

        resolve(playerIds);
      });
    });
  }
  listAllIdentityIds() {
    return new Promise((resolve, reject) => {
      const identityIds = [];
      const regex = /^identity_(.{8}-.{4}-.{4}-.{4}-.{12})\.json$/;

      fs.readdir(this.filesDir, (err, fileNames) => {
        for (let i=0; i<fileNames.length; i++) {
          const match = regex.exec(fileNames[i]);
          if (!match) continue;

          identityIds.push(match[1]);
        }

        resolve(identityIds);
      });
    });
  }

  async archivePlayer(playerId) {
    try {
      const filesToArchive = [ `player_${playerId}` ];

      const player = await this._getPlayer(playerId);
      if (player.identity.playerIds.length === 1)
        filesToArchive.push(`identity_${player.identityId}`);
      else
        player.identity.deletePlayerId(playerId);

      await Promise.all(filesToArchive.map(f => this.archiveFile(f)));
    } catch (e) {
      if (e.message.startsWith('Corrupt:'))
        await this.deleteFile(`player_${playerId}`);
      else
        throw e;
    }
  }
};
