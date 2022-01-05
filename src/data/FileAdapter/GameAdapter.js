import fs from 'fs';
import util from 'util';

import serializer from 'utils/serializer.js';
import FileAdapter from 'data/FileAdapter.js';
import migrate, { getLatestVersionNumber } from 'data/migrate.js';

import GameType from 'tactics/GameType.js';
import Game from 'models/Game.js';
import GameSummary from 'models/GameSummary.js';
import GameSummaryList from 'models/GameSummaryList.js';
import PlayerStats from 'models/PlayerStats.js';
import PlayerSets from 'models/PlayerSets.js';
import ServerError from 'server/Error.js';

export default class extends FileAdapter {
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

      // Lazy loaded and cached forever
      _gameTypes: null,

      _dirtyGames: new Map(),
      _syncingPlayerGames: new Map(),
    });
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  async hasGameType(gameTypeId) {
    const gameTypes = await this._getGameTypes();
    return gameTypes.has(gameTypeId);
  }
  async getGameType(gameTypeId) {
    const gameTypes = await this._getGameTypes();
    if (!gameTypes.has(gameTypeId))
      throw new ServerError(404, 'No such game type');

    return gameTypes.get(gameTypeId);
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
  async cancelGame(game) {
    if (this._dirtyGames.has(game.id))
      await this._dirtyGames.get(game.id);

    if (game.state.startedAt)
      throw new ServerError(409, 'Game already started');

    this.cache.get('game').delete(game.id);
    this.buffer.get('game').delete(game.id);
    game.destroy();

    await this._deleteGame(game);
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
      gameType = await this.getGameType(gameType);

    const playerSets = await this._getPlayerSets(playerId);
    return playerSets.getDefault(gameType, setName);
  }
  /*
   * Setting the default set for a game type involves REPLACING the first set
   * for a given game type.
   */
  async setPlayerSet(playerId, gameType, setName, set) {
    if (typeof gameType === 'string')
      gameType = await this.getGameType(gameType);

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
  async _getGameTypes() {
    if (!this._gameTypes)
      this._gameTypes = await this.getFile('game_types', data => {
        const gameTypes = new Map();
        for (const [ id, config ] of data) {
          gameTypes.set(id, serializer.normalize({
            type: 'GameType',
            data: { id, config },
          }));
        }

        return gameTypes;
      });

    return this._gameTypes;
  }

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
    await this._recordGameStats(game);
    await this._updateGameSummary(game);
  }
  async _getGame(gameId) {
    if (this.cache.get('game').has(gameId))
      return this.cache.get('game').get(gameId);
    else if (this.buffer.get('game').has(gameId))
      return this.buffer.get('game').get(gameId);

    return this.getFile(`game_${gameId}`, data => {
      if (data === undefined) return;

      const game = serializer.normalize(migrate('game', data));
      this._attachGame(game);

      return game;
    });
  }
  _attachGame(game) {
    game.on('change', event => {
      if (!this.buffer.get('game').has(game.id))
        this.buffer.get('game').add(game.id, game);
      this._updateGameSummary(game);
    });
    if (!game.state.startedAt)
      game.state.once('startGame', event => this._recordGameStats(game));
    if (!game.state.endedAt)
      game.state.once('endGame', event => this._recordGameStats(game));
  }
  async _recordGameStats(game) {
    if (!game.state.startedAt) return;

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
  async _deleteGame(game) {
    await this._clearGameSummary(game);
    await this.deleteFile(`game_${game.id}`);
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
    const promises = [
      this.getGameType(game.state.type),
    ];

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

    const promise = Promise.all(promises).then(([ gameType, ...gameSummaryLists ]) => {
      const summary = GameSummary.create(gameType, game);
      dirtyGames.delete(game.id);

      for (const gameSummaryList of gameSummaryLists) {
        if (!gameSummaryList) continue;

        gameSummaryList.set(game.id, summary);
        if (game.state.startedAt)
          this._pruneGameSummaryList(gameSummaryList);

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
        else if ((gameSummary.turnStartedAt.getTime() + gameSummary.turnTimeLimit*1000) < now)
          gameSummaryList.delete(gameSummary.id);
      }
    }
    completed.sort((a,b) => b.endedAt - a.endedAt);

    if (completed.length > 100)
      for (const gameSummary of completed.slice(100)) {
        gameSummaryList.delete(gameSummary.id);
      }
  }

  /*
   * Player Stats Management
   */
  async _getPlayerStats(playerId) {
    if (this.cache.get('playerStats').has(playerId))
      return this.cache.get('playerStats').get(playerId);
    else if (this.buffer.get('playerStats').has(playerId))
      return this.buffer.get('playerStats').get(playerId);

    return this.getFile(`player_${playerId}_stats`, data => {
      const playerStats = data === undefined
        ? PlayerStats.create(playerId)
        : serializer.normalize(migrate('stats', data, { playerId }));

      playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));
      return playerStats;
    });
  }
  async _savePlayerStats(playerStats) {
    const playerId = playerStats.playerId;

    await this.putFile(`player_${playerId}_stats`, () => {
      const data = serializer.transform(playerStats);
      data.version = getLatestVersionNumber('stats');

      playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));
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
    else if (this.buffer.get('playerGames').has(playerId))
      return this.buffer.get('playerGames').get(playerId);

    return this.getFile(`player_${playerId}_games`, data => {
      const playerGames = data === undefined
        ? GameSummaryList.create(playerId)
        : serializer.normalize(data);

      playerGames.once('change', () => this.buffer.get('playerGames').add(playerId, playerGames));
      return playerGames;
    });
  }
  async _savePlayerGames(playerGames) {
    const playerId = playerGames.id;

    await this.putFile(`player_${playerId}_games`, () => {
      const data = serializer.transform(playerGames);

      playerGames.once('change', () => this.buffer.get('playerGames').add(playerId, playerGames));
      return data;
    });
  }

  /*
   * Player Sets Management
   */
  async _getPlayerSets(playerId) {
    if (this.cache.get('playerSets').has(playerId))
      return this.cache.get('playerSets').get(playerId);
    else if (this.buffer.get('playerSets').has(playerId))
      return this.buffer.get('playerSets').get(playerId);

    return this.getFile(`player_${playerId}_sets`, data => {
      const playerSets = data === undefined
        ? PlayerSets.create(playerId)
        : serializer.normalize(migrate('sets', data, { playerId }));

      playerSets.once('change', () => this.buffer.get('playerSets').add(playerId, playerSets));
      return playerSets;
    });
  }
  async _savePlayerSets(playerSets) {
    const playerId = playerSets.playerId;

    await this.putFile(`player_${playerId}_sets`, () => {
      const data = serializer.transform(playerSets);
      data.version = getLatestVersionNumber('sets');

      playerSets.once('change', () => this.buffer.get('playerSets').add(playerId, playerSets));
      return data;
    });
  }

  /*
   * Game Collection Management
   */
  async _getGameCollection(collectionId) {
    if (this.cache.get('collection').has(collectionId))
      return this.cache.get('collection').get(collectionId);
    else if (this.buffer.get('collection').has(collectionId))
      return this.buffer.get('collection').get(collectionId);

    return this.getFile(`collection/${collectionId}`, data => {
      const collection = data === undefined
        ? GameSummaryList.create(collectionId)
        : serializer.normalize(data);

      collection.once('change', () => this.buffer.get('collection').add(collectionId, collection));
      return collection;
    });
  }
  async _saveGameCollection(collection) {
    const collectionId = collection.id;

    await this.putFile(`collection/${collectionId}`, () => {
      const data = serializer.transform(collection);

      collection.once('change', () => this.buffer.get('collection').add(collectionId, collection));
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
