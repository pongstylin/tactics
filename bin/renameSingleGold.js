import dataFactory from 'data/adapterFactory.js';
import 'plugins/array.js';

const dataAdapter = dataFactory();

dataAdapter.listAllGameIds().then(gameIds => {
  gameIds.reduce(
    (promise, gameId) => promise.then(() => syncGame(gameId)),
    Promise.resolve(),
  );
});

async function syncGame(gameId) {
  let game = await dataAdapter.getGame(gameId);
  if (game.state.type !== 'singleGold') return;

  game.state.type = 'legendsGold';
  await dataAdapter.saveGame(game);

  return dataAdapter._saveGameSummary(game);
}
