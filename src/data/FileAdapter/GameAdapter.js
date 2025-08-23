import fs from 'fs/promises';

import { getLatestVersionNumber } from '#data/migrate.js';
import { search } from '#utils/jsQuery.js';
import serializer from '#utils/serializer.js';
import FileAdapter from '#data/FileAdapter.js';

import GameSummary from '#models/GameSummary.js';
import GameSummaryList from '#models/GameSummaryList.js';
import PlayerStats from '#models/PlayerStats.js';
import PlayerSets from '#models/PlayerSets.js';
import PlayerAvatars from '#models/PlayerAvatars.js';
import ServerError from '#server/Error.js';

export default class extends FileAdapter {
  constructor(options = {}) {
    super({
      name: options.name ?? 'game',
      readonly: options.readonly ?? process.env.READONLY === 'true',
      hasState: options.hasState ?? true,
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
          'playerAvatars', {
            saver: '_savePlayerAvatars',
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

      _dirtyGames: new Map(),
    });
  }

  async bootstrap() {
    this._gameTypes = await this.getFile('game_types', data => {
      const gameTypes = new Map();
      for (const [ id, config ] of data) {
        gameTypes.set(id, serializer.normalize({
          $type: 'GameType',
          $data: { id, config },
        }));
      }

      return gameTypes;
    });

    return super.bootstrap();
  }

  async cleanup() {
    while (this._dirtyGames.size) {
      await Promise.all(Array.from(this._dirtyGames.values()));
    }

    return super.cleanup();
  }

  /*****************************************************************************
   * Public Interface
   ****************************************************************************/
  hasGameType(gameTypeId) {
    return this._gameTypes.has(gameTypeId);
  }
  getGameTypesById() {
    return this._gameTypes;
  }
  getGameType(gameTypeId) {
    const gameTypes = this._gameTypes;
    if (!gameTypes.has(gameTypeId))
      throw new ServerError(404, 'No such game type');
    return gameTypes.get(gameTypeId);
  }

  /*
   * This opens the player's game and set list.
   */
  async openPlayer(player) {
    const playerStats = await this._getPlayerStats(player.id);
    this.cache.get('playerStats').open(player.id, playerStats);

    const playerGames = await this._getPlayerGames(player.id);
    this.cache.get('playerGames').open(player.id, playerGames);

    const playerSets = await this._getPlayerSets(player.id);
    this.cache.get('playerSets').open(player.id, playerSets);

    const playerAvatars = await this._getPlayerAvatars(player.id);
    this.cache.get('playerAvatars').open(player.id, playerAvatars);
  }
  closePlayer(player) {
    this.cache.get('playerStats').close(player.id);
    this.cache.get('playerGames').close(player.id);
    this.cache.get('playerSets').close(player.id);
    this.cache.get('playerAvatars').close(player.id);
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

  async getPlayerStats(myPlayer) {
    const playerStats = await this._getPlayerStats(myPlayer.id);

    this.cache.get('playerStats').add(myPlayer.id, playerStats);
    return playerStats;
  }
  async getPlayerInfo(myPlayer, vsPlayerId) {
    const playerStats = await this._getPlayerStats(myPlayer.id);

    this.cache.get('playerStats').add(myPlayer.id, playerStats);
    return playerStats.get(vsPlayerId);
  }
  async clearPlayerWLDStats(myPlayer, vsPlayerId, gameTypeId) {
    const playerStats = await this._getPlayerStats(myPlayer.id);

    this.cache.get('playerStats').add(myPlayer.id, playerStats);
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
    return this.cache.get('game').openedValues();
  }
  closeGame(gameId) {
    return this.cache.get('game').close(gameId);
  }
  async getGames(gameIds) {
    const games = await Promise.all([ ...gameIds ].map(gId => this._getGame(gId)));
    games.forEach(g => this.cache.get('game').add(g.id, g));
    return games;
  }
  async getGame(gameId) {
    const game = await this._getGame(gameId);
    return this.cache.get('game').add(gameId, game);
  }
  getOpenGame(gameId) {
    return this.cache.get('game').getOpen(gameId);
  }
  async deleteGame(game) {
    if (this._dirtyGames.has(game.id))
      await this._dirtyGames.get(game.id);

    this.cache.get('game').delete(game.id);
    this.buffer.get('game').delete(game.id);
    game.destroy();

    this._clearGameSummary(game);
    this.deleteFile(`game_${game.id}`);
  }

  getOpenPlayerSets(playerId, gameType) {
    const playerSets = this.cache.get('playerSets').get(playerId);
    if (playerSets === undefined)
      throw new Error(`Player's sets are not cached`);

    return playerSets.list(gameType);
  }
  getOpenPlayerSet(playerId, gameType, setId) {
    const playerSets = this.cache.get('playerSets').get(playerId);
    if (playerSets === undefined)
      throw new Error(`Player's sets are not cached`);

    return playerSets.get(gameType, setId);
  }
  async getPlayerSets(player, gameType) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player.id);
    return playerSets.list(gameType);
  }
  /*
   * The server may potentially store more than one set, typically one set per
   * game type.  The default set is simply the first one for a given game type.
   */
  async getPlayerSet(player, gameType, setId) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player.id);
    return playerSets.get(gameType, setId);
  }
  /*
   * Setting the default set for a game type involves REPLACING the first set
   * for a given game type.
   */
  async setPlayerSet(player, gameType, set) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player.id);
    playerSets.set(gameType, set);
  }
  async unsetPlayerSet(player, gameType, setId) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player.id);
    return playerSets.unset(gameType, setId);
  }

  async getPlayerAvatars(player, playerId = null) {
    const playerAvatars = await this._getPlayerAvatars(playerId ?? player.id);
    return this.cache.get('playerAvatars').add(player.id, playerAvatars);
  }
  async listPlayersAvatar(playerIds) {
    const playerAvatars = await Promise.all(playerIds.map(pId => this.getPlayerAvatars(null, pId)));
    return playerAvatars.map(pa => pa.avatar);
  }

  async searchPlayerGames(player, query) {
    const playerGames = await this._getPlayerGames(player.id);
    const data = [ ...playerGames.values() ];

    return search(data, query);
  }
  async searchGameCollection(player, group, query, getPlayer) {
    const collection = await this._getGameCollection(group);
    const data = [];

    for (const gameSummary of collection.values()) {
      if (!gameSummary.startedAt) {
        const creator = await getPlayer(gameSummary.createdBy);
        if (creator.hasBlocked(player, false))
          continue;
        data.push(gameSummary);
      } else
        data.push(gameSummary);
    }

    return search(data, query);
  }
  async getRatedGames(rankingId) {
    const gamesSummary = await this._getGameCollection(`rated/${rankingId}`);
    const results = Array.from(gamesSummary.values());

    return results.sort((a,b) => b.endedAt - a.endedAt).slice(0, 50);
  }
  async getPlayerPendingGamesInCollection(playerId, collection) {
    const gamesSummary = await this._getPlayerGames(playerId, true);
    const results = [];

    for (const gameSummary of gamesSummary.values()) {
      if (gameSummary.endedAt)
        continue;
      if (gameSummary.createdBy !== playerId)
        continue;
      if (!gameSummary.collection?.startsWith(collection))
        continue;

      results.push(gameSummary);
    }

    return results;
  }
  /*
   * Get games completed by a player that are viewable by other players.
   * Not expected to exceed 50 games.
   */
  async getPlayerRatedGames(playerId, rankingId) {
    const gamesSummary = await this._getPlayerGames(playerId);
    const results = [];

    for (const gameSummary of gamesSummary.values()) {
      if (!gameSummary.endedAt || !gameSummary.rated)
        continue;
      if (![ 'FORTE', gameSummary.type ].includes(rankingId))
        continue;

      results.push(gameSummary);
    }

    return results.sort((a,b) => b.endedAt - a.endedAt).slice(0, 50);
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

  /*
   * Determine if rating changes should be slowed down for a game.
   */
  async getGameSlowMode(game, player, opponent) {
    const playerGames = await this._getPlayerGames(player.id);
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000; // 1 week ago, in milliseconds

    // Check the 'nth' most recent game in this matchup
    let n = 2;

    // Check this player's games to see if there is too much history with their opponent in too short a time
    for (const gameSummary of playerGames.values()) {
      // Ignore the current game
      if (gameSummary.id === game.id)
        continue;
      // Only interested in games that have ended
      if (!gameSummary.endedAt)
        continue;
      // Only interested in games in the same style
      if (gameSummary.type !== game.state.type)
        continue;
      // Only interested in games between the same players
      if (!gameSummary.teams.some(t => opponent.identity.playerIds.includes(t.playerId)))
        continue;

      // Unrated games don't count
      if (!gameSummary.rated)
        continue;
      // Old games don't count
      if (gameSummary.endedAt < since)
        continue;

      if (--n === 0)
        return true;
    }

    return false;
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
    game.state.gameType = this.getGameType(game.state.type);
    await this._updateGameSummary(game);
  }
  async _getGame(gameId) {
    if (this.cache.get('game').has(gameId))
      return this.cache.get('game').get(gameId);
    else if (this.buffer.get('game').has(gameId))
      return this.buffer.get('game').get(gameId);

    return this.getFile(`game_${gameId}`, data => {
      if (data === undefined) return;

      const game = this.migrate('game', data);
      game.state.gameType = this.getGameType(game.state.type);
      this._attachGame(game);
      return game;
    });
  }
  _attachGame(game) {
    // Detect changes to game object
    game.on('change', event => this._onGameChange(game));
    // Detect changes to turn objects
    game.state.on('sync', () => this._onGameChange(game));
    // Detect changes to team objects
    game.state.on('join', ({ data:team }) => {
      team.on('change', () => this._onGameChange(game))
      this._onGameChange(game);
    });
    game.state.teams.forEach(t => t?.on('change', () => this._onGameChange(game)));
  }
  _onGameChange(game) {
    if (!this.buffer.get('game').has(game.id))
      this.buffer.get('game').add(game.id, game);
    this._updateGameSummary(game);
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
   * reason, we maintain the '_dirtyGames' property.
   */
  _updateGameSummary(game) {
    const dirtyGames = this._dirtyGames;
    if (dirtyGames.has(game.id))
      return dirtyGames.get(game.id);

    // Get a unique list of player IDs from the teams.
    const playerIds = new Set(
      game.state.teams.filter(t => !!t?.playerId).map(t => t.playerId)
    );
    const promises = [];

    for (const playerId of playerIds) {
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
          this.cache.get('collection').add(collection.id, collection);

          if (game.state.endedAt) {
            const minTurnId = game.state.initialTurnId + 3;
            if (game.state.currentTurnId < minTurnId) {
              collection.delete(game.id);
              return;
            }
          }

          return collection;
        }),
      );

    if (game.state.rated && game.state.endedAt)
      promises.push(
        this._getGameCollection(`rated/FORTE`).then(ratedGames => {
          this.cache.get('collection').add(ratedGames.id, ratedGames);

          return ratedGames;
        }),
        this._getGameCollection(`rated/${game.state.type}`).then(ratedGames => {
          this.cache.get('collection').add(ratedGames.id, ratedGames);

          return ratedGames;
        }),
      );

    const promise = Promise.all(promises).then(gameSummaryLists => {
      const summary = GameSummary.create(game);
      if (dirtyGames.get(game.id) === promise)
        dirtyGames.delete(game.id);

      for (const gameSummaryList of gameSummaryLists) {
        if (!gameSummaryList) continue;

        const isCollectionList = !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(gameSummaryList.id);

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
        // If the game hasn't started, make sure to omit reserved games from collection lists
        } else if (!isCollectionList || !game.isReserved)
          gameSummaryList.set(game.id, summary);
      }
    });

    dirtyGames.set(game.id, promise);
    return promise;
  }
  async _clearGameSummary(game) {
    const dirtyGames = this._dirtyGames;

    // Get a unique list of player IDs from the teams.
    const playerIds = new Set(
      game.state.teams.filter(t => !!t?.playerId).map(t => t.playerId)
    );

    const promises = [...playerIds].map(playerId =>
      this._getPlayerGames(playerId)
    );

    if (game.collection)
      promises.push(this.getGameCollection(game.collection));

    const promise = Promise.all(promises).then(gameSummaryLists => {
      dirtyGames.delete(game.id);

      for (const gameSummaryList of gameSummaryLists)
        gameSummaryList.delete(game.id);
    });

    if (dirtyGames.has(game.id))
      dirtyGames.set(game.id, dirtyGames.get(game.id).then(() => promise));
    else
      dirtyGames.set(game.id, promise);
    return promise;
  }
  /*
   * Prune completed games to 50 most recently ended per sub group.
   * Collections only have one completed group.
   * Player game lists have one group per style among potentially rated games.
   * Player game lists have one group for unrated and private games.
   * Prune active games with expired time limits (collections only).
   */
  _pruneGameSummaryList(gameSummaryList) {
    // Hacky
    const isCollectionList = !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(gameSummaryList.id);
    const groups = new Map([ [ 'completed', [] ] ]);

    if (isCollectionList) {
      const now = Date.now();

      for (const gameSummary of gameSummaryList.values()) {
        if (gameSummary.endedAt)
          groups.get('completed').push(gameSummary);
        else if (gameSummary.startedAt) {
          if (!gameSummary.timeLimitName)
            gameSummaryList.delete(gameSummary.id);
          else if (gameSummary.getTurnTimeRemaining(now) === 0)
            gameSummaryList.delete(gameSummary.id);
        }
      }
    } else {
      for (const gameSummary of gameSummaryList.values()) {
        if (!gameSummary.endedAt)
          continue;

        if (gameSummary.rated) {
          if (groups.has(gameSummary.type))
            groups.get(gameSummary.type).push(gameSummary);
          else
            groups.set(gameSummary.type, [ gameSummary ]);
        } else
          groups.get('completed').push(gameSummary);
      }
    }

    for (const gamesSummary of groups.values()) {
      gamesSummary.sort((a,b) => b.endedAt - a.endedAt);

      if (gamesSummary.length > 50)
        for (const gameSummary of gamesSummary.slice(50))
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
        : this.migrate('stats', data, { playerId });

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
    if (consistent)
      await Promise.all(Array.from(this._dirtyGames.values()));

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
        : this.migrate('sets', data, { playerId });

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
   * Player Avatars Management
   */
  async _getPlayerAvatars(playerId) {
    if (this.cache.get('playerAvatars').has(playerId))
      return this.cache.get('playerAvatars').get(playerId);
    else if (this.buffer.get('playerAvatars').has(playerId))
      return this.buffer.get('playerAvatars').get(playerId);

    return this.getFile(`player_${playerId}_avatars`, data => {
      const playerAvatars = data === undefined
        ? PlayerAvatars.create(playerId)
        : this.migrate('avatars', data, { playerId });

      if (!playerAvatars.isClean)
        this.buffer.get('playerAvatars').add(playerId, playerAvatars);
      playerAvatars.once('change', () => this.buffer.get('playerAvatars').add(playerId, playerAvatars));
      return playerAvatars;
    });
  }
  async _savePlayerAvatars(playerAvatars) {
    const playerId = playerAvatars.playerId;

    await this.putFile(`player_${playerId}_avatars`, () => {
      const data = serializer.transform(playerAvatars);
      data.version = getLatestVersionNumber('avatars');

      playerAvatars.once('change', () => this.buffer.get('playerAvatars').add(playerId, playerAvatars));
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
  async listAllGameIds(since = null) {
    const fileNames = await fs.readdir(this.filesDir);
    const regex = /^game_(.{8}-.{4}-.{4}-.{4}-.{12})\.json$/;
    const gameIds = [];

    for (let i=0; i<fileNames.length; i++) {
      let match = regex.exec(fileNames[i]);
      if (!match) continue;

      if (since) {
        const mtime = (await fs.stat(`${this.filesDir}/${fileNames[i]}`)).mtime;
        if (mtime < since)
          continue;
      }

      gameIds.push(match[1]);
    }

    return gameIds;
  }

  /*
   * Used by syncPlayerStats
   */
  async indexAllGames() {
    const indexAt = new Date();
    const indexStat = await this.statFile('game_index', true);
    const lastIndexAt = indexStat && new Date(indexStat.mtime);
    const gameIds = await this.listAllGameIds(lastIndexAt);
    const gameIndex = await this.getFile('game_index', data => {
      if (data === undefined)
        return new Map();
      return serializer.normalize(data);
    });

    for (let i = 0; i < gameIds.length; i += 100) {
      console.log(`indexAllGames: ${i} through ${i+100} of ${gameIds.length}`);
      const games = await Promise.all(gameIds.slice(i, i + 100).map(gId => this._getGame(gId)));

      for (const game of games) {
        if (!this.hasGameType(game.state.type))
          continue;
        if (!game.state.startedAt)
          continue;
        if (game.state.isSimulation)
          continue;

        gameIndex.set(game.id, {
          startedAt: game.state.startedAt,
          endedAt: game.state.endedAt,
          type: game.state.type,
          rated: game.state.rated,
          winnerId: game.state.winnerId,
          teams: game.state.teams.map(t => ({
            playerId: t.playerId,
            name: t.name,
            usedUndo: t.usedUndo,
            usedSim: t.usedSim,
            hasPlayed: game.state.teamHasPlayed(t),
          })),
        });
      }
    }

    if (gameIds.length) {
      await this.putFile('game_index', serializer.transform(gameIndex));
      await fs.utimes(`${this.filesDir}/game_index.json`, indexAt, indexAt);
    }

    return gameIndex;
  }

  async archivePlayer(playerId) {
    await Promise.all([
      this.archiveFile(`player_${playerId}_stats`),
      this.archiveFile(`player_${playerId}_games`),
      this.archiveFile(`player_${playerId}_sets`),
      this.archiveFile(`player_${playerId}_avatars`),
    ]);
  }

  async archiveGame(gameId) {
    try {
      const game = await this._getGame(gameId);
      if (game.collection)
        await Promise.all([
          this.getGameCollection(game.collection).then(gsl => gsl.delete(game.id)),
          this.archiveFile(`game_${gameId}`),
        ]);
      else
        await this.archiveFile(`game_${gameId}`);
    } catch (e) {
      if (e.message.startsWith('Corrupt:'))
        await this.deleteFile(`game_${gameId}`);
      else
        throw e;
    }
  }
};
