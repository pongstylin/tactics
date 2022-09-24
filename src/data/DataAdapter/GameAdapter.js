import fs from 'fs';
import util from 'util';

import migrate, { getLatestVersionNumber } from 'data/migrate.js';
import serializer from 'utils/serializer.js';

import Timeout from 'server/Timeout.js';

import GameType from 'tactics/GameType.js';
import Game from 'models/Game.js';
import GameSummary from 'models/GameSummary.js';
import GameSummaryList from 'models/GameSummaryList.js';
import PlayerStats from 'models/PlayerStats.js';
import PlayerSets from 'models/PlayerSets.js';
import ServerError from 'server/Error.js';
import {RedisAdapter, redisDB} from 'data/RedisAdapter.js';


export default class extends RedisAdapter {
  
  constructor() {
    super({
      name: 'game',
      fileTypes: new Map([
        [
          'game', {
            saver: '_saveGame',
          },
        ],
        [
          'playerStats', {
            saver: '_savePlayerStats',
          },
        ],
        [
          'playerSets', {
            saver: '_savePlayerSets',
          },
        ],
        [
          'playerGames', {
            saver: '_savePlayerGames',
          },
        ],
        [
          'collection', {
            saver: '_saveGameCollection',
          },
        ],
      ]),

      _gameTypes: null,
      _autoSurrender: null,

      _dirtyGames: new Map(),
      _syncingPlayerGames: new Map(),
    });
  }
  

