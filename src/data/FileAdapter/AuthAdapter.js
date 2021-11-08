import fs from 'fs';

import FileAdapter from 'data/FileAdapter.js';
import migrate, { getLatestVersionNumber } from 'data/migrate.js';
import Player from 'models/Player.js';

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
      ]),
    });
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  async createPlayer(player) {
    await this._createPlayer(player);
    this.cache.get('player').add(player.id, player);
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

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  async _createPlayer(player) {
    const buffer = this.buffer.get('player');

    player.version = getLatestVersionNumber('player');

    await this.createFile(`player_${player.id}`, () => {
      player.once('change', () => buffer.add(player.id, player));
      return player;
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
      const player = Player.load(migrate('player', data));
      player.once('change', () => buffer.add(playerId, player));
      return player;
    });
  }
  async _savePlayer(player) {
    const buffer = this.buffer.get('player');

    await this.putFile(`player_${player.id}`, () => {
      player.once('change', () => buffer.add(player.id, player));
      return player;
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
