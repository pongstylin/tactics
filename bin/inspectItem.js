import { search as jp } from '@metrichor/jmespath';
import '#plugins/index.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

const [ PK, SK ] = process.argv[2].split(':');
const path = process.argv[3] ?? '$';

const ddb = await new DynamoDBAdapter({ hasState:false, readonly:true }).bootstrap();
const item = await ddb.getItem({ PK, SK });

console.log(jp(item, path));
ddb.cleanup();
