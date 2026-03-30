import '#plugins/index.js';
import '#models/Game.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import Timeout from '#server/Timeout.js';

// Required for DynamoDBAdapter
const ticker = setInterval(Timeout.tick, 5000);

const gameAdapter = new GameAdapter({ hasState:false });
await gameAdapter.bootstrap();
await gameAdapter.indexAllGames();
await gameAdapter.cleanup();
clearInterval(ticker);
console.log('Index complete');
