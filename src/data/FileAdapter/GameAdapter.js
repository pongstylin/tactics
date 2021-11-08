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
          'playerActiveGames', {
            saver: '_savePlayerActiveGames',
          },
        ],
        [
          // The completed game list can be large and is not frequently used, so
          // do not cache it as long as other objects.  The game list page does
          // request it every 5 seconds, so do cache it for a little while.
          'playerCompletedGames', {
            cache: { expireIn:2 * 60000 },
            saver: '_savePlayerCompletedGames',
          },
        ],
        [
          'openGames', {
            saver: '_saveOpenGames',
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
    const gameTypeConfig = gameTypes.get(gameTypeId);

    if (!gameTypeConfig)
      throw new ServerError(404, 'No such game type');

    return GameType.load(gameTypeId, gameTypeConfig);
  }

  /*
   * This opens the player's game and set list.
   */
  async openPlayer(playerId) {
    const playerStats = await this._getPlayerStats(playerId);
    this.cache.get('playerStats').open(playerId, playerStats);

    const playerActiveGames = await this._getPlayerActiveGames(playerId);
    this.cache.get('playerActiveGames').open(playerId, playerActiveGames);

    const playerSets = await this._getPlayerSets(playerId);
    this.cache.get('playerSets').open(playerId, playerSets);
  }
  closePlayer(playerId) {
    this.cache.get('playerStats').close(playerId);
    this.cache.get('playerActiveGames').close(playerId);
    this.cache.get('playerSets').close(playerId);
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

  async searchPlayerActiveGames(player, query) {
    const playerGames = await this._getPlayerActiveGames(player.id);
    const data = [...playerGames.values()];

    return this._search(data, query);
  }
  async searchPlayerCompletedGames(player, query) {
    const playerGames = await this._getPlayerCompletedGames(player.id);
    const data = [...playerGames.values()];

    this.cache.get('playerCompletedGames').add(player.id, playerGames);
    return this._search(data, query);
  }
  async searchOpenGames(player, query) {
    const openGames = await this._getOpenGames();
    const blockedBy = player.listBlockedBy();
    const data = JSON.parse(JSON.stringify([...openGames.values()])).filter(gs => {
      gs.creatorACL = player.getPlayerACL(gs.createdBy);
      return !blockedBy.has(gs.createdBy);
    });

    return this._search(data, query);
  }

  async listMyTurnGamesSummary(myPlayerId) {
    const games = await this._getPlayerActiveGames(myPlayerId, true);

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
    const gamesSummary = await this._getPlayerActiveGames(myPlayerId);

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
      this._gameTypes = await this.getFile('game_types', data => new Map(data));

    return this._gameTypes;
  }

  /*
   * Game Management
   */
  async _createGame(game) {
    await this.createFile(`game_${game.id}`, () => {
      const data = serializer.transform(game);
      game.version = getLatestVersionNumber('game');

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
    if (!game.forkOf) {
      if (!game.state.startedAt)
        game.state.once('startGame', event => this._recordGameStats(game));
      if (!game.state.endedAt)
        game.state.once('endGame', event => this._recordGameStats(game));
    }
  }
  async _recordGameStats(game) {
    if (game.forkOf) return;
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
        this._getPlayerActiveGames(playerId).then(playerGames => {
          // Normally, player games are cached when a player authenticates.
          // But if only one player in this game is online, then we may need
          // to add the other player's games to the cache.
          this.cache.get('playerActiveGames').add(playerGames.playerId, playerGames);

          if (game.state.endedAt)
            playerGames.delete(game.id);
          else
            return playerGames;
        }),
        this._getPlayerCompletedGames(playerId).then(playerGames => {
          this.cache.get('playerCompletedGames').add(playerGames.playerId, playerGames);

          if (!game.state.endedAt)
            playerGames.delete(game.id);
          else
            return playerGames;
        }),
      );
    }

    if (game.isPublic)
      promises.push(
        this._getOpenGames().then(openGames => {
          if (game.state.startedAt)
            openGames.delete(game.id);
          else
            return openGames;
        })
      );

    const promise = Promise.all(promises).then(([ gameType, ...gameSummaryLists ]) => {
      const summary = GameSummary.create(gameType, game);
      dirtyGames.delete(game.id);

      for (const gameSummaryList of gameSummaryLists) {
        if (!gameSummaryList) continue;

        gameSummaryList.set(game.id, summary);

        if (gameSummaryList.playerId) {
          const sync = syncingPlayerGames.get(gameSummaryList.playerId);

          if (sync.count === 1) {
            syncingPlayerGames.delete(gameSummaryList.playerId);
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
      this._getPlayerActiveGames(playerId)
    );

    if (game.isPublic)
      promises.push(this._getOpenGames());

    return Promise.all(promises).then(gameSummaryLists => {
      for (const gameSummaryList of gameSummaryLists) {
        gameSummaryList.delete(game.id);
      }
    });
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
  async _getPlayerActiveGames(playerId, consistent = false) {
    if (consistent) {
      const sync = this._syncingPlayerGames.get(playerId);
      if (sync)
        return sync.promise;
    }

    if (this.cache.get('playerActiveGames').has(playerId))
      return this.cache.get('playerActiveGames').get(playerId);
    else if (this.buffer.get('playerActiveGames').has(playerId))
      return this.buffer.get('playerActiveGames').get(playerId);

    return this.getFile(`player_${playerId}_activeGames`, data => {
      const playerGames = data === undefined
        ? GameSummaryList.create(playerId)
        : serializer.normalize(data);

      playerGames.once('change', () => this.buffer.get('playerActiveGames').add(playerId, playerGames));
      return playerGames;
    });
  }
  async _savePlayerActiveGames(playerGames) {
    const playerId = playerGames.playerId;

    await this.putFile(`player_${playerId}_activeGames`, () => {
      const data = serializer.transform(playerGames);

      playerGames.once('change', () => this.buffer.get('playerActiveGames').add(playerId, playerGames));
      return data;
    });
  }

  async _getPlayerCompletedGames(playerId) {
    if (this.cache.get('playerCompletedGames').has(playerId))
      return this.cache.get('playerCompletedGames').get(playerId);
    else if (this.buffer.get('playerCompletedGames').has(playerId))
      return this.buffer.get('playerCompletedGames').get(playerId);

    return this.getFile(`player_${playerId}_completedGames`, data => {
      const playerGames = data === undefined
        ? GameSummaryList.create(playerId)
        : serializer.normalize(data);

      playerGames.once('change', () => this.buffer.get('playerCompletedGames').add(playerId, playerGames));
      return playerGames;
    });
  }
  async _savePlayerCompletedGames(playerGames) {
    const playerId = playerGames.playerId;

    await this.putFile(`player_${playerId}_completedGames`, () => {
      const data = serializer.transform(playerGames);

      playerGames.once('change', () => this.buffer.get('playerCompletedGames').add(playerId, playerGames));
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
   * Open Games Management
   */
  async _getOpenGames() {
    const cache = this.cache.get('openGames');
    if (cache.has(null))
      return cache.get(null);

    const openGames = this.getFile(`open_games`, data => {
      const openGames = data === undefined
        ? GameSummaryList.create(null)
        : serializer.normalize(data);

      openGames.once('change', () => this.buffer.get('openGames').add(null, openGames));
      return openGames;
    });

    return cache.open(null, openGames);
  }
  async _saveOpenGames(openGames) {
    await this.putFile(`open_games`, () => {
      const data = serializer.transform(openGames);

      openGames.once('change', () => this.buffer.get('openGames').add(null, openGames));
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
