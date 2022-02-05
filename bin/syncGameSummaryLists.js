import 'plugins/index.js';
import GameAdapter from 'data/FileAdapter/GameAdapter.js';

const dataAdapter = new GameAdapter();
await dataAdapter.bootstrap();

dataAdapter.listAllGameIds().then(gameIds => {
  let promise = gameIds.reduce(
    (promise, gameId) => promise.then(() => syncGame(gameId)),
    Promise.resolve(),
  );

  promise.then(async () => {
    console.log('Flushing changes to disk');
    await dataAdapter.cleanup();

    console.log('Sync complete');
  });
});

async function syncGame(gameId) {
  const game = await dataAdapter._getGame(gameId);
  await dataAdapter._updateGameSummary(game);
}
