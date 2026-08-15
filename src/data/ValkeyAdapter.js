/*
 * ValkeyAdapter
 * =============
 * A drop-in replacement for DynamoDBAdapter that adds a shared, cluster-wide
 * cache tier (Valkey, via the official `valkey-glide` client) in front of
 * DynamoDB.
 *
 * See the accompanying chat write-up for the full design discussion. Short
 * version:
 *
 *  - PUBLIC interface unchanged. Only the low-level, DynamoDB-touching
 *    primitives (`_getItemBatch`, `_writeItemExec`, `_writeItemBatch`,
 *    `_queryItemChildren`) are overridden. Everything above that (queueing,
 *    dedup, priority, `getItemParts`/`putItemParts`/`query`/`_query`/
 *    `deleteItems`/...) is inherited unchanged and still talks to DynamoDB
 *    directly - see "Known gaps" at the bottom.
 *
 *  - Single-item reads/writes are cached in Valkey (read-through on miss,
 *    write-through on save) instead of going straight to DynamoDB. Writes
 *    are additionally appended to a Valkey Stream ("dirty queue") for a
 *    Lambda (or any XREADGROUP consumer) to persist to DynamoDB
 *    asynchronously, and published to a channel so other app nodes can
 *    react (see `ValkeyAdapter.on('itemChange', ...)`).
 *
 *  - `queryItemChildren` (the partition-scoped LSK/SK range queries behind
 *    GameSummaryList / playerGames / collections) is backed by a Valkey
 *    sorted set PER (partition, index) that is maintained incrementally on
 *    every write - see "Index maintenance" below. This is a live index, not
 *    a cached snapshot, so there's no separate invalidation step for it.
 *
 *  - IMPORTANT: mutate, don't replace, resident cached objects.
 *    `itemChange` notifications should be used to patch an object already
 *    sitting in a `Model.cache` (via `.peek(id)`, never `.use(id)`/force
 *    creating one) in place, exactly like `_updateGameSummary` already does
 *    for `GameSummaryList`/`gameSummaryCache`. Replacing the cached instance
 *    would break anything already holding a reference to it (event
 *    listeners, other lists, sockets, etc.) and would fight the WeakRef-ish
 *    "only one instance alive at a time" cache contract. The actual
 *    model-specific "apply this update in place" logic has to live with
 *    each model class; this file only guarantees the notification carries
 *    enough information (the fresh, normalized object) to do that.
 */
import crypto from 'crypto';
import {
  GlideClient,
  GlideClientConfiguration,
  Script,
} from '@valkey/valkey-glide';
import { BatchError, Queue, QueueEvents, Worker } from 'glide-mq';

import DynamoDBAdapter from '#data/DynamoDBAdapter.js';
import ServerError from '#server/Error.js';
import createJsonId from '#utils/createJsonId.js';
import emitter from '#utils/emitter.js';
import serializer from '#utils/serializer.js';

let i = 0;
setInterval(() => console.log('ping', i++), 1000);

const NODE_ID = crypto.randomUUID();

const DIRTY_STREAM = `dirty:stream`;
const DIRTY_STREAM_MAXLEN = parseInt(process.env.VALKEY_DIRTY_STREAM_MAXLEN ?? '1000000');
const DIRTY_CONSUMER_GROUP = process.env.VALKEY_DIRTY_CONSUMER_GROUP ?? 'ddb-writer';
const CHANNEL = `invalidate`;
// Safety-net TTL for cache entries that don't otherwise carry a DynamoDB
// TTL, so a bug can't grow the cache unbounded. `0` disables it.
const DEFAULT_CACHE_TTL = parseInt(process.env.VALKEY_DEFAULT_TTL ?? '0');
// Local Secondary Index slots supported by DynamoDBAdapter (see its own
// `keyAttributes`). Only these + plain SK are indexed in Valkey; GPK/GSK
// (global, cross-partition) indexes are out of scope here - see bottom.
const LSK_SLOTS = [ 0, 1, 2, 3, 4, 5 ];

// glide-mq queue names
const GENERAL_QUEUE_NAME = `general-queue`;
const READ_BATCH_QUEUE_NAME = `read-batch-queue`;

