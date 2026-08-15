import fs from 'fs/promises';

import { search } from '#utils/jsQuery.js';
import serializer from '#utils/serializer.js';
import seqAsync from '#utils/seqAsync.js';
import ValkeyAdapter from '#data/ValkeyAdapter.js';

import Game from '#models/Game.js';
import GameSummary from '#models/GameSummary.js';
import GameSummaryList from '#models/GameSummaryList.js';
import PlayerAvatars from '#models/PlayerAvatars.js';
import PlayerStats from '#models/PlayerStats.js';
import PlayerSets from '#models/PlayerSets.js';
import TeamSet from '#models/TeamSet.js';
import IndexCardinality from '#models/IndexCardinality.js';
import TeamSetIndex from '#models/TeamSetIndex.js';
import TeamSetGameSearch from '#models/TeamSetGameSearch.js';
import TeamSetSearch, { TeamSetSearchGroup } from '#models/TeamSetSearch.js';
import TeamSetStats from '#models/TeamSetStats.js';
import ServerError from '#server/Error.js';

const gameSummaryCache = new WeakMap();

export default class extends ValkeyAdapter {
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
          'playerStatsVS', {
            saver: '_savePlayerStatsVS',
          },
        ],
        [
          'teamSetStats', {
            saver: '_saveTeamSetStats',
          },
        ],
        [
          'teamSetCardinality', {
            saver: '_saveIndexCardinality',
          },
        ],
        [
          'teamSetIndex', {
            saver: '_saveTeamSetIndex',
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
      ]),

      _gameTypes: null,
      _teamSetCardinalities: new Map(),
    });
  }

  async bootstrap() {
    this._gameTypes = await this.getFile('game_types', data => {
      const gameTypes = new Map();
      for (const [ id, config ] of data)
        gameTypes.set(id, serializer.normalize({
          $type: 'GameType',
          $data: { id, config },
        }));

      return gameTypes;
    });

    return super.bootstrap();
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
      throw new ServerError(404, `No such game type: ${gameTypeId}`);
    return gameTypes.get(gameTypeId);
  }

  async getPlayerGames(playerId) {
    return this._getPlayerGames(playerId);
  }

  async getGameCollection(collectionId) {
    return this._getGameCollection(collectionId);
  }

  async getPlayerStats(myPlayer, vsPlayerIds = []) {
    const playerStats = await this._getPlayerStats(myPlayer);
    if (vsPlayerIds.length)
      await Promise.all(vsPlayerIds.map(vsPlayerId => this._loadPlayerStatsVS(playerStats, vsPlayerId)));

    return playerStats;
  }
  async clearPlayerWLDStats(myPlayer, vsPlayerId, gameTypeId) {
    const playerStats = await this.getPlayerStats(myPlayer, [ vsPlayerId ]);

    playerStats.clearWLDStats(vsPlayerId, gameTypeId);
  }

  async createGame(game) {
    return this._createGame(game);
  }
  async forkGame(game, gameSession, options) {
    options.vs ??= 'yourself';

    if (options.turnId === undefined)
      options.turnId = game.state.currentTurnId;
    else if (options.turnId < game.state.initialTurnId)
      options.turnId = game.state.initialTurnId;
    else if (options.turnId > game.state.currentTurnId)
      options.turnId = game.state.currentTurnId;

    // If necessary, roll back to the previous playable turn.
    while (!(await this._getGameTurn(game, options.turnId)).isPlayable)
      options.turnId--;

    const forkGame = game.fork(gameSession, options);
    return this.createGame(forkGame);
  }
  async getGames(gameIds) {
    return Promise.all([ ...gameIds ].map(gId => this._getGame(gId)));
  }
  async getGame(gameId, withRecentTurns = true) {
    return this._getGame(gameId, withRecentTurns);
  }
  async getGameFromFile(gameId, teamSets = null, initial = false) {
    const game = await this.getFile(`game_${gameId}`, data => {
      if (data === undefined) return;
      return serializer.normalize(data);
    });

    game.state.gameType = this.getGameType(game.state.type);
    await Promise.all(game.state.teams.filter(t => !!t).map(async team => {
      if (initial) {
        if (teamSets) {
          const teamSetId = TeamSet.createId(team.set);
          const teamSetKey = `${teamSetId}:${game.state.gameType.id}`;
          team.set = teamSets.get(teamSetKey) ?? TeamSet.create(team.set, teamSetId);
          team.set.gameType = game.state.gameType;
          team.set.cardinality = await this._getIndexCardinality('teamSet', { metricName:'rating' });
          team.set.stats ??= TeamSetStats.create();
          team.set.stats.id = team.set.id;
          if (!team.set.stats.playerIds.has(team.playerId))
            team.set.stats.playerIds.set(team.playerId, null);

          teamSets.set(team.set.key, team.set);
        }
      } else if (teamSets === null) {
        team.set = await this._getTeamSet(team.set, game.state.gameType.id);
        await this.getTeamSetStats(team.set, team.playerId);
      } else {
        const teamSetId = TeamSet.createId(team.set);
        const teamSetKey = `${teamSetId}:${game.state.gameType.id}`;
        team.set = teamSets.get(teamSetKey) ?? await this._getTeamSet(team.set, game.state.gameType.id);
        await this.getTeamSetStats(team.set, team.playerId);

        teamSets.set(team.set.key, team.set);
      }
    }));

    return game;
  }
  async deleteGame(game) {
    game.destroy();

    const dependents = [{ type:'gameSummary', id:game.id }];

    await this.deleteItemParts({ id:game.id, type:'game' }, game, dependents);
  }

  async getGameTeamSet(gameType, gameId, teamId, player = null) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const game = await (async () => {
      const game = await Game.cache.peek(gameId);
      if (game) return game;

      for (const gsl of GameSummaryList.cache.values()) {
        const gs = gsl.find(gs => gs.id === gameId);
        if (gs) return gs;
      }

      return this._getGame(gameId, false);
    })();
    const team = game.teams[teamId];
    if (!team?.set) return null;

    // Do not reveal your opponent's set until you have played a turn in the game (or it ends).
    if (player && (!game.startedAt || (!game.endedAt && game.currentTurnId < 4)))
      if (team.playerId !== player.id)
        throw new ServerError(403, `Cannot view the set for this game yet.`);

    const teamSet = game instanceof Game ? team.set : await this._getTeamSet((await this._getGameTeamByIds(gameId, teamId)).set, gameType);

    await this._getTeamSetStatsForTeamSet(teamSet);

    return teamSet.toData(await this.getTopTeamSets(gameType.id));
  }
  getTeamSet(teamSetData, gameType) {
    return this._getTeamSet({ units:teamSetData.units }, gameType, teamSetData.id);
  }
  /*
   * Used to load set information for a team in a game.
   */
  async getTeamSetStats(teamSet, playerId) {
    await this._getTeamSetStatsForTeamSet(teamSet);
    await this._getTeamSetStatsPlayer(teamSet, playerId);

    return teamSet;
  }
  async getDefaultSet(player, gameTypeId) {
    const defaultSet = await this._getDefaultPlayerSet(player, gameTypeId);
    const teamSet = await this._getTeamSetStatsForTeamSet(await this._getTeamSet({ units:defaultSet.units }, gameTypeId, defaultSet.id));
    return teamSet.toData(await this.getTopTeamSets(gameTypeId));
  }
  async getPlayerSets(player, gameType, createDefaultIfMissing = true) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await (async () => {
      if (!gameType.isCustomizable)
        return [ await this._getDefaultPlayerSet(player, gameType) ];

      const playerSetList = await this._getPlayerSets(player);
      if (createDefaultIfMissing && playerSetList.get(gameType, 'default') === null) {
        const playerAvatars = await this._getPlayerAvatars(player);
        playerSetList.set(gameType, await this._getDefaultPlayerSet(player, gameType), playerAvatars.listUnits);
      }
      return playerSetList.list(gameType);
    })();

    return await Promise.all(playerSets.map(async ps => {
      const teamSet = await this._getTeamSetStatsForTeamSet(await this._getTeamSet({
        units: ps.units,
      }, gameType.id, ps.id));

      return Object.assign(teamSet.toData(await this.getTopTeamSets(gameType.id)), {
        slot: ps.slot,
        name: ps.name,
      });
    }));
  }
  /*
   * The server may potentially store more than one set, typically one set per
   * game type.  The default set is simply the first one for a given game type.
   */
  async getPlayerSet(player, gameType, slot, createDefaultIfMissing = true) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);
    if (!gameType.isCustomizable && slot !== 'default')
      throw new ServerError(400, 'Only the default set is available for this game type.');

    const playerSets = await this.getPlayerSets(player, gameType, createDefaultIfMissing && slot === 'default');
    return playerSets.find(ps => ps.slot === slot) ?? null;
  }
  /*
   * Setting the default set for a game type involves REPLACING the first set
   * for a given game type.
   */
  async setPlayerSet(player, gameType, set) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerAvatars = await this._getPlayerAvatars(player);
    const playerSets = await this._getPlayerSets(player);
    playerSets.set(gameType, set, playerAvatars.listUnits);

    return this.getPlayerSet(player, gameType, set.slot);
  }
  async unsetPlayerSet(player, gameType, slot) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await this._getPlayerSets(player);
    playerSets.unset(gameType, slot);

    return this.getPlayerSet(player, gameType, slot);
  }

  async getPlayerAvatars(player, playerId = null) {
    playerId ??= player.id;
    return this._getPlayerAvatars(player, playerId);
  }
  async listPlayersAvatar(playerIds) {
    const playerAvatarsList = await Promise.all(playerIds.map(pId => this.getPlayerAvatars(null, pId)));
    return playerAvatarsList.map(pa => pa.avatar);
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
  async getTopTeamSets(gameTypeId, metricName = 'rating') {
    const teamSetIndex = this._getTeamSetIndex(gameTypeId, metricName);
    if (teamSetIndex.length === 0 && !teamSetIndex.isComplete)
      await this._getTeamSetIndexNextPage(gameTypeId, metricName);

    return teamSetIndex.slice(0, 100);
  }
  async searchTeamSets(gameTypeId, { text = '', metricName = 'rating', offset = 0, limit = 20 }) {
    const topTeamSets = await this.getTopTeamSets(gameTypeId);
    const teamSetSearch = this._getTeamSetSearch(gameTypeId, metricName, text);
    const teamSets = await teamSetSearch.getResults(offset, limit);
    await Promise.all(teamSets.map(ts => this._getTeamSetStatsForTeamSet(ts)));

    return {
      teamSets: teamSets.map(ts => ts.toData(topTeamSets)),
      total: teamSetSearch.getTotal(offset + limit),
    };
  }
  async searchTeamSetGames(gameTypeId, { setId, vsSetId = null, result = null, offset = 0, limit = 20 }) {
    // Ignore result filter when sets are the same.
    if (vsSetId === setId) result = null;

    const teamSetStats = await this._getTeamSetStats(gameTypeId, setId);
    const teamSetGameSearch = this._getTeamSetGameSearch(gameTypeId, { setId, vsSetId, result });
    let currentPage = this._getTeamSetGameSearchCurrentPage(teamSetGameSearch)
    while (!currentPage.completed && !currentPage.truncated && teamSetGameSearch.length < offset + limit)
      currentPage = await this._getTeamSetGameSearchNextPage(teamSetGameSearch);

    return {
      gamesSummary: teamSetGameSearch.slice(offset, offset + limit),
      total: {
        truncated: currentPage.truncated,
        fuzzy: !currentPage.completed,
        count: currentPage.completed ? teamSetGameSearch.length : teamSetStats.gameCount,
      },
    };
  }
  async getPlayerPendingGamesInCollection(playerId, collection) {
    const gamesSummary = await this._getPlayerGames(playerId);
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
    const results = [];

    for (const gameSummary of gamesSummary.values())
      results.push(gameSummary);

    return results.sort((a,b) => b.endedAt - a.endedAt).slice(0, 50);
  }

  async listMyTurnGamesSummary(myPlayerId) {
    const games = await this._getPlayerGames(myPlayerId);

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
  async _getIndexCardinality(itemType, partition) {
    const partitionId = IndexCardinality.createId(partition);
    if (IndexCardinality.cache.has(`${itemType}:${partitionId}`))
      return IndexCardinality.cache.get(`${itemType}:${partitionId}`);

    return this.getItem({
      type: `${itemType}Index`,
      id: partitionId,
    }, () => IndexCardinality.create(itemType, partition));
  }

  /*
   * Index Management
   */
  _calcGameSummaryIndexes(item) {
    const gameSummary = serializer.normalize(item);

    return {
      partitions: this._calcGameSummaryPartitions(gameSummary),
      metrics: this._calcGameSummaryMetrics(gameSummary),
      facets: this._calcGameSummaryFacets(gameSummary),
    };
  }
  /*
   * At the top level, you are either searching your games or public games.
   * Right now, you can only search your recent games and rated public games.
   * 
   * TODO: Make sure all index pages for an entity index can be found by GSI
   */
  _calcGameSummaryPartitions(gameSummary) {
    const partitions = [];

    //online.html#yourGames
    partitions.push(...gameSummary.playerIds.map(pId => [ gameSummary.endedAt ? {
      metricName: 'endedAt',
      facets: { player:pId, practice:false },
    } : gameSummary.startedAt ? {
      metricName: 'startedAt',
      facets: { player:pId, practice:false },
    } : {
      metricName: 'createdAt',
      facets: { player:pId, practice:false },
    }, {
      metricName: 'updatedAt',
      facets: { player:pId, practice:true },
    }]));

    if (gameSummary.endedAt)
      // Recent games between players.  TODO: New
      partitions.push({
        metricName: 'endedAt',
        facets: { player:gameSummary.playerIds.concat(gameSummary.playerIds.sort().join(':')), practice:false },
      });

    // Public game lists
    if (gameSummary.isPublic) {
      const collection = gameSummary.collection.split('/')[0];

      // Basic discovery of recent public games by status. (online.js: Lobby + Public tabs)
      partitions.push(gameSummary.endedAt ? {
        metricName: 'endedAt',
        facets: collection === 'public' ? { public:true, collection } : { public:true, collection, type:gameSummary.type },
      } : gameSummary.startedAt ? {
        metricName: 'startedAt',
        facets: collection === 'public' ? { public:true, collection } : { public:true, collection, type:gameSummary.type },
      } : {
        metricName: 'createdAt',
        facets: collection === 'public' ? { public:true, collection } : { public:true, collection, type:gameSummary.type },
      });

      // Search ended games excluding practice games (fork games aren't public)
      if (gameSummary.endedAt && !gameSummary.isPractice) {
        // Search by style (unused)
        /*
        partitions.push({
          metricName: 'endedAt',
          facets: { public:true, practice:false, type:gameSummary.type },
        });
        */

        // Search by player (unused)
        /*
        partitions.push(gameSummary.playerIds.map(pId => ({ // Player vs anyone
          metricName: 'endedAt',
          facets: { public:true, practice:false, player:pId },
        })), { // Between players
          metricName: 'endedAt',
          facets: { public:true, practice:false, player:gameSummary.playerIds.concat(gameSummary.playerIds.sort().join(':')) },
        });
        */

        // Rated game lists
        if (gameSummary.rated) {
          //online.html#rankings/FORTE
          partitions.push({
            metricName: 'endedAt',
            facets: { public:true, practice:false, rated:true },
          //online.html#rankings/freestyle
          }, {
            metricName: 'endedAt',
            facets: { public:true, practice:false, rated:true, type:gameSummary.type },
          });

          //online.html#rankings/d4c6a90a-0f98-4d16-95ca-35d39a2b4c7d/FORTE
          partitions.push(...gameSummary.playerIds.map(pId => [{
            metricName: 'endedAt',
            facets: { public:true, practice:false, rated:true, player:pId },
          //online.html#rankings/d4c6a90a-0f98-4d16-95ca-35d39a2b4c7d/freestyle
          }, {
            metricName: 'endedAt',
            facets: { public:true, practice:false, rated:true, player:pId, type:gameSummary.type },
          }]));

          //online.html#lobby/freestyle/searchSetGames?set=...
          partitions.push(...gameSummary.setIds.map(sId => [{
            metricName: 'endedAt',
            facets: { public:true, practice:false, rated:true, set:sId },
          }, {
            metricName: 'rating', // TODO: New
            facets: { public:true, practice:false, rated:true, set:sId },
          }]).flat());

          //online.html#lobby/freestyle/searchSetGames?set=...&vsSet=...
          partitions.push({
            metricName: 'endedAt',
            facets: { public:true, practice:false, rated:true, set:gameSummary.setIds.concat(gameSummary.setIds.sort().join(':')) },
          }, {
            metricName: 'rating', // TODO: New
            facets: { public:true, practice:false, rated:true, set:gameSummary.setIds.concat(gameSummary.setIds.sort().join(':')) },
          });
        }

        // VS game lists (unused)
        /*
        partitions.push({
          metricName: 'endedAt',
          facets: { player:gameSummary.playerIds.concat(gameSummary.playerIds.sort().join(':')) },
        });
        */
      }
    }

    return partitions;
  }
  _calcGameSummaryMetrics(gameSummary) {
    const metrics = new Map();
    for (const metricName of [ 'createdAt', 'startedAt', 'endedAt', 'updatedAt', 'rating' ])
      if (gameSummary[metricName])
        metrics.set(metricName, gameSummary[metricName]);
    return metrics;
  }
  _calcGameSummaryFacets(gameSummary) {
    const facets = {
      type: gameSummary.type,
      rated: gameSummary.rated,
      player: gameSummary.playerIds,
      practice: gameSummary.isPractice,
      public: gameSummary.isPublic,
    };

    if (gameSummary.collection)
      facets.collection = gameSummary.collection.splice('/')[0];
    if (gameSummary.mode)
      facets.mode = gameSummary.mode;
    if (gameSummary.endedAt) {
      facets.player.push(gameSummary.playerIds.sort().join(':'));
      facets.set = gameSummary.teams.map(t => t.set.id).concat(gameSummary.teams.map(t => t.set.id).sort().join(':'));
      facets.winner = !gameSummary.winner ? gameSummary.winnerId : [
        gameSummary.winner.playerId,
        gameSummary.winner.set.id,
      ];
    }

    return facets;
  }

  /*
   * Game Management
   */
  async _createGame(game) {
    if (Game.cache.has(game.id))
      throw new Error('Game already exists');

    return Game.cache.use(game.id, async () => {
      await this._attachGame(game);
      this._saveGame(game);
      return game;
    });
  }
  async _getGame(gameId, withRecentTurns = true) {
    const game = await Game.cache.use(gameId, async () => {
      // Get the root item first, if it exists.
      const game = await this.getItem({
        id: gameId,
        type: 'game',
        name: `game_${gameId}`,
      });

      await this._getAllGameTeams(game);
      await this._attachGame(game);
      return game;
    });

    // A game is usually loaded with the last turn, which is required to view the game.
    if (game.state.lastTurnId !== null)
      if (withRecentTurns === 'all')
        await this._getAllGameTurns(game);
      else if (withRecentTurns)
        await this._getGameRecentTurns(game);

    // Always set the summary even if the game ended.  We might need it to sync game summaries.
    if (!gameSummaryCache.has(game) && game.state.turns.last)
      gameSummaryCache.set(game, GameSummary.create(game));

    return game;
  }
  async _getAllGameTeams(game) {
    const parts = await this.getItemParts({
      id: game.id,
      type: 'game',
      path: '/teams/',
    });
    await Promise.all(Array.from(parts).map(async ([ teamId, team ]) => {
      game.state.teams[parseInt(teamId.slice(7))] = team;
    }));
  }
  async _getGameTeamByIds(gameId, teamId) {
    return this.getItem({
      id: gameId,
      type: 'game',
      path: '/teams/' + teamId,
    }, {}, () => null);
  }
  async _getAllGameTurns(game) {
    const parts = await this.getItemParts({
      id: game.id,
      type: 'game',
      path: '/turns/',
    });
    for (const [ turnId, turn ] of parts)
      game.state.loadTurn(parseInt(turnId.slice(7)), turn);
  }
  /*
   * Recent turns include the current turn and enough history to undo to each
   * team's previous playable turn, if possible.
   */
  async _getGameRecentTurns(game) {
    // If the game has ended and we can't undo, then the current turn is all we need.
    if (game.state.endedAt && !game.isPracticeMode)
      return this._getGameTurn(game, game.state.currentTurnId);

    const teamsWithPlayableTurn = new Set();
    // Yes, we might load turns older than the locked turn ID, but there are other places
    // where the team's previous playable turn is inspected, e.g. to determine time limits.
    for (let turnId = game.state.lastTurnId; turnId >= game.state.initialTurnId; turnId--) {
      const turn = await this._getGameTurn(game, turnId);

      // Don't count the last turn.
      if (turnId === game.state.lastTurnId)
        continue;

      if (turn.isPlayable)
        teamsWithPlayableTurn.add(turn.team);
      if (teamsWithPlayableTurn.size === game.state.teams.length)
        break;
    }
  }
  async _getGameTurn(game, turnId) {
    if (game.state.turns[turnId])
      return game.state.turns[turnId];

    const turn = await this.getItem({
      id: game.id,
      type: 'game',
      path: `/turns/${turnId}`,
    });
    return game.state.loadTurn(turnId, turn);
  }
  async _attachGame(game) {
    // Detect changes to game object
    game.on('change', event => this._saveGame(game));
    // Detect changes to team objects
    game.state.on('join', async ({ data:team }) => {
      team.on('change', event => this._saveGame(game));
      this._saveGame(game);
    });
    game.state.on('loadTurn', ({ data:{ turnId, resolve, reject } }) => this._getGameTurn(game, turnId)
      .then(turn => resolve(turn), err => reject(err))
    );
    game.state.on('revert', () => this._getGameRecentTurns(game));

    game.state.gameType = this.getGameType(game.state.type);
    await Promise.all(game.state.teams.filter(t => !!t).map(async team => {
      team.on('change', event => this._saveGame(game));
      // It might already be a TeamSet instance if we are creating the game.
      if (team.set && !(team.set instanceof TeamSet))
        team.loadSet(await this._getTeamSet({ units:team.set.units }, game.state.type, team.set.id));
    }));
  }
  async _saveGame(game, { fromFile = false, sync = false } = {}) {
    await Promise.all([
      this.putItemParts({
        type: 'game',
        id: game.id,
      }, game, game.toParts(fromFile)),
      this._saveGameSummary(game, sync),
    ]);
  }
  async _saveGameSummary(game, force = false) {
    const summary = GameSummary.create(game);
    if (!force && summary.equals(gameSummaryCache.get(game)))
      return;
    gameSummaryCache.set(game, summary);

    await this.putItem({
      type: 'gameSummary',
      id: game.id,
      data: summary,
    });
  }

  /*
   * Player Stats Management
   */
  async _getPlayerStats(player) {
    return PlayerStats.cache.use(player.id, async () => {
      const playerStats = await this.getItem({
        type: 'playerStats',
        id: player.id,
        name: `player_${player.id}_stats`,
      }, { playerId:player.id }, () => PlayerStats.create(player.id));
      playerStats.player = player;
      playerStats.on('change', () => this._savePlayerStats(playerStats));
      playerStats.on('vs:change', e => this._savePlayerStatsVS({ playerId:player.id, vsPlayerId:e.data.vsPlayerId, vsStats:e.data }));

      return playerStats;
    });
  }
  /**
   * Build writeItems entries for player stats (includes VS stats).
   */
  _buildPlayerStatsWriteItems(playerStats, ts) {
    const items = [];
    const playerId = playerStats.playerId;

    // Main player stats item
    items.push({
      PK: playerId,
      SK: 'playerStats',
      D: playerStats,
      op: 'PUT',
      indexes: {
        GPK0: 'playerStats',
        GSK0: `instance&${ts}`,
      },
    });

    // VS stats items
    for (const [vsPlayerId, vsStats] of playerStats.vsStats) {
      if (vsStats) {
        items.push({
          PK: playerId,
          SK: `playerStatsVS#${vsPlayerId}`,
          D: vsStats,
          op: 'PUT',
          indexes: {
            GPK0: 'playerStatsVS',
            GSK0: `instance&${ts}`,
          },
        });
      }
    }

    return items;
  }

  async _savePlayerStats(playerStats) {
    const playerId = playerStats.playerId;

    await this.putItem({
      type: 'playerStats',
      id: playerId,
      data: playerStats,
      // Make sure player stats expires after the player so add 1 week.
      // Add another month to avoid needing to refresh the TTL when nothing else changed.
      ttl: playerStats.ttl + (7 + 30) * 86400,
    });
  }
  async _loadPlayerStatsVS(playerStats, vsPlayerId) {
    if (vsPlayerId === playerStats.playerId || playerStats.hasVS(vsPlayerId))
      return;

    const vsStats = await this.getItem({
      type: 'playerStats',
      id: playerStats.playerId,
      path: `/vs/${vsPlayerId}`,
    }, {}, null);
    playerStats.loadVS(vsPlayerId, vsStats);
  }
  async _savePlayerStatsVS({ playerId, vsPlayerId, vsStats }) {
    await this.putItem({
      type: 'playerStats',
      id: playerId,
      path: `/vs/${vsPlayerId}`,
      data: vsStats,
      ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    });
  }

  /*
   * Player Games Management
   */
  async _getPlayerGames(playerId, empty = false) {
    return GameSummaryList.cache.use(`playerGames#${playerId}`, async gslId => {
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
        id: gslId,
        gamesSummary: new Map(gamesSummary.map(gs => [ gs.id, gs ])),
      });

      return playerGames;
    });
  }

  /*
   * Player Rated Games
   */
  async _getPlayerRatedGames(playerId, rankingId) {
    return GameSummaryList.cache.use(`rated/${playerId}/${rankingId}`, async gslId => {
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

      const playerRatedGames = new GameSummaryList({
        id: gslId,
        gamesSummary: new Map(gamesSummary.map(gs => [ gs.id, gs ])),
      });

      return playerRatedGames;
    });
  }

  async _getDefaultPlayerSet(player, gameType) {
    const playerAvatars = await this._getPlayerAvatars(player);

    gameType = typeof gameType === 'string' ? this.getGameType(gameType) : gameType;    

    const sourceSet = await (async () => {
      if (!gameType.isCustomizable)
        return gameType.config.sets.random();

      const topTeamSets = await this.getTopTeamSets(gameType.id);
      for (const topTeamSet of topTeamSets.shuffle()) {
        try {
          // This is expected to fail if the player doesn't have enough unit grants to use the set.
          gameType.validateSet({ units:topTeamSet.units }, playerAvatars.listUnits);
          return topTeamSet;
        } catch (e) {
          // skip
        }
      }

      return gameType.config.sets.random();
    })();

    const defaultSet = {
      id: sourceSet.id,
      slot: 'default',
      name: sourceSet.name,
      units: sourceSet.units.clone(),
      gameTypeId: gameType.id,
      createdAt: new Date(),
    };

    if (!gameType.hasFixedSides && Math.random() < 0.5) {
      for (const unit of defaultSet.units) {
        unit.assignment[0] = 10 - unit.assignment[0];
        if (unit.direction === 'W')
          unit.direction = 'E';
        else if (unit.direction === 'E')
          unit.direction = 'W';
      }
    }

    return defaultSet;
  }
  async _getTeamSet(teamSetData, gameType, teamSetId = undefined) {
    if (typeof gameType === 'string') gameType = this.getGameType(gameType);

    const teamSet = TeamSet.create(teamSetData, teamSetId);
    teamSet.gameType = gameType;
    teamSet.cardinality = await this._getIndexCardinality('teamSet', { metricName:'rating' });
    teamSet.on('stats:change', () => this._saveTeamSetStats(teamSet));
    teamSet.on('stats:playerIds', ({ data:{ playerId, playerStats } }) => this._saveTeamSetStatsPlayer(teamSet, playerId, playerStats));

    return teamSet;
  }
  async _saveTeamSet(teamSet) {
    await this.putItem({
      type: 'teamSet',
      id: teamSet.id,
      data: teamSet,
    });
  }

  async _getTeamSetStats(gameTypeId, teamSetId) {
    return TeamSetStats.cache.use(`${teamSetId}:${gameTypeId}`, async () => {
      const [ teamSetStats, mostPlayedBy ] = await Promise.all([
        this.getItem({
          type: 'teamSet',
          id: teamSetId,
          path: `/stats/${gameTypeId}`,
        }, {}, TeamSetStats.create()),
        this.query({
          attributes: [ 'SK', 'PD' ],
          filters: {
            PK: `teamSet#${teamSetId}`,
            LSK0: { beginsWith:`${gameTypeId}&` },
          },
          order: 'DESC',
          limit: 1,
        }).then(rsp => {
          if (rsp.items.length === 0) return null;

          const { SK, data } = rsp.items[0];
          return { playerId:SK.split('/').last, playerStats:data };
        }),
      ]);
      teamSetStats.id = teamSetId;
      if (mostPlayedBy)
        teamSetStats.playerIds.set(mostPlayedBy.playerId, mostPlayedBy.playerStats);

      return teamSetStats;
    });
  }
  async _getTeamSetStatsForTeamSet(teamSet) {
    if (teamSet.stats) return teamSet;
    teamSet.stats = await this._getTeamSetStats(teamSet.gameType.id, teamSet.id);
    return teamSet;
  }
  async _getTeamSetStatsPlayer(teamSet, playerId) {
    if (teamSet.stats.playerIds.has(playerId)) return teamSet;

    const playerStats = await this.getItem({
      type: 'teamSet',
      id: teamSet.id,
      path: `/stats/${teamSet.gameType.id}/players/${playerId}`,
    }, {}, null);

    teamSet.stats.playerIds.set(playerId, playerStats);
    return teamSet;
  }
  async _saveTeamSetStatsPlayer(teamSet, playerId, playerStats) {
    await this.putItem({
      type: 'teamSet',
      id: teamSet.id,
      path: `/stats/${teamSet.gameType.id}/players/${playerId}`,
      indexData: playerStats,
      indexes: {
        LSK0: `${teamSet.gameType.id}&${playerStats.gameCount.toSortableString(2, 2)}`,
      },
    });
  }
  /**
   * Build writeItems entries for team set stats.
   */
  _buildTeamSetStatsWriteItems(teamSet, ts, reset = false) {
    const items = [];
    const gameTypeId = teamSet.gameType.id;

    // Main team set stats item
    items.push({
      PK: teamSet.id,
      SK: `teamSetStats#${gameTypeId}`,
      D: teamSet.stats,
      op: 'PUT',
      indexes: {
        GPK0: 'teamSetStats',
        GSK0: `instance&${ts}`,
      },
    });

    if (reset) {
      // Player-specific stats items
      for (const [playerId, playerStats] of teamSet.stats.playerIds) {
        if (playerStats) {
          items.push({
            PK: teamSet.id,
            SK: `teamSetStats#${gameTypeId}/players/${playerId}`,
            D: playerStats,
            op: 'PUT',
            indexes: {
              GPK0: 'teamSetStatsPlayer',
              GSK0: `instance&${ts}`,
              LSK0: `${gameTypeId}&${playerStats.gameCount.toSortableString(2, 2)}`,
            },
          });
        }
      }
    }

    return items;
  }

  async _saveTeamSetStats(teamSet) {
    const gameTypeId = teamSet.gameType.id;

    await this.putItem({
      type: 'teamSet',
      id: teamSet.id,
      path: `/stats/${gameTypeId}`,
      data: teamSet.stats,
    });
  }

  /*
   * Player Sets Management
   */
  async _getPlayerSets(player) {
    return PlayerSets.cache.use(player.id, async () => {
      const playerSets = await this.getItem({
        id: player.id,
        type: 'playerSets',
        name: `player_${player.id}_sets`,
      }, { playerId:player.id }, () => PlayerSets.create(player.id));
      playerSets.player = player;
      playerSets.on('change', () => this._savePlayerSets(playerSets));

      return playerSets;
    });
  }
  /**
   * Build writeItems entries for player sets.
   */
  _buildPlayerSetsWriteItems(playerSets, ts) {
    return [{
      PK: playerSets.playerId,
      SK: 'playerSets',
      D: playerSets,
      op: 'PUT',
      indexes: {
        GPK0: 'playerSets',
        GSK0: `instance&${ts}`,
      },
    }];
  }

  async _savePlayerSets(playerSets) {
    const playerId = playerSets.playerId;

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
    const playerAvatars = await PlayerAvatars.cache.use(playerId ?? player.id, async playerId => {
      const playerAvatars = await this.getItem({
        id: playerId,
        type: 'playerAvatars',
        name: `player_${playerId}_avatars`,
      }, { playerId }, () => PlayerAvatars.create(playerId));
      playerAvatars.player = player;
      playerAvatars.on('change', () => this._savePlayerAvatars(playerAvatars));

      if (!playerAvatars.isClean)
        this._savePlayerAvatars(playerAvatars);

      return playerAvatars;
    });

    // The player may not be set if originally cached via listPlayersAvatar()
    if (player && !playerAvatars.player)
      playerAvatars.player = player;
    return playerAvatars;
  }
  /**
   * Build writeItems entries for player avatars.
   */
  _buildPlayerAvatarsWriteItems(playerAvatars, ts) {
    return [{
      PK: playerAvatars.playerId,
      SK: 'playerAvatars',
      D: playerAvatars,
      op: 'PUT',
      indexes: {
        GPK0: 'playerAvatars',
        GSK0: `instance&${ts}`,
      },
    }];
  }

  async _savePlayerAvatars(playerAvatars) {
    const playerId = playerAvatars.playerId;

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
    return GameSummaryList.cache.use(collectionId, async () => {
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

      return collection;
    });
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

  /*
   * Used by syncPlayerStats
   */
  async indexAllGames() {
    const indexAt = new Date();
    const indexStat = await this.statFile('game_index', true);
    const lastIndexAt = indexStat && new Date(indexStat.mtime);
    const gameIds = [];
    const gameIndex = await this.getFile('game_index', data => {
      if (data === undefined)
        return new Map();
      return serializer.normalize(data);
    });

    for await (const gameId of this.listAllGameIds(lastIndexAt))
      gameIds.push(gameId);

    for (let i = 0; i < gameIds.length; i += 100) {
      console.log(`indexAllGames: ${i} through ${i+Math.min(100, gameIds.length - i)} of ${gameIds.length}`);
      await Promise.all(gameIds.slice(i, i + 100).map(gId => this._getGame(gId, 'all').then(game => {
        if (!game.state.gameType || game.state.gameType.config.archived)
          return;
        if (!game.state.startedAt)
          return;
        if (game.state.isSimulation)
          return;

        gameIndex.set(game.id, {
          gameTypeId: game.state.gameType.id,
          startedAt: game.state.startedAt,
          endedAt: game.state.endedAt,
        });
        game.toFile = true;
        return this.putFile(`game_${game.id}`, serializer.transform(game));
      }).catch(error => {
        if (error.code === 404)
          return null;
        console.log('Error loading game', gId);
        throw error;
      })));
      await this.flush();
    }

    if (gameIds.length) {
      await this.putFile('game_index', serializer.transform(gameIndex));
      await fs.utimes(`${this.filesDir}/game_index.json`, indexAt, indexAt);
    }

    return gameIndex;
  }
  /*
   * If the game index needs more data, this is a quick way to refresh the index.
   */
  async reindexAllGames() {
    const indexStat = await this.statFile('game_index', true);
    const lastIndexAt = indexStat && new Date(indexStat.mtime);
    const gamesIndex = await this.getFile('game_index', data => {
      if (data === undefined)
        return new Map();
      return serializer.normalize(data);
    });

    const gameIds = Array.from(gamesIndex.keys());

    for (let i = 0; i < gameIds.length; i += 100) {
      const games = await Promise.all(gameIds.slice(i, i+100).map(gId => this.getGameFromFile(gId, null, true)));
      for (const game of games) {
        const indexData = gamesIndex.get(game.id);
        indexData.gameTypeId = game.state.gameType.id;
      }
    }

    await this.putFile('game_index', serializer.transform(gamesIndex));
    await fs.utimes(`${this.filesDir}/game_index.json`, lastIndexAt, lastIndexAt);

    return gamesIndex;
  }
};
