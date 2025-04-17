import { search } from '#utils/jsQuery.js';
import serializer from '#utils/serializer.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

import GameType from '#tactics/GameType.js';
import Game from '#models/Game.js';
import GameSummary from '#models/GameSummary.js';
import GameSummaryList from '#models/GameSummaryList.js';
import PlayerStats from '#models/PlayerStats.js';
import PlayerSets from '#models/PlayerSets.js';
import PlayerAvatars from '#models/PlayerAvatars.js';
import ServerError from '#server/Error.js';

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
  async openPlayer(playerId) {
    await Promise.all([
      this._getPlayerStats(playerId).then(playerStats => this.cache.get('playerStats').open(playerId, playerStats)),
      this._getPlayerGames(playerId).then(playerGames => this.cache.get('playerGames').open(playerId, playerGames)),
      this._getPlayerSets(playerId).then(playerSets => this.cache.get('playerSets').open(playerId, playerSets)),
      this._getPlayerAvatars(playerId).then(playerAvatars => this.cache.get('playerAvatars').open(playerId, playerAvatars)),
    ]);
  }
  closePlayer(playerId) {
    this.cache.get('playerStats').close(playerId);
    this.cache.get('playerGames').close(playerId);
    this.cache.get('playerSets').close(playerId);
    this.cache.get('playerAvatars').close(playerId);
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
    return playerStats;
  }
  async getPlayerInfo(myPlayerId, vsPlayerId) {
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
  async getPlayerSets(playerId, gameType) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(playerId);
    return playerSets.list(gameType);
  }
  /*
   * The server may potentially store more than one set, typically one set per
   * game type.  The default set is simply the first one for a given game type.
   */
  async getPlayerSet(playerId, gameType, setId) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(playerId);
    return playerSets.get(gameType, setId);
  }
  /*
   * Setting the default set for a game type involves REPLACING the first set
   * for a given game type.
   */
  async setPlayerSet(playerId, gameType, set) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(playerId);
    playerSets.set(gameType, set);
  }
  async unsetPlayerSet(playerId, gameType, setId) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(playerId);
    return playerSets.unset(gameType, setId);
  }

  async getPlayerAvatars(playerId) {
    const playerAvatars = await this._getPlayerAvatars(playerId);
    return this.cache.get('playerAvatars').add(playerId, playerAvatars);
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
    await this.createItemParts({
      id: game.id,
      type: 'game',
      indexes: {
        GPK0: 'game',
        GSK0: 'instance&' + new Date().toISOString(),
      },
      // The player awaits.  So prioritize this over asynchronous game saving.
      priority: 1,
    }, game, () => game.toParts(true));
    game.state.gameType = this.getGameType(game.state.type);
    this._attachGame(game);
    await this._updateGameSummary(game);
  }
  async _getGame(gameId) {
    if (this.cache.get('game').has(gameId))
      return this.cache.get('game').get(gameId);
    else if (this.buffer.get('game').has(gameId))
      return this.buffer.get('game').get(gameId);

    return this.getItemParts({
      id: gameId,
      type: 'game',
      name: `game_${gameId}`,
    }, parts => {
      if (parts.size === 0) return;

      const game = Game.fromParts(parts);
      game.state.gameType = this.hasGameType(game.state.type) ? this.getGameType(game.state.type) : null;
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
  async _saveGame(game, { fromFile = false } = {}) {
    await this.putItemParts({
      id: game.id,
      type: 'game',
      indexes: {
        GPK0: 'game',
        GSK0: 'instance&' + new Date().toISOString(),
      },
    }, game, () => game.toParts(fromFile));
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
      const gameType = this._gameTypes.get(game.state.type);
      const summary = GameSummary.create(gameType, game);
      if (dirtyGames.get(game.id) === promise)
        dirtyGames.delete(game.id);

      for (const gameSummaryList of gameSummaryLists) {
        if (!gameSummaryList) continue;

        const isCollectionList = !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(gameSummaryList.id);

        // Avoid adding and immediately removing a game to the main list.
        if (game.state.startedAt) {
          gameSummaryList.set(game.id, summary, isSync);
          if (game.state.endedAt)
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
  async _getPlayerStats(playerId) {
    if (this.cache.get('playerStats').has(playerId))
      return this.cache.get('playerStats').get(playerId);
    else if (this.buffer.get('playerStats').has(playerId))
      return this.buffer.get('playerStats').get(playerId);

    const playerStats = await this.getItem({
      id: playerId,
      type: 'playerStats',
      name: `player_${playerId}_stats`,
    }, { playerId }, () => PlayerStats.create(playerId));
    playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));

    return playerStats;
  }
  async _savePlayerStats(playerStats) {
    const playerId = playerStats.playerId;
    playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));

    await this.putItem({ id:playerId, type:'playerStats' }, playerStats);
  }

  /*
   * Player Games Management
   */
  async _getPlayerGames(playerId, consistent = false, empty = false) {
    if (consistent)
      await Promise.all(Array.from(this._dirtyGames.values()));

    if (this.cache.get('playerGames').has(playerId))
      return this.cache.get('playerGames').get(playerId);
    else if (this.buffer.get('playerGames').has(playerId))
      return this.buffer.get('playerGames').get(playerId);

    const gameTypeIds = Array.from(this._gameTypes.keys());
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

    playerGames.once('change:set', () => this.buffer.get('playerGames').add(playerId, playerGames));
    return playerGames;
  }
  async _savePlayerGames(playerGames, { fromFile = false } = {}) {
    const newGamesSummary = playerGames.toNewValues(fromFile);

    // Since deletions do not necessarily require deleting from DDB, only listen for additions.
    playerGames.once('change:set', () => this.buffer.get('playerGames').add(playerGames.id, playerGames));

    const children = newGamesSummary.map(gs => {
      const stageDate = (
        gs.endedAt ? `c=${gs.endedAt.toISOString()}` :
        gs.startedAt ? `b=${gs.createdAt.toISOString()}` :
        `a=${gs.createdAt.toISOString()}`
      );
      const practice = gs.isSimulation;
      const rated = gs.endedAt && gs.rated;

      return {
        id: gs.id,
        type: 'gameSummary',
        indexData: gs,
        indexes: {
          GPK0: 'gameSummary',
          GSK0: 'instance&' + new Date().toISOString(),
          GPK1: `game#${gs.id}`,
          GSK1: `child`,
          LSK0: !practice ? `${stageDate}` : undefined,
          LSK1: !practice ? `${gs.type}&${stageDate}` : undefined,
          LSK2: rated ? `${stageDate}` : undefined,
          LSK3: rated ? `${gs.type}&${stageDate}` : undefined,
          LSK4: practice ? `${gs.updatedAt.toISOString()}` : undefined,
          LSK5: practice ? `${gs.type}&${gs.updatedAt.toISOString()}` : undefined,
        },
      };
    });

    await this.putItemChildren({
      id: playerGames.id,
      type: 'playerGames',
      name: `player_${playerGames.id}_games`,
    }, children);
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
  async _getPlayerSets(playerId) {
    if (this.cache.get('playerSets').has(playerId))
      return this.cache.get('playerSets').get(playerId);
    else if (this.buffer.get('playerSets').has(playerId))
      return this.buffer.get('playerSets').get(playerId);

    const playerSets = await this.getItem({
      id: playerId,
      type: 'playerSets',
      name: `player_${playerId}_sets`,
    }, { playerId }, () => PlayerSets.create(playerId));
    playerSets.once('change', () => this.buffer.get('playerSets').add(playerId, playerSets));

    return playerSets;
  }
  async _savePlayerSets(playerSets) {
    const playerId = playerSets.playerId;
    playerSets.once('change', () => this.buffer.get('playerSets').add(playerId, playerSets));

    await this.putItem({ id:playerId, type:'playerSets' }, playerSets);
  }

  /*
   * Player Avatars Management
   */
  async _getPlayerAvatars(playerId) {
    if (this.cache.get('playerAvatars').has(playerId))
      return this.cache.get('playerAvatars').get(playerId);
    else if (this.buffer.get('playerAvatars').has(playerId))
      return this.buffer.get('playerAvatars').get(playerId);

    const playerAvatars = await this.getItem({
      id: playerId,
      type: 'playerAvatars',
      name: `player_${playerId}_avatars`,
    }, { playerId }, () => PlayerAvatars.create(playerId));
    playerAvatars.once('change', () => this.buffer.get('playerAvatars').add(playerId, playerAvatars));

    return playerAvatars;
  }
  async _savePlayerAvatars(playerAvatars) {
    const playerId = playerAvatars.playerId;
    playerAvatars.once('change', () => this.buffer.get('playerAvatars').add(playerId, playerAvatars));

    await this.putItem({ id:playerId, type:'playerAvatars' }, playerAvatars);
  }

  /*
   * Game Collection Management
   */
  async _getGameCollection(collectionId, empty = false) {
    if (this.cache.get('collection').has(collectionId))
      return this.cache.get('collection').get(collectionId);
    else if (this.buffer.get('collection').has(collectionId))
      return this.buffer.get('collection').get(collectionId);

    const parts = collectionId.split('/');
    const gamesSummary = empty ? [] : await this.queryItemChildren({
      type: 'collection',
      name: `collection/${collectionId}`,
      query: {
        ...(collectionId === 'rated/FORTE' ? {
          indexKey: 'LSK4',
        } : parts[0] === 'rated' ? {
          indexKey: 'LSK5',
          indexValue: `${parts[1]}&`,
        } : parts[0] === 'public' ? {
          indexKey: 'LSK2',
          indexValue: `${parts[0]}&`,
        } : {
          indexKey: 'LSK3',
          indexValue: `${parts[0]}&${parts[1]}&`,
        }),
        order: 'DESC',
        limit: 50,
      },
    });

    const collection = new GameSummaryList({
      id: collectionId,
      gamesSummary: new Map(gamesSummary.map(gs => [ gs.id, gs ])),
    });

    if (parts[0] !== 'rated')
      collection.once('change:set', () => this.buffer.get('collection').add(collectionId, collection));
    return collection;
  }
  async _saveGameCollection(collection, { fromFile = false } = {}) {
    const newGamesSummary = collection.toNewValues(fromFile);

    // Since deletions do not necessarily require deleting from DDB, only listen for additions.
    collection.once('change:set', () => this.buffer.get('collection').add(collection.id, collection));

    const children = newGamesSummary.map(gs => {
      const stageDate = (
        gs.endedAt ? `c=${gs.endedAt.toISOString()}` :
        gs.startedAt ? `b=${gs.createdAt.toISOString()}` :
        `a=${gs.createdAt.toISOString()}`
      );
      const collection = gs.collection && gs.collection.split('/')[0];
      const rated = gs.endedAt && gs.rated;

      return {
        id: gs.id,
        type: 'gameSummary',
        indexData: gs,
        indexes: {
          GPK0: 'gameSummary',
          GSK0: 'instance&' + new Date().toISOString(),
          GPK1: `game#${gs.id}`,
          GSK1: `child`,
          LSK0: `${stageDate}`,
          LSK1: `${gs.type}&${stageDate}`,
          LSK2: `${collection}&${stageDate}`,
          LSK3: `${collection}&${gs.type}&${stageDate}`,
          LSK4: rated ? `${stageDate}` : undefined,
          LSK5: rated ? `${gs.type}&${stageDate}` : undefined,
        },
      };
    });

    await this.putItemChildren({
      type: 'collection',
      name: `collection/${collection.id}`,
    }, children);
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
  async *listAllGameSummaryKeys(since = null) {
    const children = this._query({
      indexName: 'GPK0-GSK0',
      attributes: [ 'PK', 'SK' ],
      filters: {
        GPK0: 'gameSummary',
        GSK0: since
          ? { gt:`instance&${since.toISOString()}` }
          : { beginsWith:`instance&` },
      },
    });

    for await (const child of children)
      yield [ child.PK, child.SK ];
  }
};
