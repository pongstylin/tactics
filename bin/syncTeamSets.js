import '#plugins/index.js';
import '#models/Game.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import TeamSet from '#models/TeamSet.js';
import TeamSetCardinality from '#models/TeamSetCardinality.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);
const dryRun = false;
const gameAdapter = await new GameAdapter({ hasState:false, readonly:dryRun }).bootstrap();

gameAdapter.readonly = false;
const gamesIndex = await gameAdapter.indexAllGames();
gameAdapter.readonly = dryRun;

const gameIds = Array.from(gamesIndex.entries()).filter(gi => !!gi[1].endedAt).sort((a,b) => a[1].endedAt - b[1].endedAt).map(gi => gi[0]);

console.log(`Now syncing team set cardinality for ${gameIds.length} ended games...`);

// Reset cardinality
for (const gameTypeId of gameAdapter._teamSetCardinalities.keys()) {
  const tsc = TeamSetCardinality.create(gameTypeId);
  tsc.gameType = gameAdapter.getGameType(gameTypeId);
  gameAdapter._teamSetCardinalities.set(gameTypeId, tsc);
}

const counts = { total:0, archived:0, practice:0, incomplete:0, applied:0 };
const teamSets = new Map();
for (let i = 0; i < gameIds.length; i += 100) {
  const games = await Promise.all(gameIds.slice(i, i+100).map(gId => gameAdapter.getGameFromFile(gId, teamSets)));
  for (const game of games) {
    counts.total++;
    if (!game.state.gameType || game.state.gameType.config.archived) {
      counts.archived++;
      continue;
    }
    if (game.state.isPracticeMode) {
      counts.practice++;
      continue;
    }
    if (game.state.teams.some(t => !game.state.gameType.validateSetIsFull(t.set.units))) {
      counts.incomplete++;
      continue;
    }

    TeamSet.applyGame(game);

    counts.applied++;
    if (counts.applied % 200 === 0)
      console.log(`Applied ${counts.applied} of ${gameIds.length} games.`, counts);
  }
}

for (const cardinality of gameAdapter._teamSetCardinalities.values())
  cardinality.optimize();

console.log(`Total teamSetStats: ${teamSets.size}`)
console.log(`Game counts:`, counts);

await gameAdapter.flush();
console.log(`Saved team sets`);

await Promise.all(Array.from(gameAdapter._teamSetCardinalities.values()).map(tsc => gameAdapter._saveTeamSetCardinality(tsc)));
console.log('Saved cardinality');

const queue = Array.from(teamSets.values()).filter(tss => !!tss.updatedAt);
for (let i = 0; i < queue.length; i += 100) {
  await Promise.all(queue.slice(i, i+100).map(ts => gameAdapter._saveTeamSetStats(ts, true)));
  console.log(`Saved ${i+100} of ${queue.length} team set stats`);
  await gameAdapter.flush();
  console.log(`Saved ${i+100} of ${queue.length} team set indexes`);
}

await gameAdapter.cleanup();
clearInterval(ticker);
