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
  let hasLegendsGold = await dataAdapter.hasCustomPlayerSet(playerId, 'legendsGold');
  if (hasLegendsGold) return;

  let hasLegendsGoldNoDSM = await dataAdapter.hasCustomPlayerSet(playerId, 'legendsGoldNoDSM');
  if (!hasLegendsGoldNoDSM) return;

  let set = await dataAdapter.getPlayerSet(playerId, 'legendsGold', 'default');
  return dataAdapter.setPlayerSet(playerId, 'legendsGoldNoDSM', 'default', set);
}

dataAdapter.listAllGameIds().then(gameIds => {
  gameIds.reduce(
    (promise, gameId) => promise.then(() => syncGame(gameId)),
    Promise.resolve(),
  );
});

async function syncGame(gameId) {
  let game = await dataAdapter.getGame(gameId);
  if (game.state.type !== 'legendsGold') return;

  game.state.type = 'legendsGoldNoDSM';
  await dataAdapter.saveGame(game);

  return dataAdapter._saveGameSummary(game);
}
