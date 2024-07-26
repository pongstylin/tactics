import '#plugins/index.js';
import AuthAdapter from '#data/FileAdapter/AuthAdapter.js';
import GameAdapter from '#data/FileAdapter/GameAdapter.js';
import PlayerStats from '#models/PlayerStats.js';

const dryRun = true;
const authAdapter = new AuthAdapter({ hasState:false, readonly:dryRun });
const gameAdapter = new GameAdapter({ hasState:false, readonly:dryRun });
const playerMeta = new Map();

(async () => {
  await gameAdapter.bootstrap();

  gameAdapter.readonly = false;
  const gameIndex = await gameAdapter.indexAllGames();
  gameAdapter.readonly = dryRun;

  const gameEvents = [];

  for (const [ gameId, index ] of gameIndex.entries()) {
    if (index.startedAt)
      gameEvents.push({ at:index.startedAt, id:gameId, type:'started', index });
    if (index.endedAt)
      gameEvents.push({ at:index.endedAt, id:gameId, type:'ended', index });
  }

  gameEvents.sort((a,b) => a.at - b.at);

  for (const gameEvent of gameEvents) {
    // Need full game object to sync ranked game team ratings.
    const needFullGame = gameEvent.index.ranked && gameEvent.type === 'ended';
    const game = needFullGame ? await gameAdapter._getGame(gameEvent.id) : {
      state:{
        type: gameEvent.index.type,
        rated: gameEvent.index.rated,
        ranked: gameEvent.index.ranked,
        startedAt: gameEvent.index.startedAt,
        endedAt: gameEvent.type === 'started' ? null : gameEvent.index.endedAt,
        winnerId: gameEvent.index.winnerId,
        teams: gameEvent.index.teams,
        teamHasPlayed: t => t.hasPlayed,
        get winner() {
          const winnerId = this.winnerId;
          if (winnerId === null)
            return null;

          return typeof winnerId === 'number' ? this.teams[winnerId] : null;
        },
        get losers() {
          const winnerId = this.winnerId;
          if (winnerId === null)
            return null;

          return this.teams.filter((t,tId) => tId !== winnerId);
        },
      },
    };

    // Approximate game object using indexed data to speed things up.
    await recordGameStats(game);
  }

  await authAdapter.cleanup();
  await gameAdapter.cleanup();

  for (const playerId of playerMeta.keys()) {
    if (playerMeta.get(playerId) === null)
      continue;

    const player = await authAdapter.getPlayer(playerId);
    const playerStats = await gameAdapter.getPlayerStats(playerId);
    const rankingIds = new Set([
      ...playerMeta.get(playerId).keys(),
      ...playerStats.ratings.keys(),
    ]);

    for (const rankingId of rankingIds) {
      const oldRating = playerMeta.get(playerId).get(rankingId)?.rating ?? 750;
      const newRating = playerStats.getRating(rankingId);

      if (oldRating !== newRating)
        console.log(`${player.id}: ${player.name}: ${rankingId}: ${oldRating} => ${newRating}`);
    }
  }
})();

async function recordGameStats(game) {
  const playerIds = Array.from(new Set([ ...game.state.teams.map(t => t.playerId) ]));
  const [ players, playersStats ] = await Promise.all([
    Promise.all(playerIds.map(pId => authAdapter.getPlayer(pId))),
    Promise.all(playerIds.map(pId => gameAdapter.getPlayerStats(pId))),
  ]);
  const playersMap = new Map(players.map(p => [ p.id, p ]));
  const playersStatsMap = new Map(playersStats.map(ps => [ ps.playerId, ps ]));

  for (const playerStats of playersStats) {
    if (playerMeta.has(playerStats.playerId))
      continue;

    if (playersMap.get(playerStats.playerId).isVerified)
      playerMeta.set(playerStats.playerId, playerStats.ratings.clone());
    else
      playerMeta.set(playerStats.playerId, null);

    playerStats.data.stats.clear();
  }

  if (game.state.endedAt) {
    if (game.state.ranked)
      game.state.teams.forEach(t => t.data.ratings = null);

    if (PlayerStats.updateRatings(game, playersStatsMap))
      for (const playerStats of playersStats)
        playersMap.get(playerStats.playerId).identity.setRanks(playerStats.playerId, playerStats.ratings);

    for (const playerStats of playersStats)
      playerStats.recordGameEnd(game);
  } else {
    for (const playerStats of playersStats)
      playerStats.recordGameStart(game);
  }
}
