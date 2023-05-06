import fs from 'fs';

import serializer from 'utils/serializer.js';
import FileAdapter from 'data/FileAdapter.js';
import migrate, { getLatestVersionNumber } from 'data/migrate.js';
import Player from 'models/Player.js';
import AuthMembers from 'models/AuthMembers.js';

export default class extends FileAdapter {
  constructor() {
    super({
      name: 'auth',
      fileTypes: new Map([
        [
          'player', {
            saver: '_savePlayer',
          },
        ],
        [
          'authMembers', {
            saver: '_saveAuthMembers',
          },
        ],
      ]),
    });
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  async createPlayer(player) {
    if (!(player instanceof Player))
      player = Player.create(player);

    await this._createPlayer(player);
    this.cache.get('player').add(player.id, player);
    return player;
  }
  async openNewPlayer(player) {
    await this._createPlayer(player);
    this.cache.get('player').open(player.id, player);
  }
  async openPlayer(playerId) {
    const player = await this._getPlayer(playerId);
    return this.cache.get('player').open(playerId, player);
  }
  closePlayer(playerId) {
    return this.cache.get('player').close(playerId);
  }
  async getPlayer(playerId) {
    const player = await this._getPlayer(playerId);
    return this.cache.get('player').add(playerId, player);
  }
  getOpenPlayer(playerId) {
    return this.cache.get('player').getOpen(playerId);
  }

  async linkAuthPlayerId(provider, memberId, playerId) {
    const members = await this._getAuthMembers(provider);
    this.cache.get('authMembers').add(provider, members);
    members.setPlayerId(memberId, playerId);
  }
  async getAuthPlayerId(provider, memberId) {
    const members = await this._getAuthMembers(provider);
    this.cache.get('authMembers').add(provider, members);
    return members.getPlayerId(memberId);
  }
  async unlinkAuthProvider(provider, memberId) {
    const members = await this._getAuthMembers(provider);
    this.cache.get('authMembers').add(provider, members);
    members.deletePlayerId(memberId);
  }
  async unlinkAuthProviders(playerId, providers) {
    for (const provider of providers) {
      const members = await this._getAuthMembers(provider);
      this.cache.get('authMembers').add(provider, members);
      members.deleteMemberId(playerId);
    }
  }
  async hasAuthProviderLinks(playerId, providers) {
    const authLinks = new Map();

    for (const provider of providers) {
      const members = await this._getAuthMembers(provider);
      this.cache.get('authMembers').add(provider, members);

      authLinks.set(provider, members.hasMemberId(playerId));
    }

    return authLinks;
  }

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  async _createPlayer(player) {
    const buffer = this.buffer.get('player');

    await this.createFile(`player_${player.id}`, () => {
      const data = serializer.transform(player);
      data.version = getLatestVersionNumber('player');

      player.once('change', () => buffer.add(player.id, player));
      return data;
    });
  }
  async _getPlayer(playerId) {
    const cache = this.cache.get('player');
    const buffer = this.buffer.get('player');

    if (cache.has(playerId))
      return cache.get(playerId);
    else if (buffer.has(playerId))
      return buffer.get(playerId);

    return this.getFile(`player_${playerId}`, data => {
      if (data === undefined) return;

      const player = serializer.normalize(migrate('player', data));

      player.once('change', () => buffer.add(playerId, player));
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

  async _getAuthMembers(provider) {
    const cache = this.cache.get('authMembers');
    const buffer = this.buffer.get('authMembers');

    if (cache.has(provider))
      return cache.get(provider);
    else if (buffer.has(provider))
      return buffer.get(provider);

    return this.getFile(`${provider}_members`, data => {
      const members = data === undefined
        ? AuthMembers.create(provider)
        : serializer.normalize(data);

      members.once('change', () => buffer.add(provider, members));
      members.on('change:link', async ({ data }) => {
        const player = await this.getPlayer(data.playerId);
        player.log('link', { provider, ...data });
      });
      members.on('change:unlink', async ({ data }) => {
        const player = await this.getPlayer(data.playerId);
        player.log('unlink', { provider, ...data });
      });
      return members;
    });
  }
  async _saveAuthMembers(members) {
    const buffer = this.buffer.get('authMembers');

    await this.putFile(`${members.provider}_members`, () => {
      const data = serializer.transform(members);

      members.once('change', () => buffer.add(members.provider, members));
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
};
