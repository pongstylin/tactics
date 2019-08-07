import dataFactory from 'data/adapterFactory.js';
import 'plugins/array.js';

const dataAdapter = dataFactory();

dataAdapter.listAllGameIds().then(gameIds => {
  let promise = gameIds.reduce(
    (promise, gameId) => promise.then(() => syncGame(gameId)),
    Promise.resolve(),
  );

  promise.then(() => {
    console.log('Sync complete');
  });
});

async function syncGame(gameId) {
  console.log(`Syncing game ${gameId}...`);

  let game = await dataAdapter.getGame(gameId);
  return dataAdapter._saveGameSummary(game);
}
