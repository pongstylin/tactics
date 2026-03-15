import '#plugins/index.js';
import AuthAdapter from '#data/DynamoDBAdapter/AuthAdapter.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);
const readonly = true;
const authAdapter = await new AuthAdapter({ readonly }).bootstrap();
const gameAdapter = await new GameAdapter({ readonly }).bootstrap();

for await (const playerId of authAdapter.listAllPlayerIds()) {
  const player = await authAdapter._getPlayer(playerId);
  const playerAvatars = await gameAdapter._getPlayerAvatars(playerId);

  if (player.id === 'e4aff2a2-676a-412c-9b9e-8289619623b5') {
    console.log('player-1', playerId, player.name, player.createdAt, playerAvatars.list);
  }
  if (playerAvatars.list.includes('LightningWard')) {
    console.log('player-2', playerId, player.name, player.createdAt);
  }
  if (player.name === 'Lord White') {
    console.log('player-3', playerId, player.name, player.createdAt, playerAvatars.list);
  }
}

await authAdapter.cleanup();
await gameAdapter.cleanup();
clearInterval(ticker);
console.log('search complete');
