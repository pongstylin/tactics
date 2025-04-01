import { search as jp } from '@metrichor/jmespath';
import GameAdapter from '#data/DynamoDBAdapter/GameAdapter.js';
import '#plugins/index.js';

const gameId = process.argv[2];
const path = process.argv[3];

const gameAdapter = await new GameAdapter({ hasState:false, readonly:true }).bootstrap();
const game = await gameAdapter.getGame(gameId);

console.log(jp(game, path));
