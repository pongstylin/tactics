import '#plugins/index.js';
//import AuthAdapter from '#data/DynamoDBAdapter/AuthAdapter.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';

const playerId = process.argv[2];
const avatar = process.argv[3];

const authAdapter = await new AuthAdapter().bootstrap();
const gameAdapter = await new GameAdapter().bootstrap();
const player = await authAdapter.getPlayer(playerId);
const playerAvatars = await gameAdapter.getPlayerAvatars(player);

const result = playerAvatars.grant(avatar);

await gameAdapter.cleanup();
console.log('Granted', result);
