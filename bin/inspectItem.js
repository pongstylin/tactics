import util from 'util';
import { search as jp } from '@metrichor/jmespath';

import '#plugins/index.js';
import '#server/AccessToken.js';
import '#models/Game.js';
import '#models/Identity.js';
import '#models/Player.js';
import '#models/PlayerStats.js';
import '#models/Provider.js';
import '#models/Room.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';
import serializer from '#utils/serializer.js';

const [ PK, SK ] = process.argv[2].split(':');
const path = process.argv[3] ?? '$';

const ddb = await new DynamoDBAdapter({ hasState:false, readonly:true }).bootstrap();
const item = await ddb.getItem({ PK, SK:SK ?? '/' });

console.log(`query: ${path}`);
console.log(util.inspect(jp(JSON.parse(serializer.stringify(item)), path), { depth:null, colors:true }));
ddb.cleanup();
