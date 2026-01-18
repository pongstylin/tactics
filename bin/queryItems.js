import util from 'util';
import { search as jp } from '@metrichor/jmespath';

import '#plugins/index.js';
import '#server/AccessToken.js';
import '#models/Game.js';
import '#models/GameSummary.js';
import '#models/Identity.js';
import '#models/TeamSetStats.js';
import '#models/Player.js';
import '#models/PlayerSets.js';
import '#models/PlayerStats.js';
import '#models/Provider.js';
import '#models/Room.js';
import DynamoDBAdapter from '#data/DynamoDBAdapter.js';

const [ PK, SK, order, limit ] = process.argv[2].split(':');
const path = process.argv[3] ?? '$';

const pFilter = (() => {
  const parts = PK.split('=');
  if (parts.length === 1)
    return { key:'PK', val:parts[0] };
  return { key:parts[0], val:parts[1] };
})();
const sFilter = (() => {
  const parts = (SK === undefined || SK === '' ? '/' : SK).split('=');
  if (parts.length === 1)
    return { key:'SK', val:parts[0] };
  return { key:parts[0], val:parts[1] };
})();

const ddb = await new DynamoDBAdapter({ hasState:false, readonly:true }).bootstrap();
const result = await ddb.query({
  filters: { [pFilter.key]:pFilter.val, [sFilter.key]:{ beginsWith:sFilter.val } },
  order: order === undefined || order === '' ? 'ASC' : order,
  limit: limit === undefined || limit === '' ? true : parseInt(limit),
});

console.log(`selector: ${path}`);
console.log(util.inspect(jp(result, path), { depth:null, colors:true }));
ddb.cleanup();
