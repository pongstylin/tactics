import '#plugins/index.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';
import AuthAdapter from '#data/DynamoDBAdapter/AuthAdapter.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import PlayerStats from '#models/PlayerStats.js';

// Flush the wcu throttle every minute
setInterval(DynamoDBAdapter.flush, 60 * 1000);

const dryRun = false;
const authAdapter = new AuthAdapter({ hasState:false, readonly:dryRun });
const gameAdapter = new GameAdapter({ hasState:false, readonly:dryRun });
const playerMeta = new Map();

(async () => {
  await gameAdapter.bootstrap();

  gameAdapter.readonly = false;
  const gameIndexMap = await gameAdapter.indexAllGames();
  gameAdapter.readonly = dryRun;

  const gamesIndex = Array.from(gameIndexMap.entries())
    .filter(g => g[1].endedAt !== null && g[1].rated === true)
    .sort((a,b) => a[1].endedAt - b[1].endedAt)
    .map(g => ({ id:g[0], ...g[1] }));

  console.log('Found', gamesIndex.length, 'completed rated games to process');

  for (const [ gii, gameIndex ] of gamesIndex.entries()) {
    if (gii % 100 === 0) {
      // Conserve memory by flushing rating changes to the database
      await gameAdapter.buffer.get('game').flush();
      console.log('Processing game event', gii, 'of', gamesIndex.length);
    }

    // The full game is required to sync team ratings
    const game = await gameAdapter._getGame(gameIndex.id);

    await recordGameStats(game);
  }

  if (dryRun) {
    for (const playerId of playerMeta.keys()) {
      const player = await authAdapter.getPlayer(playerId);
      const rankingIds = new Set([
        ...playerMeta.get(playerId).oldRatings.keys(),
        ...(playerMeta.get(playerId).newRatings?.keys() ?? []),
      ]);

      for (const rankingId of rankingIds) {
        const oldRating = playerMeta.get(playerId).oldRatings.get(rankingId)?.rating ?? 750;
        const newRating = playerMeta.get(playerId).newRatings?.get(rankingId)?.rating ?? 750;

        if (oldRating !== newRating)
          console.log(`${player.id}: ${player.name}: ${rankingId}: ${oldRating} => ${newRating}`);
      }
    }
  }

  await new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('Press any key to continue with cleanup...\n');

    process.stdin.on('data', () => {
      process.stdin.pause();
      resolve();
    });
  });

  console.log('Cleanup start!');

  await authAdapter.cleanup();
  await gameAdapter.cleanup();

  console.log('Cleanup done!');
})();

async function recordGameStats(game) {
  const playerIds = Array.from(new Set([ ...game.state.teams.map(t => t.playerId) ]));
  const players = await Promise.all(playerIds.map(pId => authAdapter.getPlayer(pId)));
  const playersStats = await Promise.all(players.map(p => gameAdapter.getPlayerStats(p)));
  const playersMap = new Map(players.map(p => [ p.id, p ]));
  const playersStatsMap = new Map(playersStats.map(ps => [ ps.playerId, ps ]));

  for (const playerStats of playersStats) {
    const myStats = playerStats.data.stats.get(playerStats.playerId);
    if (!playerMeta.has(playerStats.playerId))
      playerMeta.set(playerStats.playerId, { oldRatings:myStats.ratings.clone(), newRatings:new Map() });

    myStats.ratings = playerMeta.get(playerStats.playerId).newRatings;
  }

  if (PlayerStats.updateRatings(game, playersStatsMap))
    for (const playerStats of playersStats)
      playersMap.get(playerStats.playerId).identity.setRanks(playerStats.playerId, playerStats.ratings);
}
