import '#plugins/index.js';
import AuthAdapter from '#data/DynamoDBAdapter/AuthAdapter.js';
import Player from '#models/Player.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);
const readonly = true;
const authAdapter = await new AuthAdapter({ readonly }).bootstrap();
const playerNameCache = new Set();

for await (const playerId of authAdapter.listAllPlayerIds()) {
  const player = await authAdapter._getPlayer(playerId);
  if (player.name === null || playerNameCache.has(player.name)) continue;
  playerNameCache.add(player.name);

  try {
    await Player.validatePlayerName(player.name, player.identity, false, Infinity);
    console.log(player.name, 'valid');
    continue;
  } catch (e) {
    if (e.message === 'The name is currently in use') {
      console.log(player.name, 'in use');
      continue;
    }
    console.log(player.name, 'invalid:', e.message);
  }

  if (!readonly) {
    for (let i = 1; i < 100; i++) {
      try {
        await player.updateProfile({ name:i === 1 ? 'Noob' : `Noob${i}` }, true);
        continue;
      } catch (e) {}
    }
  }
}

await authAdapter.cleanup();
clearInterval(ticker);
console.log('change complete');
