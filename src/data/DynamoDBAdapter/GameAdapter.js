import fs from 'fs/promises';

import { search } from '#utils/jsQuery.js';
import serializer from '#utils/serializer.js';
import seqAsync from '#utils/seqAsync.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

import Game from '#models/Game.js';
import GameSummary from '#models/GameSummary.js';
import GameSummaryList from '#models/GameSummaryList.js';
import PlayerAvatars from '#models/PlayerAvatars.js';
import PlayerStats from '#models/PlayerStats.js';
import PlayerSets from '#models/PlayerSets.js';
import TeamSet from '#models/TeamSet.js';
import TeamSetCardinality from '#models/TeamSetCardinality.js';
import TeamSetIndex from '#models/TeamSetIndex.js';
import TeamSetGameSearch from '#models/TeamSetGameSearch.js';
import TeamSetSearch, { TeamSetSearchGroup } from '#models/TeamSetSearch.js';
import TeamSetStats from '#models/TeamSetStats.js';
import ServerError from '#server/Error.js';

const gameSummaryCache = new WeakMap();

// The keys are games that have a changed game summary that hasn't been saved yet.
// The values are game summary list ids applicable to the game.
const dirtyGamesSummary = new Map();

export default class extends DynamoDBAdapter {
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
            saver: '_saveTeamSetCardinality',
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

