import dataFactory from 'data/adapterFactory.js';
import 'plugins/array.js';

const dataAdapter = dataFactory();

dataAdapter.listAllPlayerIds().then(playerIds => {
  let promise = playerIds.reduce(
    (promise, playerId) => promise.then(() => modifyPlayerSets(playerId)),
    Promise.resolve(),
  );

  promise.then(() => {
    console.log('Modification complete');
  });
});

async function modifyPlayerSets(playerId) {
  await dataAdapter._lockAndUpdateFile(`player_${playerId}_sets`, [], sets => {
    sets.forEach(set => {
      if (set.name === undefined)
        set.name = 'default';
    });
  });
}