// Lock duration for stall recovery - 30s default. Jobs taking longer should
// extend via heartbeat. Values below 5s risk false stall detection under load.
const GMQ_LOCK_DURATION = parseInt(process.env.GMQ_LOCK_DURATION ?? '30000');
// Lock renewal interval - how often the worker renews its lock
const GMQ_LOCK_RENEWAL = parseInt(process.env.GMQ_LOCK_RENEWAL ?? '10000');

const addresses = [{
  host: process.env.VALKEY_HOST ?? 'valkey',
  port: parseInt(process.env.VALKEY_PORT ?? '6379'),
}];
const credentials = process.env.VALKEY_PASSWORD ? {
  username: process.env.VALKEY_USERNAME ?? 'default',
  password: process.env.VALKEY_PASSWORD,
} : undefined;

console.log(`Using Valkey endpoint: ${addresses[0].host}:${addresses[0].port}`);

// GLIDE ties pub/sub subscriptions to client creation (they can't be added
// to an already-open regular client), so we keep a dedicated listening
// client separate from the client used for normal commands.
const connection = {
  addresses,
  credentials,
  useTLS: process.env.VALKEY_TLS === 'true',
  requestTimeout: 10000,
};
const valkey = await GlideClient.createClient({
  ...connection,
  clientName: `tactics-${NODE_ID}`,
});
const valkeySub = await GlideClient.createClient({
  ...connection,
  clientName: `tactics-${NODE_ID}-sub`,
  pubsubSubscriptions: {
    channelsAndPatterns: {
      [GlideClientConfiguration.PubSubChannelModes.Exact]: new Set([ CHANNEL ]),
    },
    callback: (msg) => {
      try {
        const { PK, SK, op, origin, data } = JSON.parse(msg.payload);
        // Ignore notifications for changes this same process just made;
        // it already applied them locally.
        if (origin === NODE_ID)
          return;

        ValkeyAdapter.emit('itemChange', { PK, SK, op, data });
      } catch (error) {
        console.error('Valkey: received malformed invalidation message', msg.payload, error);
      }
    },
  },
});

// Make sure a consumer group exists so a Lambda (or a local dev script) can
// use XREADGROUP for reliable, ack'd, at-least-once processing of the dirty
// queue. Using customCommand here (rather than a wrapper method) since the
// exact node.js method name/signature for XGROUP CREATE has moved around
// across valkey-glide releases - worth double checking against whatever
// version ends up pinned in package.json.
try {
  await valkey.customCommand([ 'XGROUP', 'CREATE', DIRTY_STREAM, DIRTY_CONSUMER_GROUP, '$', 'MKSTREAM' ]);
} catch (error) {
  if (!String(error.message).includes('BUSYGROUP'))
    throw error;
}

// ============================================================
// Valkey Functions (Lua scripts) - loaded at startup
// These provide atomic operations for the queue workers
// ============================================================
// TODO: Replace these scripts with true Valkey Functions and replace them on app startup.
const DIRTY_ZSET = `dirty:zset`;     // ZSET: score=timestamp, member="{PK}:{SK}"

const GET_ITEMS_SCRIPT = `
local dirtyZset = ARGV[1]
local now = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])
local results = {}
for i, itemKey in ipairs(KEYS) do
  local hashKey = 'i:' .. itemKey
  local data = redis.call('HGETALL', hashKey)
  if #data > 0 then
    -- Parse hash into table
    local obj = { K = '', I = nil, R = 0, A = 0, dirty = false }
    for j = 1, #data, 2 do
      local field = data[j]
      local value = data[j + 1]
      if field == 'K' then obj.K = value
      elseif field == 'I' then obj.I = value
      elseif field == 'R' then obj.R = tonumber(value)
      elseif field == 'A' then obj.A = tonumber(value)
      end
    end

    -- Update A (last access time)
    redis.call('HSET', hashKey, 'A', now)

    -- Refresh TTL if not dirty
    -- Check if dirty
    local dirty = redis.call('ZSCORE', dirtyZset, itemKey) ~= false
    if not dirty and ttlSeconds > 0 then
      redis.call('EXPIRE', hashKey, ttlSeconds)
    end

    results[i] = cjson.encode(obj)
  else
    results[i] = false
  end
end
return results
`;
/*
 * Atomically write one entity.
 * An entity may be composed of multiple DDB items.
 * A write operation might create, update, and delete DDB items at once.
 * TODO: Also update (with dirty and publish semantics) the cardinality items in response to index changes.
 */
