import { search } from '#utils/jsQuery.js';
import serializer from '#utils/serializer.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

import Game from '#models/Game.js';
import GameSummary from '#models/GameSummary.js';
import GameSummaryList from '#models/GameSummaryList.js';
import PlayerStats from '#models/PlayerStats.js';
import PlayerSets from '#models/PlayerSets.js';
import PlayerAvatars from '#models/PlayerAvatars.js';
import ServerError from '#server/Error.js';

const gameSummaryCache = new WeakMap();

export default class extends DynamoDBAdapter {
  constructor(options = {}) {
    super({
      name: options.name ?? 'game',
      readonly: options.readonly ?? false,
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
          },
        ],
        [
          'collection', {
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
    while (this._dirtyGames.size)
      await Promise.all(Array.from(this._dirtyGames.values()));

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
    await Promise.all([
      this._getPlayerStats(player).then(playerStats => this.cache.get('playerStats').open(player.id, playerStats)),
      this._getPlayerGames(player.id).then(playerGames => this.cache.get('playerGames').open(player.id, playerGames)),
      this._getPlayerSets(player).then(playerSets => this.cache.get('playerSets').open(player.id, playerSets)),
      this._getPlayerAvatars(player).then(playerAvatars => this.cache.get('playerAvatars').open(player.id, playerAvatars)),
    ]);
  }
  closePlayer(player) {
    this.cache.get('playerStats').close(player.id);
    this.cache.get('playerGames').close(player.id);
    this.cache.get('playerSets').close(player.id);
    this.cache.get('playerAvatars').close(player.id);

    /*
     * Refresh the TTL of player objects if needed as players check out.
     */
    for (const itemType of [ 'playerStats', 'playerSets', 'playerAvatars' ]) {
      const obj = this.cache.get(itemType).get(player.id);
      const itemMeta = this.getItemMeta(obj);
      // The obj won't have meta if it was just created and not saved
      if (!itemMeta.item)
        continue;
      // Subtract the 1 week so this TTL doesn't end up being too close to the player TTL.
      if (!itemMeta.item.TTL || (itemMeta.item.TTL - 7 * 86400) < player.ttl)
        this.buffer.get(itemType).add(obj.playerId, obj);
    }
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
    const playerStats = await this._getPlayerStats(myPlayer);

    this.cache.get('playerStats').add(myPlayer.id, playerStats);
    return playerStats;
  }
  async getPlayerInfo(myPlayer, vsPlayerId) {
    const playerStats = await this._getPlayerStats(myPlayer);

    this.cache.get('playerStats').add(myPlayer.id, playerStats);
    return playerStats.get(vsPlayerId);
  }
  async clearPlayerWLDStats(myPlayer, vsPlayerId, gameTypeId) {
    const playerStats = await this._getPlayerStats(myPlayer);

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

    const dependents = [];
    if (game.collection)
      dependents.push([{ type:'collection' }, { type:'gameSummary', id:game.id }]);

    const playerIds = new Set(game.state.teams.filter(t => t?.playerId).map(t => t.playerId));
    for (const playerId of playerIds)
      dependents.push([{ type:'playerGames', id:playerId }, { type:'gameSummary', id:game.id }]);

    this._clearGameSummary(game);
    if (game.isPersisted)
      await this.deleteItemParts({ id:game.id, type:'game' }, game, dependents);
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

    const playerSets = await this._getPlayerSets(player);
    return playerSets.list(gameType);
  }
  /*
   * The server may potentially store more than one set, typically one set per
   * game type.  The default set is simply the first one for a given game type.
   */
  async getPlayerSet(player, gameType, setId) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player);
    return playerSets.get(gameType, setId);
  }
  /*
   * Setting the default set for a game type involves REPLACING the first set
   * for a given game type.
   */
  async setPlayerSet(player, gameType, set) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player);
    playerSets.set(gameType, set);
  }
  async unsetPlayerSet(player, gameType, setId) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player);
    return playerSets.unset(gameType, setId);
  }

  async getPlayerAvatars(player, playerId = null) {
    playerId ??= player.id;
    const playerAvatars = await this._getPlayerAvatars(player, playerId);
    return this.cache.get('playerAvatars').add(playerId, playerAvatars);
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
    this.cache.get('collection').add(gamesSummary.id, gamesSummary);

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
    const gamesSummary = await this._getPlayerRatedGames(playerId, rankingId);
    this.cache.get('collection').add(gamesSummary.id, gamesSummary);

    const results = [];

    for (const gameSummary of gamesSummary.values())
      results.push(gameSummary);

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
   * game can be either a Game or GameSummary object.
   */
  async canPlayRatedGame(game, player, opponent) {
    if (!game.collection)
      return { rated:false, reason:'private' };

    // Both players must be verified
    if (!player.isVerified || !opponent.isVerified)
      return { rated:false, reason:'not verified' };

    // Can't play a rated game against yourself
    if (player.identityId === opponent.identityId)
      return { rated:false, reason:'same identity' };

    /*
     * Max of 2 rated games per week between 2 players.
     */
    const playerGames = await this._getPlayerGames(player.id);
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000; // 1 week ago, in milliseconds

    // Check the 'nth' most recent game in this matchup
    let n = 2;

    // Check this player's games to see if there is too much history with their opponent in too short a time
    for (const gameSummary of playerGames.values()) {
      // Unrated games don't affect ranking
      if (!gameSummary.rated)
        continue;

      // Different styles have different rankings
      if (game instanceof Game && gameSummary.type !== game.state.type)
        continue;
      if (game instanceof GameSummary && gameSummary.type !== game.type)
        continue;

      // Open games don't prevent playing more rated games
      if (!gameSummary.startedAt)
        continue;

      // Old games don't prevent playing more rated games
      if (gameSummary.startedAt < since)
        continue;

      // Only counting games against any of the opponent's accounts.
      if (!gameSummary.teams.some(t => opponent.identity.playerIds.includes(t.playerId)))
        continue;

      // Disallow concurrent rated games unless one is correspondance and the other is a real time game.
      if (!gameSummary.endedAt && gameSummary.collection === game.collection)
        return { rated:false, reason:'in game' };

      if (--n === 0)
        return { rated:false, reason:'too many games' };
    }

    return { rated:true };
  }

  /*****************************************************************************
   * Private Interface
   ****************************************************************************/
  /*
   * Game Management
   */
  async _createGame(game) {
    if (this.cache.get('game').has(game.id) || this.buffer.get('game').has(game.id))
      throw new Error('Game already exists');

    game.state.gameType = this.getGameType(game.state.type);
    this._attachGame(game);
    // Save the game asynchronously.  This does mean that I trust that the game
    // does not already exist in storage.  One benefit is a person jumping their
    // avatar up and down in the lobby does not hammer storage.
    this.setItemMeta(game, { partPaths:[] });
    this._onGameChange(game);
  }
  async _getGame(gameId) {
    if (this.cache.get('game').has(gameId))
      return this.cache.get('game').get(gameId);
    else if (this.buffer.get('game').has(gameId))
      return this.buffer.get('game').get(gameId);

    try {
      return await this.getItemParts({
        id: gameId,
        type: 'game',
        name: `game_${gameId}`,
      }, parts => {
        if (parts.size === 0) return;
  
        const game = Game.fromParts(parts);
        game.state.gameType = this.hasGameType(game.state.type) ? this.getGameType(game.state.type) : null;
        gameSummaryCache.set(game, GameSummary.create(game));
        this._attachGame(game);
  
        return game;
      });
    } catch (error) {
      if (error.code === 404) {
        for (const group of [ 'collection', 'playerGames' ])
          for (const gsl of this.cache.get(group).values())
            if (gsl.has(gameId)) {
              console.log(`Warning: Found game summary for deleted game: `, gameId, gsl.id);
              gsl.delete(gameId);
              this.deleteItem({ type:group, id:gsl.id, childType:'gameSummary', childId:gameId });
            }
      }

      throw error;
    }
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
  _saveGameSummary(game, force = false, ts = new Date().toISOString()) {
    const children = [];
    const ogs = gameSummaryCache.get(game);
    const gs = GameSummary.create(game);
    if (force || !gs.equals(ogs)) {
      const collection = gs.collection && gs.collection.split('/')[0];
      const stageDate = (
        gs.endedAt ? `c=${gs.endedAt.toISOString()}` :
        gs.startedAt ? `b=${gs.updatedAt.toISOString()}` :
        `a=${gs.createdAt.toISOString()}`
      );
      const practice = gs.isSimulation;
      const rated = gs.endedAt && gs.rated;
      children.push(...game.state.playerIds.map(pId => ({
        id: pId,
        type: 'playerGames',
        childId: gs.id,
        childType: 'gameSummary',
        indexData: gs,
        indexes: {
          GPK0: 'gameSummary',
          GSK0: `instance&${ts}`,
          GPK1: `game#${gs.id}`,
          GSK1: `child`,
          LSK0: !practice ? `${stageDate}` : undefined,
          LSK1: !practice ? `${gs.type}&${stageDate}` : undefined,
          LSK2: rated ? `${stageDate}` : undefined,
          LSK3: rated ? `${gs.type}&${stageDate}` : undefined,
          LSK4: practice ? `${gs.updatedAt.toISOString()}` : undefined,
          LSK5: practice ? `${gs.type}&${gs.updatedAt.toISOString()}` : undefined,
        },
      })));
      if (collection) {
        children.push({
          type: 'collection',
          childId: gs.id,
          childType: 'gameSummary',
          indexData: gs,
          indexes: {
            GPK0: 'gameSummary',
            GSK0: `instance&${ts}`,
            GPK1: `game#${gs.id}`,
            GSK1: `child`,
            LSK0: `${stageDate}`,
            LSK1: `${gs.type}&${stageDate}`,
            LSK2: `${collection}&${stageDate}`,
            LSK3: `${collection}&${gs.type}&${stageDate}`,
            LSK4: rated ? `${stageDate}` : undefined,
            LSK5: rated ? `${gs.type}&${stageDate}` : undefined,
          },
        });
      }
    }

    return Promise.all(children.map(c => this.putItem(c))).then(() => {
      gameSummaryCache.set(game, gs);
    });
  }
  _onGameChange(game) {
    if (!this.buffer.get('game').has(game.id))
      this.buffer.get('game').add(game.id, game);

    this._updateGameSummary(game);
  }
  async _saveGame(game, { fromFile = false, sync = false } = {}) {
    const ts = new Date().toISOString();
    game.isPersisted = true;

    await Promise.all([
      this.putItemParts({
        id: game.id,
        type: 'game',
        indexes: {
          GPK0: 'game',
          GSK0: `instance&${ts}`,
        },
      }, game, game.toParts(fromFile)),
      this._saveGameSummary(game, sync, ts),
    ]);
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
  _updateGameSummary(game, isSync = false) {
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
        this._getPlayerGames(playerId, false, isSync).then(playerGames => {
          // Normally, player games are cached when a player authenticates.
          // But if only one player in this game is online, then we may need
          // to add the other player's games to the cache.
          this.cache.get('playerGames').add(playerGames.id, playerGames);

          return playerGames;
        }),
      );
    }

    const collectionCache = this.cache.get('collection');
    if (game.collection)
      promises.push(
        this._getGameCollection(game.collection, isSync).then(collection => {
          collectionCache.add(collection.id, collection);

          if (game.state.endedAt) {
            const minTurnId = game.state.initialTurnId + 3;
            if (game.state.currentTurnId < minTurnId) {
              collection.prune(game.id);
              return;
            }
          }

          return collection;
        }),
      );

    // Sync resident ephemeral collections
    if (game.state.rated && game.state.endedAt) {
      const collectionIds = [
        `rated/FORTE`,
        `rated/${game.state.type}`,
        ...Array.from(playerIds).map(pId => [
          `rated/${pId}/FORTE`,
          `rated/${pId}/${game.state.type}`,
        ]).flat(),
      ].filter(cId => collectionCache.has(cId));

      promises.push(...collectionIds.map(cId => collectionCache.get(cId)));
    }

    const promise = Promise.all(promises).then(gameSummaryLists => {
      const summary = GameSummary.create(game);
      if (dirtyGames.get(game.id) === promise)
        dirtyGames.delete(game.id);

      for (const gameSummaryList of gameSummaryLists) {
        if (!gameSummaryList) continue;

        const isCollectionList = !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(gameSummaryList.id);

        if (game.state.startedAt) {
          gameSummaryList.set(game.id, summary, isSync);
          this._pruneGameSummaryList(gameSummaryList);
        // If the game hasn't started, make sure to omit reserved games from collection lists
        } else if (!isCollectionList || !game.isReserved)
          gameSummaryList.set(game.id, summary, isSync);
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
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    if (isCollectionList) {
      const now = Date.now();

      for (const gameSummary of gameSummaryList.values()) {
        if (gameSummary.endedAt)
          groups.get('completed').push(gameSummary);
        else if (gameSummary.startedAt) {
          if (!gameSummary.timeLimitName)
            gameSummaryList.prune(gameSummary.id);
          else if (gameSummary.getTurnTimeRemaining(now) === 0)
            gameSummaryList.prune(gameSummary.id);
        }
      }
    } else {
      for (const gameSummary of gameSummaryList.values()) {
        if (gameSummary.isSimulation && gameSummary.updatedAt < threeDaysAgo)
          gameSummaryList.prune(gameSummary.id);
        else if (!gameSummary.isSimulation && gameSummary.endedAt)
          groups.get('completed').push(gameSummary);
      }
    }

    for (const gamesSummary of groups.values()) {
      gamesSummary.sort((a,b) => b.endedAt - a.endedAt);

      if (gamesSummary.length > 50)
        for (const gameSummary of gamesSummary.slice(50))
          gameSummaryList.prune(gameSummary.id);
    }
  }

  /*
   * Player Stats Management
   */
  async _getPlayerStats(player) {
    if (this.cache.get('playerStats').has(player.id))
      return this.cache.get('playerStats').get(player.id);
    else if (this.buffer.get('playerStats').has(player.id))
      return this.buffer.get('playerStats').get(player.id);

    const playerStats = await this.getItem({
      id: player.id,
      type: 'playerStats',
      name: `player_${player.id}_stats`,
    }, { playerId:player.id }, () => PlayerStats.create(player.id));
    playerStats.player = player;
    playerStats.once('change', () => this.buffer.get('playerStats').add(player.id, playerStats));

    return playerStats;
  }
  async _savePlayerStats(playerStats) {
    const playerId = playerStats.playerId;
    playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));

    await this.putItem({
      id: playerId,
      type: 'playerStats',
      data: playerStats,
      // Make sure player stats expires after the player so add 1 week.
      // Add another month to avoid needing to refresh the TTL when nothing else changed.
      ttl: playerStats.ttl + (7 + 30) * 86400,
    });
  }

  /*
   * Player Games Management
   */
  async _getPlayerGames(playerId, consistent = false, empty = false) {
    if (consistent)
      await Promise.all(Array.from(this._dirtyGames.values()));

    if (this.cache.get('playerGames').has(playerId))
      return this.cache.get('playerGames').get(playerId);

    const gamesSummary = [];
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    if (!empty)
      await Promise.all([
        this.queryItemChildren({
          id: playerId,
          type: 'playerGames',
          name: `player_${playerId}_games`,
          query: {
            indexKey: 'LSK0',
            indexValue: `a=`,
            order: 'DESC',
            limit: 50,
          },
        }, gss => gamesSummary.push(...gss)),
        this.queryItemChildren({
          id: playerId,
          type: 'playerGames',
          name: `player_${playerId}_games`,
          query: {
            indexKey: 'LSK0',
            indexValue: `b=`,
            order: 'DESC',
            limit: 50,
          },
        }, gss => gamesSummary.push(...gss)),
        this.queryItemChildren({
          id: playerId,
          type: 'playerGames',
          name: `player_${playerId}_games`,
          query: {
            indexKey: 'LSK0',
            indexValue: `c=`,
            order: 'DESC',
            limit: 50,
          },
        }, gss => gamesSummary.push(...gss)),
        this.queryItemChildren({
          id: playerId,
          type: 'playerGames',
          name: `player_${playerId}_games`,
          query: {
            indexKey: 'LSK4',
            indexValue: [ 'gt', threeDaysAgo.toISOString() ],
            order: 'DESC',
            limit: 50,
          },
        }, gss => gamesSummary.push(...gss)),
      ]);

    const playerGames = new GameSummaryList({
      id: playerId,
      gamesSummary: new Map(gamesSummary.map(gs => [ gs.id, gs ])),
    });

    return playerGames;
  }

  /*
   * Player Rated Games
   */
  async _getPlayerRatedGames(playerId, rankingId) {
    const gslId = `rated/${playerId}/${rankingId}`;
    if (this.cache.get('collection').has(gslId))
      return this.cache.get('collection').get(gslId);

    const gameTypeIds = Array.from(this._gameTypes.keys());
    const gamesSummary = await this.queryItemChildren({
      id: playerId,
      type: 'playerGames',
      name: `player_${playerId}_games`,
      query: {
        indexKey: rankingId === 'FORTE' ? 'LSK2' : 'LSK3',
        indexValue: rankingId === 'FORTE' ? undefined : `${rankingId}&`,
        order: 'DESC',
        limit: 50,
      },
    });

    return new GameSummaryList({
      id: gslId,
      gamesSummary: new Map(gamesSummary.map(gs => [ gs.id, gs ])),
    });
  }

  /*
   * Player Sets Management
   */
  async _getPlayerSets(player) {
    if (this.cache.get('playerSets').has(player.id))
      return this.cache.get('playerSets').get(player.id);
    else if (this.buffer.get('playerSets').has(player.id))
      return this.buffer.get('playerSets').get(player.id);

    const playerSets = await this.getItem({
      id: player.id,
      type: 'playerSets',
      name: `player_${player.id}_sets`,
    }, { playerId:player.id }, () => PlayerSets.create(player.id));
    playerSets.player = player;
    playerSets.once('change', () => this.buffer.get('playerSets').add(player.id, playerSets));

    return playerSets;
  }
  async _savePlayerSets(playerSets) {
    const playerId = playerSets.playerId;
    playerSets.once('change', () => this.buffer.get('playerSets').add(playerId, playerSets));

    await this.putItem({
      id: playerId,
      type: 'playerSets',
      data: playerSets,
      // Make sure player sets expires after the player so add 1 week.
      // Add another month to avoid needing to refresh the TTL when nothing else changed.
      ttl: playerSets.ttl + (7 + 30) * 86400,
    });
  }

  /*
   * Player Avatars Management
   */
  async _getPlayerAvatars(player, playerId) {
    playerId ??= player.id;
    const cachedPlayerAvatars = (() => {
      if (this.cache.get('playerAvatars').has(playerId))
        return this.cache.get('playerAvatars').get(playerId);
      else if (this.buffer.get('playerAvatars').has(playerId))
        return this.buffer.get('playerAvatars').get(playerId);
    })();
    if (cachedPlayerAvatars) {
      // The player may not be set if originally cached via listPlayersAvatar()
      if (player && !cachedPlayerAvatars.player)
        cachedPlayerAvatars.player = player;
      return cachedPlayerAvatars;
    }

    const playerAvatars = await this.getItem({
      id: playerId,
      type: 'playerAvatars',
      name: `player_${playerId}_avatars`,
    }, { playerId }, () => PlayerAvatars.create(playerId));
    playerAvatars.player = player;
    playerAvatars.once('change', () => this.buffer.get('playerAvatars').add(playerId, playerAvatars));

    if (!playerAvatars.isClean)
      this.buffer.get('playerAvatars').add(playerId, playerAvatars);

    return playerAvatars;
  }
  async _savePlayerAvatars(playerAvatars) {
    const playerId = playerAvatars.playerId;
    playerAvatars.once('change', () => this.buffer.get('playerAvatars').add(playerId, playerAvatars));

    await this.putItem({
      id: playerId,
      type: 'playerAvatars',
      data: playerAvatars,
      // Make sure player avatars expires after the player so add 1 week.
      // Add another month to avoid needing to refresh the TTL when nothing else changed.
      ttl: playerAvatars.ttl + (7 + 30) * 86400,
    });
  }

  /*
   * Game Collection Management
   */
  async _getGameCollection(collectionId, empty = false) {
    if (this.cache.get('collection').has(collectionId))
      return this.cache.get('collection').get(collectionId);

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const parts = collectionId.split('/');
    const gamesSummary = empty ? [] : (await Promise.all([
      collectionId === 'rated/FORTE' ? {
        indexKey: 'LSK4',
      } : parts[0] === 'rated' ? {
        indexKey: 'LSK5',
        indexValue: `${parts[1]}&`,
      } : parts.length === 2 ? [
        { indexKey:'LSK3', indexValue:`${parts[0]}&${parts[1]}&a=` },
        { indexKey:'LSK3', indexValue:`${parts[0]}&${parts[1]}&b=` },
        { indexKey:'LSK3', indexValue:`${parts[0]}&${parts[1]}&c=` },
      ] : [
        { indexKey:'LSK2', indexValue:`${parts[0]}&a=` },
        { indexKey:'LSK2', indexValue:[ 'between', `${parts[0]}&b=${oneWeekAgo.toISOString()}`, `${parts[0]}&c=` ] },
        { indexKey:'LSK2', indexValue:`${parts[0]}&c=` },
      ],
    ].flat().map(query => this.queryItemChildren({
      type: 'collection',
      name: `collection/${collectionId}`,
      query: Object.assign(query, { order:'DESC', limit:50 }),
    })))).flat();

    const collection = new GameSummaryList({
      id: collectionId,
      gamesSummary: new Map(gamesSummary.map(gs => [ gs.id, gs ])),
    });
    this._pruneGameSummaryList(collection);

    return collection;
  }

  /*****************************************************************************
   * Not intended for use by application.
   ****************************************************************************/
  async *listAllGameIds(since = null) {
    const children = this._query({
      indexName: 'GPK0-GSK0',
      attributes: [ 'PK' ],
      filters: {
        GPK0: 'game',
        GSK0: since
          ? { gt:`instance&${since.toISOString()}` }
          : { beginsWith:`instance&` },
      },
    });

    for await (const child of children)
      yield child.PK.slice(5);
  }
  async *listAllGameSummaryKeys(since = null, order = 'ASC') {
    const children = this._query({
      indexName: 'GPK0-GSK0',
      attributes: [ 'PK', 'SK' ],
      filters: {
        GPK0: 'gameSummary',
        GSK0: since
          ? { gt:`instance&${since.toISOString()}` }
          : { beginsWith:`instance&` },
      },
      order,
    });

    for await (const child of children)
      yield [ child.PK, child.SK ];
  }
};
