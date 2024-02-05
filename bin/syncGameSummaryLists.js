import '#plugins/index.js';
import GameAdapter from '#data/FileAdapter/GameAdapter.js';
import gameTypes from '#data/files/game/game_types.json' assert { type:'json' };

const gameTypeMap = new Map(gameTypes);
const dataAdapter = new GameAdapter();
await dataAdapter.bootstrap();

dataAdapter.listAllGameIds().then(gameIds => {
  const promise = gameIds.reduce(
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
  if (!gameTypeMap.has(game.state.type))
    return;
  await dataAdapter._updateGameSummary(game);
}
