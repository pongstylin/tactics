import dataFactory from 'data/adapterFactory.js';
import 'plugins/array.js';

const dataAdapter = dataFactory();

dataAdapter.listAllPlayerIds().then(playerIds => {
  playerIds.reduce(
    (promise, playerId) => promise.then(() => modifyPlayerSets(playerId)),
    Promise.resolve(),
  );
});

async function modifyPlayerSets(playerId) {
  let hasFPSGray = await dataAdapter.hasCustomPlayerSet(playerId, 'fpsGray');
  if (hasFPSGray) return;

  let hasFreestyle = await dataAdapter.hasCustomPlayerSet(playerId, 'freestyle');
  if (!hasFreestyle) return;

  let freestyle = await dataAdapter.getDefaultPlayerSet(playerId, 'freestyle');
  return dataAdapter.setDefaultPlayerSet(playerId, 'fpsGray', freestyle);
}

dataAdapter.listAllGameIds().then(gameIds => {
  gameIds.reduce(
    (promise, gameId) => promise.then(() => syncGame(gameId)),
    Promise.resolve(),
  );
});

async function syncGame(gameId) {
  let game = await dataAdapter.getGame(gameId);
  if (game.state.type !== 'freestyle') return;

  game.state.type = 'fpsGray';
  await dataAdapter.saveGame(game);

  return dataAdapter._saveGameSummary(game);
}