    for (const gameType of this._gameTypes.values())
      if (!gameType.config.archived)
        this._teamSetCardinalities.set(gameType.id, await this._getTeamSetCardinality(gameType.id));

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
  getTeamSetCardinality(gameTypeId) {
    const cardinalities = this._teamSetCardinalities;
    if (!cardinalities.has(gameTypeId)) {
      const cardinality = TeamSetCardinality.create(gameTypeId);
      cardinality.gameType = this.getGameType(gameTypeId);
      return cardinality;
    }
    return cardinalities.get(gameTypeId);
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
          team.set.cardinality = this.getTeamSetCardinality(game.state.gameType.id);
          team.set.stats ??= TeamSetStats.create();
          team.set.stats.id = team.set.id;
          if (!team.set.stats.playerIds.has(team.playerId))
            team.set.stats.playerIds.set(team.playerId, null);

          teamSets.set(team.set.key, team.set);
        }
      } else if (teamSets === null) {
        team.set = this._getTeamSet(team.set, game.state.gameType.id);
        await this.getTeamSetStats(team.set, team.playerId);
      } else {
        const teamSetId = TeamSet.createId(team.set);
        const teamSetKey = `${teamSetId}:${game.state.gameType.id}`;
        team.set = teamSets.get(teamSetKey) ?? this._getTeamSet(team.set, game.state.gameType.id);
        await this.getTeamSetStats(team.set, team.playerId);

        teamSets.set(team.set.key, team.set);
      }
    }));

    // Always set the summary even if the game ended.  We might need it to sync game summaries.
    gameSummaryCache.set(game, GameSummary.create(game));

    return game;
  }
  async deleteGame(game) {
    this.buffer.get('game').delete(game.id);
    game.destroy();

    const dependents = [];
    if (game.collection && !game.isReserved)
      dependents.push([{ type:'collection' }, { type:'gameSummary', id:game.id }]);

    const playerIds = new Set(game.state.teams.filter(t => t?.playerId).map(t => t.playerId));
    for (const playerId of playerIds)
      dependents.push([{ type:'playerGames', id:playerId }, { type:'gameSummary', id:game.id }]);

    this._clearGameSummary(game);
    if (game.isPersisted)
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

    const teamSet = game instanceof Game ? team.set : this._getTeamSet((await this._getGameTeamByIds(gameId, teamId)).set, gameType);

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
  async getDefaultSet(gameTypeId) {
    const defaultSet = await this._getDefaultPlayerSet(gameTypeId);
    const teamSet = await this._getTeamSetStatsForTeamSet(this._getTeamSet({ units:defaultSet.units }, gameTypeId, defaultSet.id));
    return teamSet.toData(await this.getTopTeamSets(gameTypeId));
  }
  async getPlayerSets(player, gameType) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);

    const playerSets = await (async () => {
      if (!gameType.isCustomizable)
        return [ await this._getDefaultPlayerSet(gameType) ];

      const playerSetList = await this._getPlayerSets(player);
      if (playerSetList.get(gameType, 'default') === null)
        playerSetList.set(gameType, await this._getDefaultPlayerSet(gameType));
      return playerSetList.list(gameType);
    })();

    return await Promise.all(playerSets.map(async ps => {
      const teamSet = await this._getTeamSetStatsForTeamSet(this._getTeamSet({
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
  async getPlayerSet(player, gameType, slot) {
    if (typeof gameType === 'string')
      gameType = this._gameTypes.get(gameType);
    if (!gameType.isCustomizable && slot !== 'default')
      throw new ServerError(400, 'Only the default set is available for this game type.');

    const playerSets = await this.getPlayerSets(player, gameType);
    return playerSets.find(ps => ps.slot === slot) ?? null;
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
  /*
   * Game Management
   */
  async _createGame(game) {
    if (Game.cache.has(game.id))
      throw new Error('Game already exists');

    return Game.cache.use(game.id, async () => {
      await this._attachGame(game);
      // Save the game asynchronously.  This does mean that I trust that the game
      // does not already exist in storage.  One benefit is a person jumping their
      // avatar up and down in the lobby does not hammer storage.
      this._onGameChange(game, 'game:create');
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
    game.on('change', event => this._onGameChange(game, 'game:change', event));
    // Detect changes to team objects
    game.state.on('join', async ({ data:team }) => {
      team.on('change', event => this._onGameChange(game, 'team:change-1', event));
      this._onGameChange(game, 'game.state:join');
    });
    game.state.on('loadTurn', ({ data:{ turnId, resolve, reject } }) => this._getGameTurn(game, turnId)
      .then(turn => resolve(turn), err => reject(err))
    );
    game.state.on('revert', () => this._getGameRecentTurns(game));

    game.state.gameType = this.getGameType(game.state.type);
    await Promise.all(game.state.teams.filter(t => !!t).map(async team => {
      team.on('change', event => this._onGameChange(game, 'team:change-2', event));
      // It might already be a TeamSet instance if we are creating the game.
      if (team.set && !(team.set instanceof TeamSet))
        team.loadSet(this._getTeamSet({ units:team.set.units }, game.state.type, team.set.id));
    }));
  }
  _saveGameSummary(game, force = false, ts = new Date().toISOString(), gslIds = null) {
    // Only save the summary if it has actually changed.
    // Some game changes, like team check in/out, does not change the summary.
    if (!force && !dirtyGamesSummary.has(game)) return;

    const children = [];
    const exChildren = [];
    const gs = gameSummaryCache.get(game);
    const collection = gs.collection && gs.collection.split('/')[0];
    const practice = gs.isSimulation;
    const rated = gs.endedAt && gs.rated;
    const stageDate = (
      gs.endedAt ? `c=${gs.endedAt.toISOString()}` :
      gs.startedAt ? `b=${gs.updatedAt.toISOString()}` :
      `a=${gs.createdAt.toISOString()}`
    );

    for (const [ gslId, assign ] of this._getGameSummaryListIds(game)) {
      if (gslIds && !gslIds.has(gslId)) continue;
      if (gslId.startsWith('playerGames#')) {
        if (assign)
          children.push({
            type: gslId,
            childType: 'gameSummary',
            childId: gs.id,
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
          });
        else
          exChildren.push({
            type: gslId,
            childType: 'gameSummary',
            childId: gs.id,
          });
      } else if (gslId.startsWith('teamSetGames#')) {
        const ratingIndex = gs.rating.toSortableString(2, 2);
        const setId = gslId.split('#')[1];
        const winner = game.state.winner;
        const vsSetId = game.state.setIds.find(sId => sId !== setId) ?? setId;
        const result = winner === null || setId === vsSetId ? null : winner.set.id === setId ? 'W' : 'L';
        children.push({
          type: gslId,
          childType: 'gameSummary',
          childId: gs.id,
          indexData: gs,
          indexes: {
            GPK0: 'gameSummary',
            GSK0: `instance&${ts}`,
            GPK1: `game#${gs.id}`,
            GSK1: `child`,
            LSK0: `${gs.type}&${ratingIndex}`,
            LSK1: `${gs.type}&${vsSetId}&${ratingIndex}`,
            LSK2: result !== null ? `${gs.type}&${result}&${ratingIndex}` : undefined,
            LSK3: result !== null ? `${gs.type}&${vsSetId}&${result}&${ratingIndex}` : undefined,
          },
        });
      } else {
        if (assign)
          children.push({
            type: 'collection',
            childType: 'gameSummary',
            childId: gs.id,
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
        else
          exChildren.push({
            type: 'collection',
            childId: gs.id,
            childType: 'gameSummary',
          });
      }
    }

    return Promise.all([
      ...children.map(c => this.putItem(c)),
      ...exChildren.map(c => this.deleteItem(c)),
    ]).then(() => {
      // If the game summary didn't change while saving, then it's clean now.
      if (gameSummaryCache.get(game) === gs)
        dirtyGamesSummary.delete(game);
    });
  }
  _onGameChange(game, source, event = null) {
    //console.log('_onGameChange', source, event);

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
   * Update in memory game summary lists with the latest information.
   *
   * Note that game summaries are not immediately saved to the database.
   * So, when fetching game summary lists, games pending save are applied dynamically.
   */
  _updateGameSummary(game) {
    const oldSummary = gameSummaryCache.get(game);
    const summary = GameSummary.create(game);
    if (summary.equals(oldSummary))
      return;
    gameSummaryCache.set(game, summary);

    const gameSummaryListIds = this._getGameSummaryListIds(game);
    dirtyGamesSummary.set(game, gameSummaryListIds);

    for (const [ gslId, assign ] of gameSummaryListIds) {
      if (gslId.startsWith('teamSetGames#')) {
        for (const teamSetGameSearch of TeamSetGameSearch.cache.values())
          teamSetGameSearch.sortInIfIncluded(summary);
      } else {
        const gameSummaryList = GameSummaryList.cache.get(gslId);
        if (!gameSummaryList) continue;

        Promise.resolve(gameSummaryList).then(gsl => {
          if (assign) {
            gsl.set(game.id, summary);
            this._pruneGameSummaryList(gsl);
          } else
            gsl.prune(game.id);
        });
      }
    }
  }
  _clearGameSummary(game) {
    const gameSummaryListIds = this._getGameSummaryListIds(game);
    dirtyGamesSummary.delete(game);

    for (const [ gslId, assign ] of gameSummaryListIds) {
      if (!assign) continue;

      const gameSummaryList = GameSummaryList.cache.get(gslId);
      if (!gameSummaryList) continue;

      gameSummaryList.delete(game.id);
    }
  }
  _applyDirtyGamesSummary(gameSummaryList) {
    for (const [ game, gslIds ] of dirtyGamesSummary) {
      if (!gslIds.get(gameSummaryList.id)) continue;

      gameSummaryList.set(game.id, gameSummaryCache.get(game));      
    }
    this._pruneGameSummaryList(gameSummaryList);
  }
  _getGameSummaryListIds(game) {
    // Get a unique list of player IDs from the teams.
    const playerIds = new Set(game.state.teams.filter(t => !!t?.playerId).map(t => t.playerId));
    const gameSummaryListIds = new Map(Array.from(playerIds).map(pId => [ `playerGames#${pId}`, true ]));
    const isFullGame = (() => {
      if (!game.state.endedAt)
        return true;

      const minTurnId = game.state.initialTurnId + 2;
      return game.state.currentTurnId > minTurnId;
    })();

    if (game.collection && !game.isReserved)
      gameSummaryListIds.set(game.collection, isFullGame);

    if (game.state.rated && game.state.endedAt) {
      [
        `rated/FORTE`,
        `rated/${game.state.type}`,
        ...Array.from(playerIds).map(pId => [
          `rated/${pId}/FORTE`,
          `rated/${pId}/${game.state.type}`,
        ]).flat(),
      ].forEach(gslId => gameSummaryListIds.set(gslId, true));

      if (
        game.state.gameType.isCustomizable &&
        game.state.teams.length === 2 &&
        game.state.winner !== null &&
        game.state.currentTurnId > 10 &&
        game.state.teams.every(t => t.set.isFull && !!t.ratings?.get(game.state.type)?.[0])
      ) game.state.setIds.forEach(sId => gameSummaryListIds.set(`teamSetGames#${sId}`, true));
    }

    return gameSummaryListIds;
  }
  /*
   * Prune completed games to 50 most recently ended per sub group.
   * Collections only have one completed group.
   * Player game lists have one group per style among potentially rated games.
   * Player game lists have one group for unrated and private games.
   * Prune active games with expired time limits (collections only).
   */
  _pruneGameSummaryList(gameSummaryList) {
    const isCollectionList = !gameSummaryList.id.startsWith('playerGames#');
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
    return PlayerStats.cache.use(player.id, async () => {
      const playerStats = await this.getItem({
        type: 'playerStats',
        id: player.id,
        name: `player_${player.id}_stats`,
      }, { playerId:player.id }, () => PlayerStats.create(player.id));
      playerStats.player = player;
      playerStats.once('change', () => this.buffer.get('playerStats').add(player.id, playerStats));
      // Tricky tricky... Add the playerStats instance to the buffer to keep it alive until vs stats are saved
      playerStats.on('vs:change', e => this.buffer.get('playerStatsVS').add(`${player.id}:${e.data.vsPlayerId}`, { playerStats, ...e.data }));

      return playerStats;
    });
  }
  async _savePlayerStats(playerStats) {
    const playerId = playerStats.playerId;
    playerStats.once('change', () => this.buffer.get('playerStats').add(playerId, playerStats));

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
    if (vsStats)
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
      this._applyDirtyGamesSummary(playerGames);

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
      this._applyDirtyGamesSummary(playerRatedGames);

      return playerRatedGames;
    });
  }

  async _getDefaultPlayerSet(gameType) {
    gameType = typeof gameType === 'string' ? this.getGameType(gameType) : gameType;    

    const sourceSet = await (async () => {
      if (!gameType.isCustomizable)
        return gameType.config.sets.random();

      const topTeamSets = await this.getTopTeamSets(gameType.id);
      if (topTeamSets.length === 0)
        return gameType.config.sets.random();

      return topTeamSets.random();
    })();

    const defaultSet = {
      id: sourceSet.id,
      slot: 'default',
      name: sourceSet.name,
      units: sourceSet.units.clone(),
      gameTypeId: gameType.id,
      createdAt: new Date(),
    };

    if (!this.hasFixedSides && Math.random() < 0.5) {
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
  _getTeamSet(teamSetData, gameType, teamSetId = undefined) {
    if (typeof gameType === 'string') gameType = this.getGameType(gameType);

    const teamSet = TeamSet.create(teamSetData, teamSetId);
    teamSet.cardinality = this.getTeamSetCardinality(gameType.id);
    teamSet.on('stats:change', () => this.buffer.get('teamSetStats').add(teamSet.key, teamSet));
    teamSet.on('stats:playerIds', ({ data:{ playerId, playerStats } }) => this._saveTeamSetStatsPlayer(teamSet, playerId, playerStats));
    for (const metricName of [ 'rating', 'gameCount', 'playerCount' ])
      teamSet.on(`stats:change:${metricName}`, () => this.buffer.get('teamSetIndex').add(`${teamSet.key}:${metricName}`, {
        metricName,
        teamSet,
      }));

    return teamSet;
  }
  async _saveTeamSet(teamSet) {
    const ts = new Date().toISOString();
    teamSet.isPersisted = true;

    await this.putItem({
      type: 'teamSet',
      id: teamSet.id,
      data: teamSet,
      indexes: {
        GPK0: 'teamSet',
        GSK0: `instance&${ts}`,
      },
    });
  }
  async _getTeamSetCardinality(gameTypeId) {
    const teamSetCardinality = await this.getItem({
      type: 'teamSetCardinality',
      id: gameTypeId,
    }, {}, TeamSetCardinality.create(gameTypeId));
    teamSetCardinality.gameType = this.getGameType(gameTypeId);
    teamSetCardinality.on('change', () => {
      if (!this.buffer.get('teamSetCardinality').has(gameTypeId))
        this.buffer.get('teamSetCardinality').add(gameTypeId, teamSetCardinality);
    });

    return teamSetCardinality;
  }
  async _saveTeamSetCardinality(teamSetCardinality) {
    teamSetCardinality.isPersisted = true;

    await this.putItem({
      type: 'teamSetCardinality',
      id: teamSetCardinality.id,
      data: teamSetCardinality,
    });
  }

  _getTeamSetIndex(gameTypeId, metricName, indexPath = '/') {
    return TeamSetIndex.cache.use(`${gameTypeId}/${metricName}${indexPath}`, () => {
      const teamSetIndex = new TeamSetIndex(metricName, indexPath);
      teamSetIndex.cardinality = this.getTeamSetCardinality(gameTypeId);
      return teamSetIndex;
    });
  }
  _getTeamSetIndexCurrentPage(gameTypeId, metricName, indexPath = '/') {
    const teamSetIndex = this._getTeamSetIndex(gameTypeId, metricName, indexPath);

    return {
      completed: teamSetIndex.isComplete,
      truncated: !teamSetIndex.isComplete && teamSetIndex.length === 1000,
      teamSets: teamSetIndex.slice(0),
    };
  }
  async _getTeamSetIndexNextPage(gameTypeId, metricName, indexPath = '/') {
    const teamSetIndex = this._getTeamSetIndex(gameTypeId, metricName, indexPath);
    // Make sure we do not try to fetch the next page in parallel for a given index.
    const seqAsyncByKey = this.__getTeamSetIndexNextPage ??= new WeakMap();

    if (!seqAsyncByKey.has(teamSetIndex))
      seqAsyncByKey.set(teamSetIndex, seqAsync(async () => {
        if (teamSetIndex.isComplete)
          return { completed:true, truncated:false, teamSets:[] };
        if (teamSetIndex.length === 1000)
          return { completed:false, truncated:true, teamSets:[] };

        const rsp = await this.query({
          attributes: [ 'SK', 'PD' ],
          filters: {
            PK: `teamSetIndex#${teamSetIndex.gameTypeId}/${teamSetIndex.metricName}`,
            LSK0: { beginsWith:`${teamSetIndex.path}&` },
          },
          order: 'DESC',
          cursor: teamSetIndex.cursor,
          limit: 100,
        });
        const teamSets = rsp.items.map(i => this._getTeamSet(i.data, teamSetIndex.gameTypeId, i.SK.slice(8, 35)));
        teamSetIndex.append(teamSets, rsp.cursor);
        return {
          completed: teamSetIndex.isComplete,
          truncated: !teamSetIndex.isComplete && teamSetIndex.length === 1000,
          teamSets,
        };
      }));

    return seqAsyncByKey.get(teamSetIndex)();
  }

  _getTeamSetGameSearch(gameTypeId, { setId, vsSetId, result }) {
    const teamSetGameSearchId = [ gameTypeId, setId, vsSetId, result ].filter(p => p !== null).join(':');
    return TeamSetGameSearch.cache.use(teamSetGameSearchId, () => {
      const teamSetGameSearch = new TeamSetGameSearch({ setId, vsSetId, result });
      teamSetGameSearch.gameType = this._gameTypes.get(gameTypeId);
      return teamSetGameSearch;
    });
  }
  _getTeamSetGameSearchCurrentPage(teamSetGameSearch) {
    return {
      completed: teamSetGameSearch.isComplete,
      truncated: !teamSetGameSearch.isComplete && teamSetGameSearch.length === 1000,
    };
  }
  async _getTeamSetGameSearchNextPage(teamSetGameSearch) {
    // Make sure we do not try to fetch the next page in parallel for a given search.
    const seqAsyncByKey = this.__getTeamSetGameSearchNextPage ??= new WeakMap();

    if (!seqAsyncByKey.has(teamSetGameSearch))
      seqAsyncByKey.set(teamSetGameSearch, seqAsync(async () => {
        if (teamSetGameSearch.isComplete)
          return { completed:true, truncated:false, gamesSummary:[] };
        if (teamSetGameSearch.length === 1000)
          return { completed:false, truncated:true, gamesSummary:[] };

        const filter = (() => {
          if (teamSetGameSearch.vsSetId && teamSetGameSearch.result)
            return { key:'LSK3', value:[ teamSetGameSearch.gameType.id, teamSetGameSearch.vsSetId, teamSetGameSearch.result ].join('&') }
          else if (teamSetGameSearch.result)
            return { key:'LSK2', value:[ teamSetGameSearch.gameType.id, teamSetGameSearch.result ].join('&') }
          else if (teamSetGameSearch.vsSetId)
            return { key:'LSK1', value:[ teamSetGameSearch.gameType.id, teamSetGameSearch.vsSetId ].join('&') }
          return { key:'LSK0', value:teamSetGameSearch.gameType.id };
        })();

        const rsp = await this.query({
          attributes: [ 'SK', 'PD' ],
          filters: {
            PK:`teamSetGames#${teamSetGameSearch.setId}`,
            [filter.key]: { beginsWith:`${filter.value}&` },
          },
          order: 'DESC',
          cursor: teamSetGameSearch.cursor,
          limit: 20,
        });
        teamSetGameSearch.append(rsp.items.map(i => i.data), rsp.cursor);
        return {
          completed: teamSetGameSearch.isComplete,
          truncated: !teamSetGameSearch.isComplete && teamSetGameSearch.length === 1000,
        };
      }));

    return seqAsyncByKey.get(teamSetGameSearch)();
  }

  _getTeamSetSearch(gameTypeId, metricName, text) {
    const query = TeamSetSearch.parseText(text);
    const teamSetSearchId = `${gameTypeId}/${metricName}/${JSON.stringify(query.length === 1 ? query[0] : query)}`;
    return TeamSetSearch.cache.use(teamSetSearchId, () => {
      const cardinality = this.getTeamSetCardinality(gameTypeId);
      const teamSetIndexes = new Set();
      const teamSetSearches = query.map(q => {
        const teamSetSearchId = `${gameTypeId}/${metricName}/${JSON.stringify(q)}`;
        return TeamSetSearch.cache.use(teamSetSearchId, () => {
          const teamSetSearch = new TeamSetSearch(cardinality, metricName, q);
          teamSetSearch.on('getTeamSetIndexCurrentPage', event =>
            event.resolve(this._getTeamSetIndexCurrentPage(gameTypeId, metricName, event.indexPath))
          );
          teamSetSearch.on('getTeamSetIndexNextPage', event =>
            this._getTeamSetIndexNextPage(gameTypeId, metricName, event.indexPath).then(event.resolve, event.reject)
          );

          const teamSetIndex = this._getTeamSetIndex(gameTypeId, metricName, teamSetSearch.indexPath);
          teamSetIndex.teamSetSearches.add(teamSetSearch);
          teamSetIndexes.add(teamSetIndex);

          return teamSetSearch;
        });
      });
      if (teamSetSearches.length === 1)
        return teamSetSearches[0];

      const teamSetSearch = new TeamSetSearchGroup(cardinality, metricName, query, teamSetSearches);
      for (const teamSetIndex of teamSetIndexes)
        teamSetIndex.add(teamSetSearch);

      return teamSetSearch;
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
  async _saveTeamSetStats(teamSet, reset = false) {
    const gameTypeId = teamSet.gameType.id;
    teamSet.stats.isPersisted = true;

    await this.putItem({
      type: 'teamSet',
      id: teamSet.id,
      path: `/stats/${gameTypeId}`,
      data: teamSet.stats,
    });

    if (reset) {
      await Promise.all(Array.from(teamSet.stats.playerIds.entries()).filter(e => !!e[1]).map(([ playerId, playerStats ]) =>
        this._saveTeamSetStatsPlayer(teamSet, playerId, playerStats)
      ));

      const rootPath = `teamSet#${teamSet.id}`;
      const indexPaths = teamSet.indexPaths;

      for (const metricName of [ 'rating', 'gameCount', 'playerCount' ]) {
        await this.deleteItems({ filters:{
          PK: `teamSetIndex#${gameTypeId}/${metricName}`,
          SK: { beginsWith:rootPath+'/' },
        }}, i => !indexPaths.has(i.SK.slice(rootPath.length)));

        this.buffer.get('teamSetIndex').add(`${teamSet.key}:${metricName}`, { metricName, teamSet });
      }
    }
  }
  async _saveTeamSetIndex({ metricName, teamSet }) {
    const rootPath = `teamSet#${teamSet.id}`;
    const metricValue = teamSet[metricName].toSortableString(...(metricName === 'rating' ? [ 2, 2 ] : [ 4, 0 ]));
    // Provide sufficient information to construct TeamSet objects.
    // TeamSetStats still needs to be separate since all indexes aren't saved with every change.
    // But we'll at least include this metric to aid in sorting since it is always current.
    const indexData = {
      units: teamSet.units,
      [metricName]: teamSet[metricName],
    };

    await Promise.all(Array.from(teamSet.indexPaths).map(indexPath => this.putItem({
      type: `teamSetIndex#${teamSet.gameType.id}/${metricName}`,
      path: `${rootPath}${indexPath}`,
      indexData,
      indexes: {
        LSK0: `${indexPath}&${metricValue}`,
      },
    })));

    const indexPaths = new Set();
    for (const indexPath of teamSet.indexPaths)
      indexPaths.add(teamSet.cardinality.selectIndex([ indexPath ]).path);

    // Update cached indexes
    for (const teamSetIndex of TeamSetIndex.cache.values()) {
      if (teamSetIndex.gameTypeId !== teamSet.gameTypeId) continue;
      if (teamSetIndex.metricName !== metricName) continue;
      if (!indexPaths.has(teamSetIndex.path)) continue;
      if (!teamSetIndex.sortIn(teamSet)) continue;

      // Invalidate related searches
      for (const teamSetSearch of TeamSetSearch.cache.values())
        if (teamSetIndex.teamSetSearches.has(teamSetSearch))
          TeamSetSearch.cache.delete(teamSetSearch.id);
    }
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
      playerSets.once('change', () => this.buffer.get('playerSets').add(player.id, playerSets));

      return playerSets;
    });
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
    const playerAvatars = await PlayerAvatars.cache.use(playerId ?? player.id, async playerId => {
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
    });

    // The player may not be set if originally cached via listPlayersAvatar()
    if (player && !playerAvatars.player)
      playerAvatars.player = player;
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
      this._applyDirtyGamesSummary(collection);

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
