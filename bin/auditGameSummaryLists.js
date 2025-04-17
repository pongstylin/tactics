import '#plugins/index.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);

const dataAdapter = new GameAdapter();
await dataAdapter.bootstrap();

const since = process.argv[2] ? new Date(process.argv[2]) : null;
const dryrun = false;
const gameCache = new Map();
const itemsToDelete = new Set();
let counter = 0;

for await (const [ PK, SK ] of dataAdapter.listAllGameSummaryKeys(since)) {
  const gameId = SK.slice(12);
  const gameParts = gameCache.get(gameId) ?? await dataAdapter.getItemParts({
    id: gameId,
    type: 'game',
  }, parts => parts);
  gameCache.set(gameId, gameParts);
  if (gameCache.size === 100)
    gameCache.delete(gameCache.keys().next().value);

  if (gameParts.size === 0) {
    Array.from(gameParts.keys()).forEach(k => itemsToDelete.add(`game#${gameId}:${k}`));
    itemsToDelete.add(`${PK}:${SK}`);
    console.log('Game not found: ', gameId);
  } else if (!gameParts.has('/')) {
    Array.from(gameParts.keys()).forEach(k => itemsToDelete.add(`game#${gameId}:${k}`));
    itemsToDelete.add(`${PK}:${SK}`);
    console.log('Game broken: ', gameId);
  }
  if ((++counter % 1000) === 0)
    console.log('Progress', counter);
}

if (dryrun)
  Array.from(itemsToDelete.values()).forEach(i => console.log('Delete Item', i));
else
  await Promise.all(
    Array.from(itemsToDelete.values()).map(i => i.split(':')).map(([ PK, SK ]) => dataAdapter.deleteItem({ PK, SK }))
  );

await dataAdapter.cleanup();
clearInterval(ticker);
console.log('Audit complete');
