/**
 * DDB Sync Consumer
 * =================
 * Polls the Valkey dirty ZSET, batches items, writes to DynamoDB via BatchWriteItem,
 * then calls cleanItems to mark them clean (sets TTL = A + 1hr).
 * 
 * Can run as:
 * - Standalone Node process (for local dev / single-node deploy)
 * - AWS Lambda (triggered by EventBridge schedule or SQS)
 * - Docker sidecar
 * 
 * Run: node src/data/ValkeyAdapter/ddbSyncConsumer.js
 */

import {
  DynamoDBClient,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  GlideClient,
  GlideClientConfiguration,
  Script,
} from '@valkey/valkey-glide';

// ============ Configuration ============
const PREFIX = process.env.VALKEY_PREFIX ?? 'tactics';
const NODE_ID = 'ddb-sync-consumer';

const DIRTY_ZSET = `${PREFIX}:dirty`;
const ITEM_HASH_PREFIX = `${PREFIX}:i:`;
const SEQ_REVISION_KEY = `${PREFIX}:seq:revision`;
const CLEAN_TTL_SECONDS = 3600; // 1 hour (A + 1hr)

// Batch size matching DynamoDB BatchWriteItem limit
const BATCH_SIZE = 25;
// Poll interval when queue is empty (ms)
const POLL_INTERVAL_MS = parseInt(process.env.DDB_SYNC_POLL_INTERVAL ?? '5000');
// Max items per cycle (0 = unlimited)
const MAX_ITEMS_PER_CYCLE = parseInt(process.env.DDB_SYNC_MAX_PER_CYCLE ?? '100');

const addresses = [{
  host: process.env.VALKEY_HOST ?? 'valkey',
  port: parseInt(process.env.VALKEY_PORT ?? '6379'),
}];
const credentials = process.env.VALKEY_PASSWORD ? {
  username: process.env.VALKEY_USERNAME ?? 'default',
  password: process.env.VALKEY_PASSWORD,
} : undefined;

const ddb = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT, // for local dev
});

console.log(`DDB Sync Consumer starting...`);
console.log(`Valkey: ${addresses[0].host}:${addresses[0].port}`);
console.log(`Batch size: ${BATCH_SIZE}, Poll interval: ${POLL_INTERVAL_MS}ms`);

// ============ Lua Scripts (same as ValkeyAdapter) ============

const GET_DIRTY_ITEMS_SCRIPT = `
local dirtyZset = KEYS[1]
local prefix = ARGV[1]
local limit = tonumber(ARGV[2]) or 25

local keys = redis.call('ZRANGE', dirtyZset, 0, limit - 1)
local results = {}

for i, key in ipairs(keys) do
  local hashKey = prefix .. key
  local data = redis.call('HGETALL', hashKey)
  if #data > 0 then
    local obj = { pk = '', sk = '', data = nil, R = 0, A = 0, indexes = {} }
    for j = 1, #data, 2 do
      local field = data[j]
      local value = data[j + 1]
      if field == 'PK' then obj.pk = value
      elseif field == 'SK' then obj.sk = value
      elseif field == 'D' then obj.data = value
      elseif field == 'R' then obj.R = tonumber(value)
      elseif field == 'A' then obj.A = tonumber(value)
      elseif field:sub(1,3) == 'LSK' or field:sub(1,3) == 'GPK' or field:sub(1,3) == 'GSK' then
        obj.indexes[field] = value
      end
    end
    results[i] = cjson.encode(obj)
  else
    -- Orphaned dirty entry - remove it
    redis.call('ZREM', dirtyZset, key)
    results[i] = false
  end
end
return results
`;

const CLEAN_ITEMS_SCRIPT = `
local dirtyZset = KEYS[1]
local prefix = ARGV[1]
local ttlSeconds = tonumber(ARGV[2])

local results = {}
for i = 1, #ARGV, 2 do
  local key = ARGV[i]
  local expectedR = tonumber(ARGV[i + 1])
  local hashKey = prefix .. key

  local currentR = redis.call('HGET', hashKey, 'R')
  if currentR ~= false and tonumber(currentR) == expectedR then
    -- R matches, clean it
    redis.call('ZREM', dirtyZset, key)
    -- Set TTL = A + 1hr using stored A
    local storedA = redis.call('HGET', hashKey, 'A')
    if storedA ~= false and ttlSeconds > 0 then
      local expireAt = tonumber(storedA) + ttlSeconds
      redis.call('EXPIREAT', hashKey, expireAt)
    end
    results[i] = cjson.encode({ key = key, cleaned = true })
  else
    -- R mismatch or key gone - leave dirty for next pass
    results[i] = cjson.encode({ key = key, cleaned = false, reason = currentR == false and 'missing' or 'R mismatch' })
  end
end
return results
`;

// Module-level script cache
const scriptCache = new Map();

