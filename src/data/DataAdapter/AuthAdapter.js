import fs from 'fs';

import serializer from 'utils/serializer.js';
import {redisDB, RedisAdapter} from 'data/RedisAdapter.js';
import migrate, { getLatestVersionNumber } from 'data/migrate.js';


export default class extends RedisAdapter {
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
  async getPlayerID({fbid, discordid}){
    const playerid = await this._getPlayerID({fbid, discordid});
    return playerid ? this.openPlayer(playerid): null;
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

    await this.createFile(`player:${player.id}`, () => {
      const data = serializer.transform(player);
      data.version = getLatestVersionNumber('player');
      data.fbid = player.data.fbid; 
      player.once('change', () => this._savePlayer(player));
      return data;
    });
  }
   _getPlayerID({fbid, discordid}){
    if(fbid){
     
      return this.getPlayerIDFromFB(fbid)
    }
    else if(discordid){
      return this.getPlayerIDFromDC(discordid);
    }
  }
  async _getPlayer(playerId) {
    const cache = this.cache.get('player');
    if (cache.has(playerId))
      return cache.get(playerId);
  
      return this.getFile(`player:${playerId}`, data => {
      const player = serializer.normalize(migrate('player', data));

      player.once('change', () => this._savePlayer(player));
      return player;
    });
  }
  async _savePlayer(player) {
    

    await this.putFile(`player:${player.id}`, () => {
      const data = serializer.transform(player);
      data.version = getLatestVersionNumber('player');

      player.once('change', () => this._savePlayer( player));
      return data;
    });
  }

  /*
   * Only used for testing right now.
   */
  async deletePlayer(playerId) {
    await this.deleteFile(`player:${playerId}`);
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
