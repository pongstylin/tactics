import dataFactory from 'data/adapterFactory.js';
import unitDataMap from 'tactics/unitData.js';
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
      let units = set.units;
      let dragonCount = units.filter(u => u.type === 'DragonTyrant').length;
      let speakerCount = units.filter(u => u.type === 'DragonspeakerMage').length;
      let mageCount = units.filter(u => ['DragonspeakerMage','Pyromancer'].includes(u.type)).length;

      if (!dragonCount || !speakerCount)
        return;

      let dragonData = unitDataMap.get('DragonTyrant');
      let maxDragonPower = 12 * speakerCount * mageCount;
      let dragonPower = Math.min(maxDragonPower, dragonData.power);
      let dragonModifier = -dragonPower;
      let mageModifier = Math.round(dragonPower * dragonCount / mageCount);

      units.forEach(unit => {
        if (unit.type === 'DragonTyrant')
          unit.mPower = dragonModifier;
        else if (['DragonspeakerMage','Pyromancer'].includes(unit.type))
          unit.mPower = mageModifier;
      });
    });
  });
}
