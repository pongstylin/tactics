import '#plugins/index.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import Game from '#models/Game.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);
const readonly = true;

const dataAdapter = new GameAdapter({ readonly });
await dataAdapter.bootstrap();

const since = process.argv[2] ? new Date(process.argv[2]) : null;
const gameCache = new Map();
const itemsToDelete = new Set();
const gamesToSync = new Map();
let counter = 0;

//for (const [ PK, SK ] of [ [ 'playerGames#fad0fc17-e8c6-4a35-874e-6841ac69dbf4','gameSummary#510af1ae-c245-4924-93ec-cfa848522d65' ] ]) {
for await (const [ PK, SK ] of dataAdapter.listAllGameSummaryKeys(since, 'DESC')) {
  const gameId = SK.slice(12);
  const cache = gameCache.get(gameId) ?? {};
  const gameParts = cache.gameParts ?? (cache.gameParts = await dataAdapter.getItemParts({
    id: gameId,
    type: 'game',
  }));
  if (gameCache.size === 100)
    gameCache.delete(gameCache.keys().next().value);

  if (gameParts.size === 0) {
    console.log('Game not found: ', PK, gameId);
    await dataAdapter.deleteItem({ PK, SK });
  } else if (!gameParts.has('/')) {
    console.log('Game broken: ', PK, gameId);
    await dataAdapter.deleteItem({ PK, SK });
    await Promise.all(Array.from(gameParts.keys()).map(k => dataAdapter.deleteItem({ PK:`game#${gameId}`, SK:k })));
  } else {
    const game = await dataAdapter._getGame(gameId);

    if (needsSync(game, await dataAdapter.getItem({ PK, SK }))) {
      console.log('Game needs sync: ', PK, gameId);
      await dataAdapter._saveGame(game, { sync:true });
    }
  }

  gameCache.set(gameId, cache);
  if ((++counter % 10000) === 0)
    console.log('Progress', counter);
}

await dataAdapter.cleanup();
clearInterval(ticker);
console.log('Audit complete');

function needsSync(game, gameSummary) {
  if (gameSummary.mode === 'fork')
    return false;

  return game.updatedAt.getTime() !== gameSummary.updatedAt.getTime();
}