const WRITE_ITEMS_SCRIPT = `
local items = cjson.decode(ARGV[1])
local indexes = cjson.decode(ARGV[2])
local channels = cjson.decode(ARGV[3])
local now = tonumber(ARGV[4])
local nodeId = ARGV[5]
local publishedItems = {}

-- Make no changes if optimistic locking fails.
for i, key in ipairs(KEYS) do
  local expectedR = items[i].R
  if R == nil then
    -- If R is not provided, create semantics apply.
    if redis.call('EXISTS', hashKey) == 1 then
      error('Item exists: ' .. key)
    end
  else
    -- R is provided, update semantics apply... if updating the expected revision.
    local existingR = redis.call('HGET', hashKey, 'R')
    if existingR and tonumber(existingR) ~= tonumber(expectedR) then
      error('Item conflict: ' .. key .. ': Expected R ' .. expectedR .. ' got ' .. existingR)
    end
  end
end

results = {}
for i, itemKey in ipairs(KEYS) do
  local item = items[i].item
  local IX = indexes[i]
  local PK = vItem.item.PK
  local SK = vItem.item.SK
  local hashKey = 'i:' .. itemKey
  local hashFields = { 'PK', PK, 'SK', SK, 'R', redis.call('INCR', 'seq:i'), 'A', now }

  local oIX = redis.call('HGET', hashKey, 'IX')
  if oIX ~= false then
    hashFields.oIX = oIX
    oIX = cjson.decode(oIX)
    for i = 1, #oIX, 3 do
      local prefix = 'ix:' .. oIX[i] .. ':'
      local facets = oIX[i + 1]
      for name, values in pairs(facets) do
        for v, value in ipairs(values) do
          local key = prefix .. name .. '=' .. tostring(value)
          redis.call('ZREM', key, itemKey)
        end
      end
    end
  end

  if IX ~= cjson.null then
    for i = 1, #IX, 3 do
      local prefix = 'ix:' .. IX[i] .. ':'
      local facets = IX[i + 1]
      local score + IX[i + 2]
      for name, values in pairs(facets) do
        for v, value in ipairs(values) do
          local key = prefix .. name .. '=' .. tostring(value)
          redis.call('ZADD', key, score, itemKey)
        end
      end
    end
  end

  -- If the item data is null, delete semantics apply
  if item.D == nil then
    redis.call('HDEL', hashKey, 'I', 'IX')
  else
    hashFields.I = item
    hashFields.IX = IX
  end
  redis.call('HSET', hashKey, unpack(hashFields))
  redis.call('ZADD', 'dirty:i', now, itemKey)
  redis.call('PERSIST', hashKey)

  table.insert(results, { R:hashFields.R })
end
-- Batch publish invalidation
if #publishedItems > 0 then
  local payload = cjson.encode({ items = publishedItems, origin = nodeId })
  redis.call('PUBLISH', 'item:change', payload)
end
return results
`;
const LOAD_ITEMS_SCRIPT = `
local items = cjson.decode(ARGV[1])
local indexes = cjson.decode(ARGV[2])
local seqKey = ARGV[4]
local now = tonumber(ARGV[5])
local ttlSeconds = tonumber(ARGV[6])
local results = {}

for i, itemKey in ipairs(KEYS) do
  local item = items[i]
  local index = indexes[i]
  local hashKey = 'i:' .. itemKey
  local hashFields = { 'K', itemKey, 'A', now }

  -- Handle null item (cache miss for non-existent DynamoDB item)
  if item == cjson.null then
    -- Null item: create negative cache entry with TTL, no I/R
    redis.call('HSET', hashKey, unpack(hashFields))
    redis.call('EXPIRE', hashKey, ttlSeconds)
    results[i] = hashFields
  else
    -- Real item: assign I/R and store all fields
    hashFields.I = item
    hashFields.IX = cjson.encode(index)
    hashFields.R = redis.call('INCR', seqKey)
    redis.call('HSET', hashKey, unpack(hashFields))
    redis.call('EXPIRE', hashKey, ttlSeconds)
    results[i] = hashFields

    for i = 1, #index, 3 do
      local prefix = 'ix:' .. index[i] .. ':'
      local facets = index[i + 1]
      local score + index[i + 2]
      for name, values in pairs(facets) do
        for v, value in ipairs(values) do
          local key = prefix .. name .. '=' .. tostring(value)
          redis.call('ZADD', key, score, itemKey)
        end
      end
    end
  end
end
return results
`;
// Lua script: getDirtyItems()
// Returns up to 25 oldest dirty items with full data
// Matches DynamoDB BatchWriteItem 25-item limit
const GET_DIRTY_ITEMS_SCRIPT = `
local dirtyZset = KEYS[1]
local limit = tonumber(ARGV[1]) or 25
local keys = redis.call('ZRANGE', dirtyZset, 0, limit - 1)
local results = {}
for i, key in ipairs(keys) do
  local hashKey = 'i:' .. key
  local data = redis.call('HGETALL', hashKey)
  if #data > 0 then
    local obj = { PK = '', SK = '', data = nil, R = 0, A = 0, indexes = {} }
    for j = 1, #data, 2 do
      local field = data[j]
      local value = data[j + 1]
      if field == 'PK' then obj.PK = value
      elseif field == 'SK' then obj.SK = value
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
// Lua script: cleanItems(key, R[])
// For each key: if current R matches, ZREM from dirty + set TTL = A + 1hr
const CLEAN_ITEMS_SCRIPT = `
local dirtyZset = KEYS[1]
local ttlSeconds = tonumber(ARGV[2])
local results = {}
for i = 1, #ARGV, 2 do
  local key = ARGV[i]
  local expectedR = tonumber(ARGV[i + 1])
  local hashKey = 'i:' .. key
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