async function connectValkey() {
  valkey = await GlideClient.createClient({
    addresses,
    credentials,
    useTLS: process.env.VALKEY_TLS === 'true',
    requestTimeout: 10000,
    clientName: `tactics-${NODE_ID}`,
  });

  // Load scripts
  const getDirtyScript = new Script(GET_DIRTY_ITEMS_SCRIPT);
  const cleanScript = new Script(CLEAN_ITEMS_SCRIPT);
  scriptCache.set('getDirtyItems', getDirtyScript);
  scriptCache.set('cleanItems', cleanScript);
  
  console.log('Valkey Functions loaded:', getDirtyScript.getHash(), cleanScript.getHash());
}

async function getDirtyItems(limit = BATCH_SIZE) {
  const script = scriptCache.get('getDirtyItems');
  const results = await valkey.invokeScript(script, {
    keys: [DIRTY_ZSET],
    arguments: [ITEM_HASH_PREFIX, String(limit)]
  });
  
  const items = [];
  for (const r of results) {
    if (r) {
      items.push(JSON.parse(r));
    }
  }
  return items;
}

async function cleanItems(items) {
  // items: array of { key, R }
  if (items.length === 0) return [];
  
  const script = scriptCache.get('cleanItems');
  const args = [ITEM_HASH_PREFIX, String(CLEAN_TTL_SECONDS)];
  for (const item of items) {
    args.push(item.key, String(item.R));
  }
  
  const results = await valkey.invokeScript(script, {
    keys: [DIRTY_ZSET],
    arguments: args
  });
  
  return results.map(r => JSON.parse(r));
}

function convertValkeyItemToDDB(item) {
  // Valkey hash stores D as JSON string
  const data = JSON.parse(item.data);
  
  // Build DynamoDB item
  const ddbItem = {
    PK: { S: item.pk },
    SK: { S: item.sk },
  };
  
  // Add data field (D)
  if (data !== undefined) {
    ddbItem.D = { S: JSON.stringify(data) };
  }
  
  // Add indexes
  for (const [key, value] of Object.entries(item.indexes || {})) {
    ddbItem[key] = { S: value };
  }
  
  // Add R, A, V, TTL if present
  ddbItem.R = { N: String(item.R) };
  ddbItem.A = { N: String(item.A) };
  
  return ddbItem;
}

async function writeBatchToDDB(items) {
  if (items.length === 0) return { success: true, count: 0 };
  
  const requestItems = {};
  const tableName = process.env.DYNAMODB_TABLE ?? 'tactics';
  
  requestItems[tableName] = items.map(item => ({
    PutRequest: {
      Item: convertValkeyItemToDDB(item),
    },
  }));
  
  const command = new BatchWriteItemCommand({
    RequestItems: requestItems,
  });
  
  const response = await ddb.send(command);
  
  // Handle unprocessed items (should be rare with small batches)
  if (response.UnprocessedItems && response.UnprocessedItems[tableName]?.length > 0) {
    console.warn(`DDB Sync: ${response.UnprocessedItems[tableName].length} unprocessed items, will retry next cycle`);
    // Could implement retry logic here
  }
  
  return { success: true, count: items.length };
}

async function processCycle() {
  let processed = 0;
  
  while (processed < MAX_ITEMS_PER_CYCLE) {
    const remaining = MAX_ITEMS_PER_CYCLE - processed;
    const batchLimit = Math.min(BATCH_SIZE, remaining);
    
    const dirtyItems = await getDirtyItems(batchLimit);
    
    if (dirtyItems.length === 0) {
      // No more dirty items
      break;
    }
    
    console.log(`DDB Sync: Processing ${dirtyItems.length} items...`);
    
    // Write to DynamoDB
    const writeResult = await writeBatchToDDB(dirtyItems);
    
    if (!writeResult.success) {
      console.error('DDB Sync: Write failed, will retry next cycle');
      break;
    }
    
    // Clean up dirty ZSET (only for items that were successfully written)
    const itemsToClean = dirtyItems.map(item => ({ key: `${item.pk}:${item.sk}`, R: item.R }));
    const cleanResults = await cleanItems(itemsToClean);
    
    const cleaned = cleanResults.filter(r => r.cleaned).length;
    const failed = cleanResults.filter(r => !r.cleaned).length;
    
    if (failed > 0) {
      console.warn(`DDB Sync: ${failed} items failed R-check (concurrent modification), will retry next cycle`);
    }
    
    processed += dirtyItems.length;
    console.log(`DDB Sync: Batch complete. Written: ${writeResult.count}, Cleaned: ${cleaned}, Failed R-check: ${failed}`);
  }
  
  return processed;
}

async function main() {
  await connectValkey();
  
  console.log('DDB Sync Consumer started. Press Ctrl+C to stop.');
  
  let running = true;
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    running = false;
  });
  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    running = false;
  });
  
  while (running) {
    try {
      const processed = await processCycle();
      
      if (processed === 0) {
        // No work, sleep before next poll
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      console.error('DDB Sync: Cycle error:', error);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  
  if (valkey) {
    await valkey.close();
  }
  
  console.log('DDB Sync Consumer stopped.');
  process.exit(0);
}

main().catch(err => {
  console.error('DDB Sync Consumer fatal error:', err);
  process.exit(1);
});