  async bootstrap() {
    this._gametypes = await this.getGameTypes();
  
     let autoSurrender={};
    await redisDB.get("timeouts").then(res=>{  autoSurrender = new Map(Object.entries(serializer.parse(res)));});
     
     if(!autoSurrender.timeout)
     autoSurrender.timeout=new Timeout(`${this.name}AutoSurrender`);
    this._autoSurrender = autoSurrender.timeout.on('expire', async ({ data:items }) => {
      const games = await Promise.all(
        [ ...items.values() ].map(({ id:gameId }) => this._getGame(gameId)),
      );
      for (const game of games) {
        // Just in case they finished their turn at the very last moment.
        if (game.state.getTurnTimeRemaining() > 0)
          continue;

        if (game.state.actions.length)
          game.state.submitAction({
            type: 'endTurn',
            forced: true,
          });
        else
          game.state.submitAction({
            type: 'surrender',
            declaredBy: 'system',
          });
      }
    });

    /*
     * If the server was shut down for more than 30 seconds, end real-time
     * games in a truce.
     */
    if (Date.now() - autoSurrender.shutdownAt > 30000) {
      autoSurrender.timeout.pause();

      const games = await Promise.all(
        autoSurrender.timeout.values()
          .filter(({ turnTimeBuffer }) => !!turnTimeBuffer)
          .map(({ id:gameId }) => this._getGame(gameId)),
      );

      for (const game of games) {
        game.state.end('truce');
        game.emit('change:cleanup');
      }

      autoSurrender.timeout.resume();
    }

    return super.bootstrap();

  }
async getGameTypes(){ 
  let gt = new Map();
  let gts = JSON.parse(await redisDB.get("gametypes"));
  
  gts.forEach((gametyp)=>{
    gt.set(gametyp[0], new GameType({ id:gametyp[0], config:gametyp[1] }));
    ;})
  
  return gt;
}
  async cleanup() {
    const autoSurrender = this._autoSurrender.pause();

    /*
     * In the hopes that the server will restart quickly, set team turn time
     * buffers to max.
     */
    const games = await Promise.all(
      autoSurrender.values()
        .filter(({ turnTimeBuffer }) => !!turnTimeBuffer)
        .map(({ id:gameId }) => this._getGame(gameId)),
    );

    for (const game of games) {
      for (const team of game.state.teams) {
        team.turnTimeBuffer = game.state.turnTimeBuffer;
      }
      game.emit('change:cleanup');
    }

    await this.putFile(`timeout/autoSurrender`, () =>
      serializer.transform({
        timeout: this._autoSurrender,
        shutdownAt: new Date(),
      })
    );

    return super.cleanup();
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  hasGameType(gameTypeId) {
    return this._gameTypes.has(gameTypeId);
  }
  async getGameType(gameTypeId) {
  
    if (!this._gametypes.has(gameTypeId))
      throw new ServerError(404, 'No such game type');
    return await this._gametypes.get(gameTypeId);
   }  

  /*
   * This opens the player's game and set list.
   */
  async openPlayer(playerId) {
    const playerStats = await this._getPlayerStats(playerId);
    this.cache.get('playerStats').open(playerId, playerStats);

    const playerGames = await this._getPlayerGames(playerId);
    this.cache.get('playerGames').open(playerId, playerGames);

    const playerSets = await this._getPlayerSets(playerId);
    this.cache.get('playerSets').open(playerId, playerSets);
  }
  closePlayer(playerId) {
    this.cache.get('playerStats').close(playerId);
    this.cache.get('playerGames').close(playerId);
    this.cache.get('playerSets').close(playerId);
  }

  async openPlayerGames(playerId) {
    const playerGames = await this._getPlayerGames(playerId);
    return this.cache.get('playerGames').open(playerId, playerGames);
  }
  closePlayerGames(playerId) {
    return this.cache.get('playerGames').close(playerId);
  }

  async openGameCollection(collectionId) {
    const collection = await this._getGameCollection(collectionId);
    return this.cache.get('collection').open(collectionId, collection);
  }
  closeGameCollection(collectionId) {
    return this.cache.get('collection').close(collectionId);
  }
  async getGameCollection(collectionId) {
    const collection = await this._getGameCollection(collectionId);
    return this.cache.get('collection').add(collectionId, collection);
  }

  async getPlayerStats(myPlayerId, vsPlayerId) {
    const playerStats = await this._getPlayerStats(myPlayerId);

    this.cache.get('playerStats').add(myPlayerId, playerStats);
    return playerStats.get(vsPlayerId);
  }
  async listPlayerAliases(inPlayerId, forPlayerId) {
    const playerStats = await this._getPlayerStats(inPlayerId);

    this.cache.get('playerStats').add(inPlayerId, playerStats);
    return playerStats.get(forPlayerId).aliases;
  }
  async clearPlayerWLDStats(myPlayerId, vsPlayerId, gameTypeId) {
    const playerStats = await this._getPlayerStats(myPlayerId);

    this.cache.get('playerStats').add(myPlayerId, playerStats);
    return playerStats.clearWLDStats(vsPlayerId, gameTypeId);
  }

  async createGame(game) {
    await this._createGame(game);
    this.cache.get('game').add(game.id, game);
  }
  async openGame(gameId) {
    const game = await this._getGame(gameId);
    return this.cache.get('game').open(gameId, game);
  }
  getOpenGames() {
    return this.cache.get('game').openValues();
  }
  closeGame(gameId) {
    return this.cache.get('game').close(gameId);
  }
  async getGame(gameId) {
    const game = await this._getGame(gameId);
    return this.cache.get('game').add(gameId, game);
  }
  getOpenGame(gameId) {
    return this.cache.get('game').getOpen(gameId);
  }

  async hasCustomPlayerSet(playerId, gameTypeId, setName) {
    const playerSets = await this._getPlayerSets(playerId);
    return playerSets.hasDefault(gameTypeId, setName);
  }
  /*
   * The server may potentially store more than one set, typically one set per
   * game type.  The default set is simply the first one for a given game type.
   */
  async getPlayerSet(playerId, gameType, setName) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(playerId);
    return playerSets.getDefault(gameType, setName);
  }
  /*
   * Setting the default set for a game type involves REPLACING the first set
   * for a given game type.
   */
  async setPlayerSet(playerId, gameType, setName, set) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(playerId);
    playerSets.setDefault(gameType, setName, set);
  }

  async searchPlayerGames(player, query) {
    const playerGames = await this._getPlayerGames(player.id);
    const data = [...playerGames.values()];

    return this._search(data, query);
  }
  async searchGameCollection(player, group, query) {
    const collection = await this._getGameCollection(group);
    const blockedBy = player.listBlockedBy();
    const data = serializer.clone([ ...collection.values() ])
      .filter(gs => {
        gs.creatorACL = player.getPlayerACL(gs.createdBy);
        return gs.startedAt || !blockedBy.has(gs.createdBy);
      });

    return this._search(data, query);
  }

  async listMyTurnGamesSummary(myPlayerId) {
    const games = await this._getPlayerGames(myPlayerId, true);

    const myTurnGames = [];
    for (const game of games.values()) {
      // Only active games, please.
      if (!game.startedAt || game.endedAt)
        continue;
      // Must be my turn
      if (game.teams[game.currentTeamId].playerId !== myPlayerId)
        continue;
      // Practice games don't count
      if (!game.teams.find(t => t.playerId !== myPlayerId))
        continue;

      myTurnGames.push(game);
    }

    return myTurnGames;
  }

  async surrenderPendingGames(myPlayerId, vsPlayerId) {
    const gamesSummary = await this._getPlayerGames(myPlayerId);

    for (const gameSummary of gamesSummary.values()) {
      if (!gameSummary.startedAt || gameSummary.endedAt)
        continue;
      if (gameSummary.teams.findIndex(t => t.playerId === vsPlayerId) === -1)
        continue;

      const game = await this._getGame(gameSummary.id);
      game.state.submitAction({
        type: 'surrender',
        declaredBy: myPlayerId,
      });
    }
  }

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  /*
   * Game Management
   */
  async _createGame(game) {
    await this.createFile(`game_${game.id}`, () => {
      const data = serializer.transform(game);
      data.version = getLatestVersionNumber('game');

      this._attachGame(game);
      return data;
    });
    await this._updateGameSummary(game);
    if (game.state.startedAt) {
      await this._recordGameStats(game);
      this._syncAutoSurrender(game);
    }
  }
  async _getGame(gameId) {
    if (this.cache.get('game').has(gameId))
      return this.cache.get('game').get(gameId);
   

    return this.getFile(`game_${gameId}`, data => {
      if (data === undefined) return;

      const game = serializer.normalize(migrate('game', data));
      this._attachGame(game);

      return game;
    });
  }
  _attachGame(game) {
    game.on('change', event => this._onGameChange(game));
    game.on('delete', event => this._onGameDelete(game));
    if (!game.state.startedAt)
      game.state.once('startGame', event => this._recordGameStats(game));
    if (!game.state.endedAt)
      game.state.once('endGame', event => this._recordGameStats(game));
  }
  _onGameChange(game) {
    
    this._updateGameSummary(game);
    if (game.state.startedAt)
      this._syncAutoSurrender(game);
  }
  async _onGameDelete(game) {
    if (this._dirtyGames.has(game.id))
      await this._dirtyGames.get(game.id);

    this.cache.get('game').delete(game.id);
    
    game.destroy();

    this._clearGameSummary(game);
    this.deleteFile(`game_${game.id}`);
  }
  async _recordGameStats(game) {
    const playerIds = new Set([ ...game.state.teams.map(t => t.playerId) ]);
    if (playerIds.size === 1) return;

    for (const playerId of playerIds) {
      const playerStats = await this._getPlayerStats(playerId);
      if (game.state.endedAt)
        playerStats.recordGameEnd(game);
      else
        playerStats.recordGameStart(game);
    }
  }
  async _saveGame(game) {
    await this.putFile(`game_${game.id}`, () => {
      const data = serializer.transform(game);
      data.version = getLatestVersionNumber('game');

      return data;
    });
  }

  /*
   * Game Summary Management
   *
   * A game object can change multiple times in quick succession.  Since the
   * game summary can take some time to compute asynchronously, we use the
   * 'dirtyGames' property to avoid redundant updates.
   *
   * When a game object changes, the game summary is *eventually* consistent.
   * However, sometimes we may want to wait until it IS consistent.  For this
   * reason, we maintain the 'syncingPlayerGames' property.
   */
  _updateGameSummary(game) {
    const dirtyGames = this._dirtyGames;
    if (dirtyGames.has(game.id))
      return;

    const syncingPlayerGames = this._syncingPlayerGames;
    // Get a unique list of player IDs from the teams.
    const playerIds = new Set(
      game.state.teams.filter(t => !!t?.playerId).map(t => t.playerId)
    );
    const promises = [];

    for (const playerId of playerIds) {
      if (syncingPlayerGames.has(playerId)) {
        syncingPlayerGames.get(playerId).count++;
      } else {
        const sync = { count:1 };
        sync.promise = new Promise(resolve => sync.resolve = resolve);
        syncingPlayerGames.set(playerId, sync);
      }

      promises.push(
        this._getPlayerGames(playerId).then(playerGames => {
          // Normally, player games are cached when a player authenticates.
          // But if only one player in this game is online, then we may need
          // to add the other player's games to the cache.
          this.cache.get('playerGames').add(playerGames.id, playerGames);

          return playerGames;
        }),
      );
    }

    if (game.collection)
      promises.push(
        this._getGameCollection(game.collection).then(collection => {
          if (game.state.endedAt && game.state.currentTurnId < 4) {
            collection.delete(game.id);
            return;
          }

          return collection;
        }),
      );
      
    const promise = Promise.all(promises).then((gameSummaryLists) => {
     
     
      const gameType = this._gametypes.get(game.state.type) ;
      const summary = GameSummary.create(gameType, game);
      dirtyGames.delete(game.id);

      for (const gameSummaryList of gameSummaryLists) {
        if (!gameSummaryList) continue;

        // Avoid adding and immediately removing a game to the main list.
        if (game.state.startedAt) {
          const clone = serializer.clone(gameSummaryList);
          clone.set(game.id, summary);
          this._pruneGameSummaryList(clone);

          if (clone.has(game.id)) {
            gameSummaryList.set(game.id, summary);
            if (game.state.endedAt)
              this._pruneGameSummaryList(gameSummaryList);
          } else if (gameSummaryList.has(game.id))
            gameSummaryList.delete(game.id);
        } else
          gameSummaryList.set(game.id, summary);

        if (syncingPlayerGames.has(gameSummaryList.id)) {
          const sync = syncingPlayerGames.get(gameSummaryList.id);

          if (sync.count === 1) {
            syncingPlayerGames.delete(gameSummaryList.id);
            sync.resolve(gameSummaryList);
          } else {
            sync.count--;
          }
        }
      }
    });

    dirtyGames.set(game.id, promise);
    return promise;
  }
  async _clearGameSummary(game) {
    // Get a unique list of player IDs from the teams.
    const playerIds = new Set(
      game.state.teams.filter(t => !!t?.playerId).map(t => t.playerId)
    );

    const promises = [...playerIds].map(playerId =>
      this._getPlayerGames(playerId)
    );

    if (game.collection)
      promises.push(this._getGameCollection(game.collection));

    return Promise.all(promises).then(gameSummaryLists => {
      for (const gameSummaryList of gameSummaryLists) {
        gameSummaryList.delete(game.id);
      }
    });
  }
  /*
   * Prune completed games to 100 most recently ended.
   * Prune active games with expired time limits (collections only)
   */
  _pruneGameSummaryList(gameSummaryList) {
    // Hacky
    const isCollectionList = !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(gameSummaryList.id);
    const now = Date.now();

    const completed = [];
    for (const gameSummary of gameSummaryList.values()) {
      if (gameSummary.endedAt)
        completed.push(gameSummary);
      else if (gameSummary.startedAt && isCollectionList) {
        if (!gameSummary.turnTimeLimit)
          gameSummaryList.delete(gameSummary.id);
        else if (gameSummary.getTurnTimeRemaining(now) === 0)
          gameSummaryList.delete(gameSummary.id);
      }
    }
    completed.sort((a,b) => b.endedAt - a.endedAt);

    if (completed.length > 100)
      for (const gameSummary of completed.slice(100)) {
        gameSummaryList.delete(gameSummary.id);
      }
  }

  _syncAutoSurrender(game) {
    if (!game.state.autoSurrender)
      return;

    if (game.state.endedAt)
      this._autoSurrender.delete(game.id);
    else
      this._autoSurrender.add(game.id, {
        id: game.id,
        turnTimeBuffer: game.state.turnTimeBuffer,
      }, game.state.getTurnTimeRemaining());
  }

  /*
   * Player Stats Management
   */
  async _getPlayerStats(playerId) {
    if (this.cache.get('playerStats').has(playerId))
      return this.cache.get('playerStats').get(playerId);
    
    return this.getFile(`player_${playerId}_stats`, data => {
      
      const playerStats = data === null
        ? PlayerStats.create(playerId)
        : serializer.normalize(migrate('stats', data, { playerId }));

      //playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));
      return playerStats;
    });
  }
  async _savePlayerStats(playerStats) {
    const playerId = playerStats.playerId;

    await this.putFile(`player_${playerId}_stats`, () => {
      const data = serializer.transform(playerStats);
      data.version = getLatestVersionNumber('stats');

      //playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));
      return data;
    });
  }

  /*
   * Player Games Management
   */
  async _getPlayerGames(playerId, consistent = false) {
    if (consistent) {
      const sync = this._syncingPlayerGames.get(playerId);
      if (sync)
        return sync.promise;
    }

    if (this.cache.get('playerGames').has(playerId))
      return this.cache.get('playerGames').get(playerId);
   

    return this.getFile(`player_${playerId}_games`, data => {
     
      const playerGames = data === null
        ? GameSummaryList.create(playerId)
        : serializer.normalize(data);

     // playerGames.once('change', () => this.buffer.get('playerGames').add(playerId, playerGames));
      return playerGames;
    });
  }
  async _savePlayerGames(playerGames) {
    const playerId = playerGames.id;

    await this.putFile(`player_${playerId}_games`, () => {
      const data = serializer.transform(playerGames);

     // playerGames.once('change', () => this.buffer.get('playerGames').add(playerId, playerGames));
      return data;
    });
  }

  /*
   * Player Sets Management
   */
  async _getPlayerSets(playerId) {
    if (this.cache.get('playerSets').has(playerId))
      return this.cache.get('playerSets').get(playerId);
  

    return this.getFile(`player_${playerId}_sets`, data => {
      const playerSets = data === null
        ? PlayerSets.create(playerId)
        : serializer.normalize(migrate('sets', data, { playerId }));

      //playerSets.once('change', () => this.buffer.get('playerSets').add(playerId, playerSets));
      return playerSets;
    });
  }
  async _savePlayerSets(playerSets) {
    const playerId = playerSets.playerId;

    await this.putFile(`player_${playerId}_sets`, () => {
      const data = serializer.transform(playerSets);
      data.version = getLatestVersionNumber('sets');

      //playerSets.once('change', () => this.buffer.get('playerSets').add(playerId, playerSets));
      return data;
    });
  }

  /*
   * Game Collection Management
   */
  async _getGameCollection(collectionId) {
    if (this.cache.get('collection').has(collectionId))
      return this.cache.get('collection').get(collectionId);
    
    return this.getFile(`collection/${collectionId}`, data => {
      const collection = data === null
        ? GameSummaryList.create(collectionId)
        : serializer.normalize(data);

     // collection.once('change', () => this.buffer.get('collection').add(collectionId, collection));
      return collection;
    });
  }
  async _saveGameCollection(collection) {
    const collectionId = collection.id;

    await this.putFile(`collection/${collectionId}`, () => {
      const data = serializer.transform(collection);

     // collection.once('change', () => this.buffer.get('collection').add(collectionId, collection));
      return data;
    });
  }

  /*****************************************************************************
   * Not intended for use by application.
   ****************************************************************************/
  listAllGameIds() {
    return new Promise((resolve, reject) => {
      const gameIds = [];
      const regex = /^game_(.{8}-.{4}-.{4}-.{4}-.{12})\.json$/;

      fs.readdir(this.filesDir, (err, fileNames) => {
        for (let i=0; i<fileNames.length; i++) {
          let match = regex.exec(fileNames[i]);
          if (!match) continue;

          gameIds.push(match[1]);
        }

        resolve(gameIds);
      });
    });
  }
};
