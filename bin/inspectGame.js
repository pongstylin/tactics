import { search as jp } from '@metrichor/jmespath';
import '#plugins/index.js';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';

const gameId = process.argv[2];
const path = process.argv[3];

const gameAdapter = await new GameAdapter({ hasState:false, readonly:true }).bootstrap();
const game = await gameAdapter.getGame(gameId);

console.log(jp(game, path));
