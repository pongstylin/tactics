import '#plugins/index.js';
import '#models/Game.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import TeamSet from '#models/TeamSet.js';
import TeamSetCardinality from '#models/TeamSetCardinality.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);
const initial = true;
const dryRun = false;
const gameAdapter = await new GameAdapter({ hasState:false, readonly:dryRun }).bootstrap();

gameAdapter.readonly = false;
const gamesIndex = await gameAdapter.indexAllGames();
gameAdapter.readonly = dryRun;

for (const gameType of gameAdapter.getGameTypesById().values()) {
  if (gameType.config.archived) continue;

  const gameIds = Array.from(gamesIndex.entries()).filter(gi => (
    !!gi[1].endedAt && gi[1].gameTypeId === gameType.id
  )).sort((a,b) => a[1].endedAt - b[1].endedAt).map(gi => gi[0]);

  console.log(`Now syncing team set cardinality for ${gameIds.length} ${gameType.id} games...`);

  // Reset cardinality
  const cardinality = TeamSetCardinality.create(gameType.id);
  cardinality.gameType = gameType;
  gameAdapter._teamSetCardinalities.set(gameType.id, cardinality);

  const counts = { total:0, archived:0, practice:0, incomplete:0, applied:0, indexed:0 };
  const teamSets = new Map();
  for (let i = 0; i < gameIds.length; i += 100) {
    const games = await Promise.all(gameIds.slice(i, i+100).map(gId => gameAdapter.getGameFromFile(gId, teamSets, initial)));
    for (const game of games) {
      counts.total++;
      if (game.state.isPracticeMode) {
        counts.practice++;
        continue;
      }
      if (game.state.teams.some(t => !gameType.validateSetIsFull(t.set.units))) {
        counts.incomplete++;
        continue;
      }

      TeamSet.applyGame(game);

      const gslIds = gameAdapter._getGameSummaryListIds(game);
      for (const gslId of gslIds.keys())
        if (!gslId.startsWith('teamSetGames#'))
          gslIds.delete(gslId);
      if (gslIds.size) {
        counts.indexed++;
        gameAdapter._saveGameSummary(game, true, new Date().toISOString(), gslIds);
      }

      counts.applied++;
      if (counts.applied % 200 === 0)
        console.log(`Applied ${counts.applied} of ${gameIds.length} games.`, counts);
    }
  }

  cardinality.optimize();

  console.log(`Total ${gameType.id} teamSets: ${teamSets.size}`)
  console.log(`${gameType.id} game counts:`, counts);

  await gameAdapter._saveTeamSetCardinality(cardinality);
  console.log(`Saved ${gameType.id} cardinality`);

  const queue = Array.from(teamSets.values()).filter(ts => !!ts.updatedAt);
  console.log(`Saving ${queue.length} of ${teamSets.size} team sets.`);
  for (let i = 0; i < queue.length; i += 100) {
    await Promise.all(queue.slice(i, i+100).map(ts => gameAdapter._saveTeamSetStats(ts, true)));
    console.log(`Saved ${i+100} of ${queue.length} team set stats`);
    await gameAdapter.flush();
    console.log(`Saved ${i+100} of ${queue.length} team set indexes`);
  }
}

await gameAdapter.cleanup();
clearInterval(ticker);