// Module-level script cache (not global)
const scriptCache = new Map();

async function loadValkeyFunctions() {
  const scripts = [
    { name: 'getItems', source: GET_ITEMS_SCRIPT },
    { name: 'writeItems', source: WRITE_ITEMS_SCRIPT },
    { name: 'loadItems', source: LOAD_ITEMS_SCRIPT },
    { name: 'getDirtyItems', source: GET_DIRTY_ITEMS_SCRIPT },
    { name: 'cleanItems', source: CLEAN_ITEMS_SCRIPT },
  ];
  for (const { name, source } of scripts) {
    try {
      const script = new Script(source);
      scriptCache.set(name, script);
      console.log(`Loaded Valkey Function ${name}: ${script.getHash()}`);
    } catch (error) {
      console.error(`Failed to load Valkey Function ${name}:`, error);
      throw error;
    }
  }
}

// Helper to call a loaded function via invokeScript
async function callValkeyFunction(name, keys, args) {
  const script = scriptCache.get(name);

  for (let a = 0; a < args.length; a++) {
    if (typeof args[a] === 'string') continue;
    if (args[a] === null) throw new TypeError(`Argument ${a} is null`);
    if (typeof args[a] === 'object') args[a] = JSON.stringify(args[a]);
    args[a] = String(args[a]);
  }

  try {
    if (!script)
      throw new Error('Script does not exist');
    return await valkey.invokeScript(script, { keys, args });
  } catch (e) {
    throw new Error(`Error calling valkey function '${name}': ${e}`);
  }
}

// Load Valkey Functions (Lua scripts)
await loadValkeyFunctions();

const keyOfItem = r => `${r.PK}:${r.SK}`;
const itemCacheKey = r => `i:${r.PK}:${r.SK}`;
// One sorted set per (partition, index). `undefined` indexSlot = plain SK range.
const indexZKey = (PK, indexSlot) => `ix:${indexSlot ?? 'SK'}:${PK}`;
// Null byte can't appear in our sort key strings (they're built from ISO
// dates, ids, and `&`-joined tokens elsewhere in the codebase), so it's a
// safe separator for disambiguating ties within a sorted set.
const SEP = '\u0000';

