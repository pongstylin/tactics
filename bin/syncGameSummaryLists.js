import '#plugins/index.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import gameTypes from '#data/files/game/game_types.json' assert { type:'json' };

const gameTypeMap = new Map(gameTypes);
const dataAdapter = new GameAdapter();
await dataAdapter.bootstrap();

for await (const gameId of dataAdapter.listAllGameIds()) {
  console.log('gameId', gameId);
  const game = await dataAdapter._getGame(gameId);
  console.log('gameType', game.state.type);
  if (!gameTypeMap.has(game.state.type))
    continue;
  await dataAdapter._updateGameSummary(game);
}

console.log('Flushing changes to disk');
await dataAdapter.cleanup();

console.log('Sync complete');
