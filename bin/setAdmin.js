import '#plugins/index.js';
import AuthAdapter from '#data/DynamoDBAdapter/AuthAdapter.js';

const playerId = process.argv[2];
const dataAdapter = await new AuthAdapter({ hasState:false }).bootstrap();
const player = await dataAdapter.getPlayer(playerId);
const wasAdmin = player.identity.admin;

player.identity.admin = true;

await dataAdapter.cleanup();

if (wasAdmin)
  console.log(`Player ${playerId} was already an admin. `);
else
  console.log(`Player ${playerId} is now an admin. `);
