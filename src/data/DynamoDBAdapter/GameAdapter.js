import fs from 'fs/promises';

import { search } from '#utils/jsQuery.js';
import serializer from '#utils/serializer.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

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
          'gameSummaryLists', {
          },
        ],
      ]),

      _gameTypes: null,

      // The keys are games that have a changed game summary that hasn't been saved yet.
      // The values are game summary list ids applicable to the game.
      _dirtyGamesSummary: new Map(),
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
      this._getPlayerGames(player.id).then(playerGames => this.cache.get('gameSummaryLists').open(`playerGames#${player.id}`, playerGames)),
      this._getPlayerSets(player).then(playerSets => this.cache.get('playerSets').open(player.id, playerSets)),
      this._getPlayerAvatars(player).then(playerAvatars => this.cache.get('playerAvatars').open(player.id, playerAvatars)),
    ]);
  }
  closePlayer(player) {
    this.cache.get('playerStats').close(player.id);
    this.cache.get('gameSummaryLists').close(`playerGames#${player.id}`);
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
    return this.cache.get('gameSummaryLists').open(`playerGames#${playerId}`, playerGames);
  }
  closePlayerGames(playerId) {
    return this.cache.get('gameSummaryLists').close(`playerGames#${playerId}`);
  }

  async openGameCollection(collectionId) {
    const collection = await this._getGameCollection(collectionId);
    return this.cache.get('gameSummaryLists').open(collectionId, collection);
  }
  closeGameCollection(collectionId) {
    return this.cache.get('gameSummaryLists').close(collectionId);
  }
  async getGameCollection(collectionId) {
    const collection = await this._getGameCollection(collectionId);
    return this.cache.get('gameSummaryLists').add(collectionId, collection);
  }

  async getPlayerStats(myPlayer, vsPlayerIds = []) {
    const playerStats = await this._getPlayerStats(myPlayer);
    if (vsPlayerIds.length)
      await Promise.all(vsPlayerIds.map(vsPlayerId => this._loadPlayerStatsVS(playerStats, vsPlayerId)));

    this.cache.get('playerStats').add(myPlayer.id, playerStats);
    return playerStats;
  }
  async clearPlayerWLDStats(myPlayer, vsPlayerId, gameTypeId) {
    const playerStats = await this.getPlayerStats(myPlayer, [ vsPlayerId ]);

    playerStats.clearWLDStats(vsPlayerId, gameTypeId);
  }

  async createGame(game) {
    this._createGame(game);
    this.cache.get('game').add(game.id, game);
    return game;
  }
  async forkGame(game, clientPara, options) {
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

    const forkGame = game.fork(clientPara, options);
    return this.createGame(forkGame);
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
  async getGame(gameId, withRecentTurns = true) {
    const game = await this._getGame(gameId, withRecentTurns);
    return this.cache.get('game').add(gameId, game);
  }
  async getGameFromFile(gameId) {
    return this.getFile(`game_${gameId}`, data => {
      if (data === undefined) return;

      const game = serializer.normalize(data);
      game.state.gameType = this.getGameType(game.state.type);
      // Always set the summary even if the game ended.  We might need it to sync game summaries.
      gameSummaryCache.set(game, GameSummary.create(game));
      return game;
    });
  }
  getOpenGame(gameId) {
    return this.cache.get('game').getOpen(gameId);
  }
  async deleteGame(game) {
    this.cache.get('game').delete(game.id);
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
    this.cache.get('gameSummaryLists').add(gamesSummary.id, gamesSummary);

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
    this.cache.get('gameSummaryLists').add(gamesSummary.id, gamesSummary);

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
  _createGame(game) {
    if (this.cache.get('game').has(game.id) || this.buffer.get('game').has(game.id))
      throw new Error('Game already exists');

    game.state.gameType = this.getGameType(game.state.type);
    this._attachGame(game);
    // Save the game asynchronously.  This does mean that I trust that the game
    // does not already exist in storage.  One benefit is a person jumping their
    // avatar up and down in the lobby does not hammer storage.
    this._onGameChange(game);
  }
  async _getGame(gameId, withRecentTurns = true) {
    if (this.cache.get('game').has(gameId))
      return this.cache.get('game').get(gameId);
    else if (this.buffer.get('game').has(gameId))
      return this.buffer.get('game').get(gameId);

    // Get the root item first, if it exists.
    const game = await this.getItem({
      id: gameId,
      type: 'game',
      name: `game_${gameId}`,
    });

    // If the full game wasn't loaded from file...
    if (!game.state.teams.some(t => !!t)) {
      await this._getAllGameTeams(game);

      // A game is usually loaded with the last turn, which is required to view the game.
      if (game.state.lastTurnId !== null)
        if (withRecentTurns === 'all')
          await this._getAllGameTurns(game);
        else if (withRecentTurns)
          await this._getGameRecentTurns(game);
    }

    game.state.gameType = this.hasGameType(game.state.type) ? this.getGameType(game.state.type) : null;
    // Always set the summary even if the game ended.  We might need it to sync game summaries.
    gameSummaryCache.set(game, GameSummary.create(game));
    this._attachGame(game);
    return game;
  }
  async _getAllGameTeams(game) {
    const parts = await this.getItemParts({
      id: game.id,
      type: 'game',
      path: '/teams/',
    });
    for (const [ teamId, team ] of parts)
      game.state.teams[parseInt(teamId.slice(7))] = team;
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
  _attachGame(game) {
    // Detect changes to game object
    game.on('change', () => this._onGameChange(game));
    // Detect changes to team objects
    game.state.on('join', ({ data:team }) => {
      team.on('change', () => this._onGameChange(game))
      this._onGameChange(game);
    });
    game.state.teams.forEach(t => t?.on('change', () => this._onGameChange(game)));

    game.state.on('loadTurn', ({ data:{ turnId, resolve, reject } }) => this._getGameTurn(game, turnId)
      .then(turn => resolve(turn), err => reject(err))
    );
    game.state.on('revert', () => this._getGameRecentTurns(game));
  }
  _saveGameSummary(game, force = false, ts = new Date().toISOString()) {
    if (!force && !this._dirtyGamesSummary.has(game)) return;

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
      if (gslId.startsWith('playerGames#')) {
        if (assign)
          children.push({
            type: gslId,
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
          });
        else
          exChildren.push({
            type: gslId,
            childId: gs.id,
            childType: 'gameSummary',
          });
      } else {
        if (assign)
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
        this._dirtyGamesSummary.delete(game);
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

    const gameSummaryListCache = this.cache.get('gameSummaryLists');
    const gameSummaryListIds = this._getGameSummaryListIds(game);
    this._dirtyGamesSummary.set(game, gameSummaryListIds);

    for (const [ gslId, assign ] of gameSummaryListIds) {
      const gameSummaryList = gameSummaryListCache.get(gslId);
      if (!gameSummaryList) continue;

      if (assign) {
        gameSummaryList.set(game.id, summary);
        this._pruneGameSummaryList(gameSummaryList);
      } else
        gameSummaryList.prune(game.id);
    }
  }
  _clearGameSummary(game) {
    const gameSummaryListCache = this.cache.get('gameSummaryLists');
    const gameSummaryListIds = this._getGameSummaryListIds(game);
    this._dirtyGamesSummary.delete(game);

    for (const [ gslId, assign ] of gameSummaryListIds) {
      if (!assign) continue;

      const gameSummaryList = gameSummaryListCache.get(gslId);
      if (!gameSummaryList) continue;

      gameSummaryList.delete(game.id);
    }
  }
  _applyDirtyGamesSummary(gameSummaryList) {
    for (const [ game, gslIds ] of this._dirtyGamesSummary) {
      if (!gslIds.get(gameSummaryList.id)) continue;

      gameSummaryList.set(game.id, gameSummaryCache.get(game));      
    }
    this._pruneGameSummaryList(gameSummaryList);
  }
  _getGameSummaryListIds(game) {
    // Get a unique list of player IDs from the teams.
    const playerIds = new Set(game.state.teams.filter(t => !!t?.playerId).map(t => t.playerId));
    const gameSummaryListIds = new Map(Array.from(playerIds).map(pId => [ `playerGames#${pId}`, true ]));

    if (game.collection && !game.isReserved)
      gameSummaryListIds.set(game.collection, (() => {
        if (!game.state.endedAt)
          return true;

        const minTurnId = game.state.initialTurnId + 2;
        return game.state.currentTurnId > minTurnId;
      })());

    if (game.state.rated && game.state.endedAt)
      [
        `rated/FORTE`,
        `rated/${game.state.type}`,
        ...Array.from(playerIds).map(pId => [
          `rated/${pId}/FORTE`,
          `rated/${pId}/${game.state.type}`,
        ]).flat(),
      ].forEach(gslId => gameSummaryListIds.set(gslId, true));

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
    if (this.cache.get('playerStats').has(player.id))
      return this.cache.get('playerStats').get(player.id);
    else if (this.buffer.get('playerStats').has(player.id))
      return this.buffer.get('playerStats').get(player.id);

    const playerStats = await this.getItem({
      type: 'playerStats',
      id: player.id,
      name: `player_${player.id}_stats`,
    }, { playerId:player.id }, () => PlayerStats.create(player.id));
    playerStats.player = player;
    playerStats.once('change', () => this.buffer.get('playerStats').add(player.id, playerStats));
    playerStats.on('vs:change', e => this.buffer.get('playerStatsVS').add(`${player.id}:${e.data.vsPlayerId}`, e.data));

    return playerStats;
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
    if (vsPlayerId === playerStats.playerId || playerStats.vs.has(vsPlayerId))
      return;

    const vsStats = await this.getItem({
      type: 'playerStats',
      id: playerStats.playerId,
      path: `/vs/${vsPlayerId}`,
    }, {}, null);
    if (vsStats)
      playerStats.vs.set(vsPlayerId, vsStats);
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
  async _getPlayerGames(playerId, consistent = false, empty = false) {
    const gslId = `playerGames#${playerId}`;
    if (this.cache.get('gameSummaryLists').has(gslId))
      return this.cache.get('gameSummaryLists').get(gslId);

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
  }

  /*
   * Player Rated Games
   */
  async _getPlayerRatedGames(playerId, rankingId) {
    const gslId = `rated/${playerId}/${rankingId}`;
    if (this.cache.get('gameSummaryLists').has(gslId))
      return this.cache.get('gameSummaryLists').get(gslId);

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
    if (this.cache.get('gameSummaryLists').has(collectionId))
      return this.cache.get('gameSummaryLists').get(collectionId);

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
          startedAt: game.state.startedAt,
          endedAt: game.state.endedAt,
        });
        return this.putFile(`game_${game.id}`, serializer.transform(game));
      }).catch(error => {
        if (error.code === 404)
          return null;
        throw error;
      })));
    }

    if (gameIds.length) {
      await this.putFile('game_index', serializer.transform(gameIndex));
      await fs.utimes(`${this.filesDir}/game_index.json`, indexAt, indexAt);
    }

    return gameIndex;
  }
};