export default class ValkeyAdapter extends DynamoDBAdapter {
  constructor(props) {
    super(props);

    this._readBatchQueue = this._createQueue(READ_BATCH_QUEUE_NAME, async (jobs) => {
      const ts = Date.now();
      console.log('Process read batch', jobs.length);

      const keys = jobs.map(j => j.data);
      const { nextKeys, items } = await this._sendBatchGetCommand(keys, { parse:true });
      const loadItems = new Map();
      const results = await Promise.all(jobs.map(async job => {
        const itemId = `${job.data.PK}:${job.data.SK}`;
        // Null means the item doesn't exist.
        const item = items.get(itemId) ?? null;

        if (nextKeys.has(itemId)) {
          await job.moveToWaiting();
          return;
        }

        loadItems.set(itemId, item && JSON.stringify(item));
        return itemId;
      }));

      const itemKeys = Array.from(loadItems.keys());
      const itemValues = Array.from(loadItems.values());
      const itemIndexes = itemValues.map(iv => iv && this._calcIndexes(iv));
      const loadedItems = new Map((await callValkeyFunction('loadItems', keys, [
        itemValues,
        itemIndexes,
        SEQ_REVISION_KEY,
        Date.now(),
        CLEAN_TTL_SECONDS
      ])).map(kvs => {
        const item = {};
        for (let i = 0; i < kvs.length; i += 2)
          item[kvs[i]] = kvs[i + 1];
        return [ item.K, item ];
      }));

      for (let r = 0; r < results.length; r++)
        results[r] = loadedItems.get(results[r]);

      console.log('results', Date.now() - ts, results);
      return results;
    }, { batch:100 });
    this._generalQueue = this._createQueue(GENERAL_QUEUE_NAME, async (job) => {
      console.log('Process write batch', jobs.length);

      const slug = job.name.toUpperCase('first');
      return this[`_run${slug}Job`](job.data);
    }, { concurrency:4 });
  }

  _createQueue(queueName, handler, opts = {}) {
    opts = Object.assign({ batch:0, concurrency:1 }, opts);

    const jobWaits = new Map();
    const queue = new Queue(queueName, {
      connection,
      // No ordering - reads across different entities can batch freely
      defaultJobOptions: {
        removeOnComplete: { 
          age: 60, // Keep completed jobs alive for at least 1 minute to avoid back-to-back duplicate job processing.
        },
        removeOnFail: {
          age: 60, // Keep failed jobs alive for at least 1 minute to allow for error detection
        },
      },
    });
    const events = new QueueEvents(queueName, {
      connection,
    });
    const onComplete = event => {
      if (!jobWaits.has(event.jobId)) return;
      jobWaits.get(event.jobId).resolve(event.returnvalue);
      jobWaits.delete(event.jobId);
    };
    const onFailed = event => {
      if (!jobWaits.has(event.jobId)) return;
      jobWaits.get(event.jobId).reject(event.failedReason);
      jobWaits.delete(event.jobId);
    };
    events.on('completed', onComplete);
    events.on('failed', onFailed);

    const worker = new Worker(queueName, handler, {
      connection,
      concurrency: opts.concurrency,
      lockDuration: 5000, // Jobs idle for 5 seconds are assumed crashed (30000 default)
      stalledInterval: 5000, // Check for crashed/stalled jobs every 5 seconds (30000 default)
      ...(opts.batch ? { batch:{ size:opts.batch } } : {}),
    });

    worker.on('error', err => console.error('Read worker error:', err));
    worker.on('stalled', job => console.warn('Read job stalled, will be reclaimed:', job.id));

    // Custom addAndWait to use infrastructure efficiently.
    const addAndWait = async (name, data, opts) => {
      if (!opts.jobId)
        throw new Error(`A jobId is required for queue.addAndWait`);

      // All jobs have a unique job ID.
      const jobId = opts.jobId;
      if (jobWaits.has(jobId))
        return jobWaits.get(jobId);

      const { promise, resolve, reject } = Promise.withResolvers();
      Object.assign(promise, { resolve, reject });
      jobWaits.set(jobId, promise);

      const job = await queue.add(name, data, opts);

      // If a duplicate was detected, make sure job isn't already settled.
      if (!job) {
        const dup = await queue.getJob(jobId);
        const state = await dup.getState();
        if (state === 'completed') {
          // It is possible for a job to outlive the item in Valkey.  Harmless?
          onComplete({ jobId, returnvalue:dup.returnvalue });
        } else if (state === 'failed') {
          await dup.retry();
          await dup.promote();
        }
      }

      return promise;
    };

    return { queue, events, worker, addAndWait };
  }

