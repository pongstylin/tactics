import '#plugins/index.js';
import AuthAdapter from '#data/DynamoDBAdapter/AuthAdapter.js';

const playerId = process.argv[2];
const dataAdapter = await new AuthAdapter({ useState:false }).bootstrap();
const player = await dataAdapter.getPlayer(playerId);

player.identity.admin = true;

await dataAdapter.cleanup();

console.log(`Player ${playerId} is now an admin. `);
