import '#plugins/index.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import gameTypes from '#data/files/game/game_types.json' assert { type:'json' };
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);

const gameTypeMap = new Map(gameTypes);
const dataAdapter = new GameAdapter();
await dataAdapter.bootstrap();

const since = process.argv[2] ? new Date(process.argv[2]) : null;
const queue = [];
let numProcessed = 0;

// queue.push('c8eab32e-d96f-4ffa-9120-2e88abeb2faf');
/*
for (const gs of await dataAdapter.queryItemChildren({
  type: 'collection',
  query: {
    indexKey: 'LSK0',
    indexValue: 'b=',
  },
})) {
  queue.push(gs.id);
  if (queue.length === 100)
    await sync();
}
*/
for await (const gameId of dataAdapter.listAllGameIds(since)) {
  queue.push(gameId);
  if (queue.length === 100)
    await sync();
}

if (queue.length)
  await sync();

await dataAdapter.cleanup();
clearInterval(ticker);
console.log('Sync complete');

async function sync() {
  await Promise.all(queue.map(qId => dataAdapter._getGame(qId).then(game => {
    if (!gameTypeMap.has(game.state.type))
      return;
    return dataAdapter._saveGameSummary(game, true);
  }).catch(error => console.error(error))));
  await dataAdapter.flush();
  console.log('synced', numProcessed += queue.length);
  queue.length = 0;
}