  /*
   * Leveraging DynamoDBAdapter's queue, get a batch of items.
   * First try getting them from Valkey.
   * Fall back to getting them from DDB via jobs.
   */
  async _getItemBatch(ops) {
    console.log('_getItemBatch', ops.length);
    const keys = ops.map(o => `${o.args[0].PK}:${o.args[0].SK}`);
    const results = await callValkeyFunction('getItems', keys, [
      DIRTY_ZSET,
      Date.now(),
      CLEAN_TTL_SECONDS,
    ]);

    return Promise.all(ops.map(async (op, o) => {
      const [ key, migrateProps, defaultValue ] = op.args;

      try {
        const item = await (async () => {
          if (results[o]) return results[o];

          const jobId = `${key.PK}-${key.SK}`;
          const hit = results[o];
          console.log('getItem', jobId, `isCached=${!!hit}`);
          if (hit)
            return hit;

          return this._readBatchQueue.addAndWait('batchGet', {
            PK: key.PK,
            SK: key.SK,
          }, { jobId });
        })().then(vItem => {
          if (vItem.I === undefined) return null;

          return Object.assign(JSON.parse(vItem.I), { R:vItem.R, A:vItem.A });
        });

        let obj;

        if (item) {
          obj = await this._migrate(item, migrateProps, { parse:false });
          // Replicate events and data changes to other nodes
          if (obj instanceof ActiveModel)
            this._attachItem(obj);
          this.setItemMeta(obj, { item });
        } else {
          obj = await this._loadItemFromFile(key, migrateProps);

          if (!obj) {
            obj = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
            if (obj === undefined)
              throw new ServerError(404, `Item Not Found: ${key.PK}:${key.SK}`);
          }
        }

        this.itemQueue.delete(op.key);
        op.resolve(obj);
      } catch (error) {
        this.itemQueue.delete(op.key);
        op.reject(error);
      }
    }));
  }
  /*
   * getItemParts is a kind of query.  So a queryId is included.
   * This enables caching of a particular query for an hour.
   */
  async _getItemParts(key, transform, migrateProps) {
    const queryId = `${key.PK}:${key.SK}`;
    const results = await callValkeyFunction('getQuery', queryId, [
      Date.now(),
    ]);

    return super._getItemParts(key, async (_, items) => {
      const Rs = this._generalQueue.addAndWait('loadItems', { queryId, items }, { jobId });

      return transform(parts);
    }, migrateProps);
  }
  /*
   * Make sure all parts of an entity are written together as a single atomic operation.
   */
  async _putItemParts(ops) {
    const itemParts = ops.map(op => {
      const [ item, obj ] = op.args;
      if (op.method === '_putItem' && !item.D) {
        console.log('Item is missing data!', op.method, item);
        throw new ServerError(500, 'Item is missing data!');
      }

      const R = this.getItemMeta(obj, 'R');
      return { item, R };
    });

    const jobId = itemParts[0].item.PK;
    await this._generalQueue.addAndWait('writeItems', itemParts, { jobId });

    for (const [ o, op ] of ops.entries())
      if (op.method === '_putItem')
        this.setItemMeta(op.args[1], rsp[o]);
  }
  _writeItemExec(writeOps) {
    writeOps.sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0));

    return Promise.all(writeOps.map(op => {
      const [ item, obj ] = op.args;
      if (!(item.D)) {
        console.log('Item is missing data!', method, item);
        op.reject(new ServerError(500, 'Item is missing data!'));
        this.itemQueue.delete(op.key);
        continue;
      }

      const R = this.getItemMeta(obj, 'R');
      const exec = this._generalQueue.addAndWait('writeItems', [{ item, R }], { jobId });

      op.processing = true;
      op.execStartAt = Date.now();
      exec.then(rsp => {
        if (obj) this.setItemMeta(obj, { item });
        return rsp;
      }).then(op.resolve, op.reject).finally(() => {
        op.execEndAt = Date.now();
        this.debugV(`${method}: ${keyOfItem(item)} ${op.execEndAt - op.execStartAt}ms`);
        this.itemQueue.delete(op.key);
        if (op.trigger)
          this._pushItemQueue(op.trigger);

        // Since the worker queue is shared, trigger all item queues
        DynamoDBAdapter.triggerItemQueues();
      });
    }));
  }

  _writeItemBatch(deleteOps) {
    const keys = deleteOps.map(o => `${o.args[0].PK}:${o.args[0].SK}`);
    const results = await callValkeyFunction('deleteItems', keys, [
      DIRTY_ZSET,
      Date.now(),
      CLEAN_TTL_SECONDS,
    ]);
  }

  /*
   * Range queries (queryItemChildren)
   *
   * Falls back wholesale to the inherited DynamoDB implementation if the
   * relevant sorted set doesn't exist yet (e.g. a partition that predates
   * the Valkey rollout and hasn't been written to since). It will self-heal
   * the first time anything writes to that partition; if you have hot
   * legacy partitions (existing player game lists, etc.) that should be
   * fast from minute one, those are worth a one-time backfill script rather
   * than relying on organic self-healing - flagging that as a decision
   * since I can't run a backfill myself without DB access.
   */
  async _queryItemChildren(key, migrateProps, transform = d => d) {
    const zkey = indexZKey(key.PK, key.query.indexKey);

    let exists;
    try {
      exists = await valkey.exists([ zkey ]);
    } catch (error) {
      console.error(`Valkey: exists check failed for ${zkey}, falling back to DynamoDB:`, error);
    }

    if (!exists)
      return super._queryItemChildren(key, migrateProps, transform);

    const [ mode, ...values ] = key.query.indexValue ?? [];
    const order = key.query.order ?? 'ASC';
    const limit = key.query.limit;

    const lexMin = (
      mode === 'between' ? `[${values[0]}` :
      mode === 'gt'      ? `(${values[0]}` :
      mode === 'lt'       ? `-` :
      mode === 'beginsWith' ? `[${values[0]}` :
      `-`
    );
    const lexMax = (
      mode === 'between' ? `[${values[1]}${SEP}\xff` :
      mode === 'gt'      ? `+` :
      mode === 'lt'       ? `(${values[0]}` :
      mode === 'beginsWith' ? `[${values[0]}\xff` :
      `+`
    );

    let members;
    try {
      members = order === 'DESC'
        ? await valkey.customCommand([ 'ZREVRANGEBYLEX', zkey, lexMax, lexMin, ...(limit ? [ 'LIMIT', '0', String(limit) ] : []) ])
        : await valkey.customCommand([ 'ZRANGEBYLEX', zkey, lexMin, lexMax, ...(limit ? [ 'LIMIT', '0', String(limit) ] : []) ]);
    } catch (error) {
      console.error(`Valkey: range query failed for ${zkey}, falling back to DynamoDB:`, error);
      return super._queryItemChildren(key, migrateProps, transform);
    }

    // Members are either bare SKs (plain SK-range index) or `${indexValue}\0${SK}`.
    const sks = members.map(m => {
      const i = m.lastIndexOf(SEP);
      return i === -1 ? m : m.slice(i + SEP.length);
    });

    const objs = await Promise.all(sks.map(async SK => {
      const childKey = { PK:key.PK, SK };
      const cacheKey = itemCacheKey(childKey);

      try {
        const cached = await valkey.get(cacheKey);
        if (cached != null) {
          const raw = JSON.parse(cached);
          return serializer.normalize(raw.D);
        }
      } catch (error) {
        console.error(`Valkey: read failed for child ${cacheKey}, falling back to DynamoDB for this item:`, error);
      }

      // Index says this child exists but its own cache entry is missing
      // (evicted, or a legacy item never populated). Reuse the normal
      // single-item read-through path rather than duplicating it here.
      return this.getItem(Object.assign({ name:null }, childKey), migrateProps);
    }));

    return transform(objs);
  }

  async _attachItem(obj) {
    const meta = this.getItemMeta(obj);
    const events = [];

    obj.on('*', event => {
      events.push(events);
    });
  }
  async _publishChange(op, item) {
    await valkey.publish(CHANNEL, JSON.stringify({
      PK: item.PK,
      SK: item.SK,
      op,
      origin: NODE_ID,
      // Only sent for puts, and only D (not the whole item) - enough for
      // a remote node to normalize + patch a resident cached object without
      // a round trip back to Valkey.
      data: item.D ?? undefined,
    }));
  }

  async cleanup() {
    await Promise.all([
      this._readBatchQueue.worker.close(),
      this._readBatchQueue.queue.close(),
      this._readBatchQueue.events.close(),
      this._generalQueue.worker.close(),
      this._generalQueue.queue.close(),
      this._generalQueue.events.close(),
    ]);
    return super.cleanup();
  }

  jobResult(jobId, queue, events) {
    return new Promise(async (resolve, reject) => {
      const compKey = `completed:${jobId}`;
      const failKey = `failed:${jobId}`;
      const cleanup = () => {
        events.off(compKey, handleComplete);
        events.off(failKey, handleFail);
      };
      const handleComplete = (val) => { console.log('handleComplete'); cleanup(); resolve(val); };
      const handleFail = (err) => { console.log('handleFail'); cleanup(); reject(err); };

      events.on(compKey, handleComplete);
      events.on(failKey, handleFail);

      const job = await queue.getJob(jobId);
      const state = await job.getState();
      if (state === 'completed')
        handleComplete(job.returnvalue);
      else if (state === 'failed') {
        await job.retry();
        await job.promote();
      }
    });
  }

  /*
   * Indexes is an array of name/value pairs.
   * [
   *   partitionName: string
   *   facets: {
   *     [name]: value:string[],
   *     ...
   *   },
   *   ...
   * ]
   */
  _calcIndexes(item) {
    const [ type, ...id ] = item.PK.split('#');
    const slug = type.toUpperCase('first');
    const indexesGetter = `_calc${slug}Indexes`;

    if (!(indexesGetter in this))
      return [];

    const normalizeFacets = facets => {
      if (!facets) return {};

      for (const [ facetName, values ] of Object.entries(facets)) {
        if (Array.isArray(values))
          values.sort();
        else
          facets[facetName] = [ values ];

        for (let i = values.length - 1; i > -1; i--) {
          const value = values[i];
          if (value === undefined)
            values.splice(i, 1);
        }

        if (values.length === 0)
          delete facets[facetName];
      }
      return facets;
    };

    const itemIndexes = this[indexesGetter](item);
    itemIndexes.facets = normalizeFacets(itemIndexes.facets);

    const indexes = [];

    // Only partitions with facets that match the item are included.
    itemIndexes.partitions.forEach(partition => {
      // Skip partitions with a metric that doesn't exist on the item.
      if (!itemIndexes.metrics.has(partition.metricName)) return;

      // Canonicalize the facets before creating a partition id.
      partition.facets = normalizeFacets(partition.facets);

      const indexFacets = itemIndexes.facets.clone();

      // Skip partitions with facets that don't exist on the item.
      for (const [ facetName, values ] of Object.entries(partition.facets)) {
        if (!indexFacets[facetName]) return;

        for (const value of values) {
          const i = indexFacets[facetName].indexOf(value);
          if (i === -1) return;
          // Only include item facets that don't exist in partition facets.
          if (indexFacets[facetName].length === 1)
            delete indexFacets[facetName];
          else
            indexFacets[facetName].splice(i, 1);
        }
      }

      const metricValue = itemIndexes.metrics.get(partition.metricName);
      const score = typeof metricValue === 'number' ? metricValue : metricValue instanceof Date ? metricValue.getTime() : null;
      if (score === null)
        throw new TypeError(`${item.PK} metricName '${partition.metricName}' has invalid value type.`);

      indexes.push(`${type}#${createJsonId(partition)}`, indexFacets, score);
    });

    return indexes;
  }
  _runWriteItemsJob(items) {
    const keys = items.map(vi => `${vi.item.PK}:${vi.item.SK}`);
    const itemValues = items.map(item => JSON.stringify(item));
    const itemIndexes = items.map(item => this._calcIndexes(item));
    return callValkeyFunction('writeItems', keys, [
      itemValues,
      itemIndexes,
      Date.now(),
      NODE_ID,
    ]);
  }
  _runLoadItemsJob(items) {
    const keys = items.map(vi => `${vi.item.PK}:${vi.item.SK}`);
    const itemValues = items.map(item => JSON.stringify(item));
    const itemIndexes = items.map(item => this._calcIndexes(item));
    return callValkeyFunction('loadItems', keys, [
      itemValues,
      itemIndexes,
      Date.now(),
    ]);
  }
}

emitter(ValkeyAdapter);