import '#plugins/index.js';
import '#models/Game.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);
const dryRun = false;
const gameAdapter = await new GameAdapter({ hasState:false, readonly:dryRun }).bootstrap();

gameAdapter.readonly = false;
const gamesIndex = await gameAdapter.indexAllGames();
gameAdapter.readonly = dryRun;

for (const gameType of gameAdapter.getGameTypesById().values()) {
  if (gameType.config.archived) continue;

  const gameIds = Array.from(gamesIndex.entries()).filter(gi => gi[1].gameTypeId === gameType.id).map(gi => gi[0]);

  console.log(`Now syncing game summary lists for ${gameIds.length} ${gameType.id} games...`);

  for (let i = 0; i < gameIds.length; i += 50) {
    await Promise.all(gameIds.slice(i, i+50).map(async gId => {
      const game = await gameAdapter.getGameFromFile(gId);
      return gameAdapter._saveGameSummary(game, true);
    }));
    console.log(`Saved ${i+50} of ${gameIds.length} game summary lists.`);
  }
}

await gameAdapter.cleanup();
clearInterval(ticker);
console.log('Sync complete');
