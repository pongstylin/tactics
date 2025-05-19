/*
 * This adapter assumes a single-table design with the following schema.
 *
 * PK: The partition key (string, required)
 * SK: The sort key (string, optional)
 * D: Item data (any, optional)
 * PD: Projected data to all local indexes (any, optional)
 * PF: Projected filters to all local indexes (any, optional)
 * R: Item revision (number, required for root objects, not implemented)
 * V: Schema version (number, required for root objects, not implemented yet)
 * TTL: Time To Live (unix time stamp in seconds, optional)
 * LSK#: Alternate sort key for a local index where # is a numeric placeholder for 0-9 (string, optional)
 * GPK#: The partition key for a global index where # is a numeric placeholder for 0-9 (string, optional)
 * GSK#: The sort key for a global index where # is a numeric placeholder for 0-9 (string, optional)
 */
import os from 'os';
import zlib from 'zlib';
import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,

  BatchGetCommand,
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import workerpool from 'workerpool';

import config from '#config/server.js';
import FileAdapter from '#data/FileAdapter.js';
import ServerError from '#server/Error.js';
import Timeout from '#server/Timeout.js';
import emitter from '#utils/emitter.js';
import serializer from '#utils/serializer.js';

const client = new DynamoDBClient({ region:process.env.AWS_DEFAULT_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DDB_TABLE;
const workerData = { throttleBuffer:new SharedArrayBuffer(4) };
const throttle = new Int32Array(workerData.throttleBuffer);
const WCU_INDEX = 0;
const WCU_THROTTLE_PERIOD = 60; // 1 minute
const WCU_LIMIT = parseInt(process.env.DDB_WCU_LIMIT ?? '25') * WCU_THROTTLE_PERIOD;
const workerQueue = {
  max: os.cpus().length * 2,
  size: 0,
  adapterCount: 0,
};
const pool = workerpool.pool(`./src/data/DynamoDBAdapter/worker.js`, {
  minWorkers: 'max',
  maxQueueSize: workerQueue.max,
  workerType: 'thread',
  workerThreadOpts: { workerData },
});

// Limit WCU within a period of 1 minute
Timeout.setInterval(() => {
  const wcu = Atomics.load(throttle, WCU_INDEX);
  const nextWCU = Math.max(0, wcu - WCU_LIMIT);

  Atomics.store(throttle, WCU_INDEX, nextWCU);
  if (nextWCU < WCU_LIMIT)
    Atomics.notify(throttle, WCU_INDEX);
}, WCU_THROTTLE_PERIOD * 1000);

const itemMeta = new WeakMap();
const keyOfItem = r => `${r.PK}:${r.SK}`;
const filterOpByName = new Map([
  [ 'eq',  '='  ],
  [ 'lt',  '<'  ],
  [ 'lte', '<=' ],
  [ 'gt',  '>'  ],
  [ 'gte', '>=' ],
]);

const stateBuffer = new Timeout('ddbState', config.buffer).on('expire', async ({ data:items }) => {
  for (const [ itemId, item ] of items)
    DynamoDBAdapter._putItem({
      PK: `state#${itemId}`,
      SK: '/',
      D: serializer.stringify(item),
    });
});

export default class DynamoDBAdapter extends FileAdapter {
  constructor(props) {
    super(props);

    this.itemQueue = new Map();
    this._triggerItemQueueTimeout = null;
    workerQueue.adapterCount++;
  }

  static _getItem(key, defaultValue) {
    return docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: key.PK,
        SK: key.SK,
      },
      ConsistentRead: false,
    })).then(rsp => {
      if (rsp.Item)
        return DynamoDBAdapter.migrate(rsp.Item);
      if (defaultValue === undefined)
        throw new ServerError(404, `Item Not Found: ${key.PK}`);
      return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
    });
  }
  static _putItem(item) {
    return new Promise((resolve, reject) => {
      pool.exec('putItem', [ item ], {
        on: reject,
      }).then(resolve, reject);
    });
  }
  // No migrations yet.  The item PK and SK values will be used to determine the
  // item type and migrate as needed.  Migrations may retrieve and mutate
  // additional items.  The final step is normalizing the object.
  static async migrate(item, props = {}) {
    if (!(item.D ?? item.PD)) {
      console.log('Item is missing data!', item, new Error().stack);
      throw new ServerError(500, 'Item is malformed');
    }
    return serializer.parse(await DynamoDBAdapter._decompress(item.D ?? item.PD));
  }
  static _decompress(data) {
    if (!(data instanceof Uint8Array))
      throw new Error('Unable to decompress');

    return new Promise(resolve => {
      zlib.brotliDecompress(data, {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        },
      }, (error, decompressed) => {
        if (error)
          console.error('Error while decompressing:', error);
        resolve(decompressed.toString());
      });
    });
  }

  async bootstrap() {
    if (this.hasState) {
      try {
        await FileAdapter._createJSONFile(`${this.name}.lock`, { startupAt:new Date() });
      } catch (error) {
        if (error.code === 'EEXIST')
          throw new Error('Lock file exists.  Try `npm run start-force`.');
        throw error;
      }

      if (await FileAdapter._hasJSONFile(this.name)) {
        this.state = await FileAdapter._readJSONFile(this.name, {});
        await FileAdapter._deleteJSONFile(this.name);
      } else {
        this.state = await DynamoDBAdapter._getItem({ PK:`state#${this.name}`, SK:'/' }, {});
        if (Object.keys(this.state).length === 0)
          console.log(`Initializing state for ${this.name} adapter.`);
      }
    }

    return this;
  }
  /*
   * While not strictly necessary to call this method to save state, calling it
   * allows us to track state changes during server run time.  It also makes it
   * safer to forcefully start a server after not being gracefully shut down.
   */
  saveState() {
    stateBuffer.add(this.name, this.state);
  }
  async cleanup() {
    // Remove throttling to terminate quicker
    Atomics.store(throttle, WCU_INDEX, -500);
    Atomics.notify(throttle, WCU_INDEX);

    await this.flush();

    if (this.hasState) {
      stateBuffer.pause();
      await DynamoDBAdapter._putItem({
        PK: `state#${this.name}`,
        SK: '/',
        D: serializer.stringify(this.state),
      });

      await FileAdapter._deleteJSONFile(`${this.name}.lock`);
    }

    if (--workerQueue.adapterCount === 0)
      pool.terminate();

    return this;
  }

  /*
   * All save operations must serialize objects before queueing the operations.
   * This allows objects to change and schedule another save while a save operation is in progress.
   */
  createItem(item, obj) {
    if (this.readonly)
      return;

    if (!item.data && !item.indexData)
      item.data = obj;
    item = this._processItem(item);

    const queueKey = 'write:' + keyOfItem(item);
    return this._pushItemQueue({ key:queueKey, method:'_createItem', args:[ item, obj ] });
  }
  getItem(key, migrateProps, defaultValue = undefined) {
    key = this._processKey(key);

    const queueKey = keyOfItem(key);
    return this._pushItemQueue({ key:queueKey, method:'_getItem', args:[ key, migrateProps, defaultValue ] });
  }
  putItem(item, obj) {
    if (this.readonly)
      return;

    if (!item.data && !item.indexData)
      item.data = obj;
    item = this._processItem(item);

    const queueKey = 'write:' + keyOfItem(item);
    return this._pushItemQueue({ key:queueKey, method:'_putItem', args:[ item, obj ] });
  }
  deleteItem(key) {
    if (this.readonly)
      return;

    key = this._processKey(key);

    const queueKey = 'write:' + keyOfItem(key);
    return this._pushItemQueue({ key:queueKey, method:'_deleteItem', args:[ key ] });
  }

  createItemParts(key, obj, parts) {
    if (this.readonly)
      return;
    if (!parts.has('/'))
      throw new Error(`Required root part when creating ${key.PK}`);

    const { PK } = this._processKey(key);

    const ops = Array.from(parts).map(([ path, part ]) => ({
      key: 'write:' + keyOfItem({ PK, SK:path }),
      method: path === '/' ? '_createItem' : '_putItem',
      args: [
        this._processItem(Object.assign({}, key, part, {
          path,
          indexes: Object.assign(path === '/' ? key.indexes ?? {} : {}, part.indexes),
        })),
        path === '/' ? obj : null,
      ],
      priority: key.priority ?? 0,
    }));

    this.setItemMeta(obj, { partPaths:parts.keys() });

    const queueKey = 'write:' + (key.name ?? key.PK);
    return this._pushItemQueue({ key:queueKey, method:'_createItemParts', args:[ ops ] });
  }
  getItemParts(key, transform = p => p, migrateProps = undefined) {
    key = this._processKey(key);

    const queueKey = key.name ?? key.PK;
    return this._pushItemQueue({ key:queueKey, method:'_getItemParts', args:[ key, transform, migrateProps ] });
  }
  putItemParts(key, obj, parts) {
    if (this.readonly)
      return;
    if (!parts.has('/'))
      throw new Error(`Required root part when putting ${key.PK}`);

    const { PK } = this._processKey(key);

    const ops = Array.from(parts).filter(([ _, p ]) => p.isDirty).map(([ path, part ]) => ({
      key: 'write:' + keyOfItem({ PK, SK:path }),
      method: '_putItem',
      args: [
        this._processItem(Object.assign({}, key, part, {
          path,
          indexes: Object.assign(path === '/' ? key.indexes ?? {} : {}, part.indexes),
        })),
        path === '/' ? obj : null,
      ],
      priority: key.priority ?? 0,
    }));

    if (this.hasItemMeta(obj, 'partPaths')) {
      for (const path of this.getItemMeta(obj).partPaths)
        if (!parts.has(path))
          ops.push({
            key: 'write:' + keyOfItem({ PK, SK:path }),
            method: '_deleteItem',
            args: [ { PK, SK:path }, null ],
          });
    } else
      console.log(`Warning: Expected partPaths in item meta when putting ${key.PK}`)

    this.setItemMeta(obj, { partPaths:parts.keys() });

    const queueKey = 'write:' + (key.name ?? PK);
    return this._pushItemQueue({ key:queueKey, method:'_putItemParts', args:[ ops ] });
  }
  deleteItemParts(key, obj, dependents) {
    if (this.readonly)
      return;

    key = this._processKey(key);
    if (dependents)
      dependents = dependents.map(ks => ks.map(k => this._processKey(k)));

    const queueKey = 'write:' + (key.name ?? key.PK);
    return this._pushItemQueue({ key:queueKey, method:'_deleteItemParts', args:[ key, obj, dependents ] });
  }

  queryItemChildren(...args) {
    args[0] = this._processKey(args[0]);
    if (args.length === 2 && typeof args[1] === 'function')
      args = [ args[0], undefined, args[1] ];

    const queueKey = JSON.stringify([
      args[0].name ?? '',
      args[0].query.indexKey ?? 'SK',
      args[0].query.indexValue ?? '',
      args[0].query.order ?? 'ASC',
      args[0].query.limit ?? 0,
    ]);
    return this._pushItemQueue({ key:queueKey, method:'_queryItemChildren', args });
  }
  putItemChildren(key, children) {
    if (this.readonly)
      return;
    if (children.length === 0)
      return;

    key = this._processKey(key);
    children = children.map(c => this._processItem(c, key));

    const queueKey = 'write:' + (key.name ?? key.PK);
    return this._pushItemQueue({ key:queueKey, method:'_putItemChildren', args:[ key, children ] });
  }

  hasItemMeta(obj, key = null) {
    if (!itemMeta.has(obj))
      return false;
    return key ? key in itemMeta.get(obj) : true;
  }
  getItemMeta(obj, key = null, defaultValue = null) {
    if (!itemMeta.has(obj))
      return key ? defaultValue : {};
    return key ? itemMeta.get(obj)[key] ?? defaultValue : itemMeta.get(obj);
  }
  setItemMeta(obj, newMeta) {
    if (!obj)
      return;
    const meta = itemMeta.get(obj) ?? {};
    itemMeta.set(obj, Object.assign(meta, newMeta));
  }
  deleteItemMeta(obj, key = null) {
    if (!obj || !itemMeta.has(obj))
      return;
    if (key)
      delete itemMeta.get(obj)[key];
    else
      itemMeta.delete(obj);
  }

  /*
   * These methods are for internal use for THIS class.
   */
  _pushItemQueue(ops) {
    const returnType = Array.isArray(ops) ? 'multi' : 'single';
    if (returnType === 'single') ops = [ ops ];

    const promises = ops.map(op => {
      if (this.itemQueue.has(op.key)) {
        const op2 = this.itemQueue.get(op.key);
        if (op.method === op2.method) {
          // These operations are expected to be identical
          if (op.method === '_getItem' || op.method === '_getItemParts' || op.method === '_queryItemChildren')
            return op2.promise;

          // Either schedule a put after this put or provide the latest data for this put.
          if (op.method === '_putItem') {
            if (op2.processing)
              return op2.promise.finally(() => this._pushItemQueue(op));
            op2.args = op.args;
            return op2.promise;
          }

          throw new Error(`Concurrent operation: ${op.key}: method=${op.method}`);
        }

        throw new Error(`Conflicting operations: ${op.key}: methods=${op.method}, ${op2.method}`);
      } else {
        op.promise = new Promise((resolve, reject) => {
          op.resolve = resolve;
          op.reject = reject;
        });

        this.itemQueue.set(op.key, op);
      }

      return op.promise;
    });

    this._triggerItemQueue();

    return returnType === 'single' ? promises[0] : Promise.all(promises);
  }
  async _triggerItemQueue() {
    if (this.itemQueue.size === 0)
      return;

    // Allow multiple concurrent requests to be processed together
    if (!this._triggerItemQueueTimeout)
      this._triggerItemQueueTimeout = setTimeout(() => {
        this._triggerItemQueueTimeout = null;
        this._processItemQueue();
      }, 0);
  }
  /* 
   * Conduct concurrent requests for all items in the queue.
   * Queue processing itself can be done concurrently.
   * Items remain in the queue until they are resolved.
   *
   * Unprocessed keys/items from a batch operation are processed in the next tick.
   */
  async _processItemQueue() {
    const queue = Array.from(this.itemQueue.values());
    if (queue.length === 0)
      return;

    const getItemOps = [];
    const writeItemOps = [];
    const deleteItemOps = [];
    const otherItemOps = [];

    for (const op of queue) {
      if (op.processing)
        continue;

      switch (op.method) {
        case '_getItem':
          op.processing = true;
          getItemOps.push(op);
          break;
        case '_createItem':
        case '_putItem':
          writeItemOps.push(op);
          break;
        case '_deleteItem':
          op.processing = true;
          deleteItemOps.push(op);
          break;
        default:
          op.processing = true;
          otherItemOps.push(op);
      }
    }
    this.debug([
      `queue: total=${queue.length}`,
      `getItem=${getItemOps.length}`,
      `writeItem=${writeItemOps.length}`,
      `deleteItem=${deleteItemOps.length}`,
      `otherItem=${otherItemOps.length}`,
    ].join('; '));

    if (getItemOps.length)
      this._getItemBatch(getItemOps);

    if (writeItemOps.length)
      this._writeItemExec(writeItemOps);

    if (deleteItemOps.length)
      this._writeItemBatch(deleteItemOps);

    if (otherItemOps.length)
      otherItemOps.forEach(op => this[op.method](...op.args)
        .then(rsp => op.resolve(rsp))
        .catch(err => op.reject(err))
        .finally(() => this.itemQueue.delete(op.key))
      );
  }

  async _getItemBatch(ops) {
    const chunks = [];
    for (let i = 0; i < ops.length; i += 100)
      chunks.push(ops.slice(i, i+100));

    return Promise.all(chunks.map(async chunk => {
      const rsp = await this._send(new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: chunk.map(op => ({
              PK: op.args[0].PK,
              SK: op.args[0].SK,
            })),
            ConsistentRead: false,
          },
        },
        ReturnConsumedCapacity: 'NONE',
      }));
      const keys = new Map((rsp.UnprocessedKeys[TABLE_NAME] ?? []).map(k => [ keyOfItem(k), k ]));
      const items = new Map((rsp.Responses[TABLE_NAME] ?? []).map(i => [ keyOfItem(i), i ]));

      for (const op of chunk) {
        const [ key, migrateProps, defaultValue ] = op.args;
        const itemKey = keyOfItem(key);

        if (keys.has(itemKey)) {
          op.processing = false;
          this._triggerItemQueue();
          continue;
        }

        let obj;

        if (items.has(itemKey)) {
          const item = items.get(itemKey);
          obj = await DynamoDBAdapter.migrate(item, migrateProps);
          this.setItemMeta(obj, { item });
        } else {
          obj = await this._loadItemFromFile(key, migrateProps);

          if (!obj) {
            obj = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
            if (obj === undefined)
              op.reject(new ServerError(404, `Item Not Found: ${key.PK}`));
          }
        }

        this.itemQueue.delete(op.key);
        op.resolve(obj);
      }
    }));
  }
  async _writeItemBatch(deleteOps) {
    const requests = deleteOps.map(op => ({
      DeleteRequest: { Key:{ PK:op.args[0].PK, SK:op.args[0].SK } },
    }));

    const chunks = [];
    for (let i = 0; i < requests.length; i += 25)
      chunks.push(requests.slice(i, i+25));

    return Promise.all(chunks.map(async chunk => {
      const rsp = await this._send(new BatchWriteCommand({
        RequestItems: { [TABLE_NAME]:chunk },
        ReturnConsumedCapacity: 'NONE',
        ReturnItemCollectionMetrics: 'NONE',
      }));
      const delayed = new Map((rsp.UnprocessedItems[TABLE_NAME] ?? []).map(i => [ keyOfItem(i), i ]));

      for (const op of deleteOps) {
        const itemKey = keyOfItem(op.args[0]);
        const obj = op.args[1] ?? null;

        if (delayed.has(itemKey)) {
          op.processing = false;
          this._triggerItemQueue();
          continue;
        }

        this.debugV(`_deleteItem: ${itemKey}`);
        this.itemQueue.delete(op.key);
        if (obj) this.deleteItemMeta(obj);
        if (op.resolve)
          op.resolve();
      }
    }));
  }

  async _send(command) {
    return docClient.send(command);
  }
  async _loadItemFromFile(key, migrateProps) {
    if (!key.name)
      return;

    const typeDef = this.fileTypes.get(key.type);
    const obj = super.migrate(key.type, await this.getFile(key.name, null), migrateProps);
    if (obj === null)
      return obj;

    if (typeDef?.saver)
      await this[typeDef.saver](obj, { fromFile:true });
    else
      throw new Error(`Expected saver for type ${key.type}`);
    await this.deleteFile(key.name);

    return obj;
  }
  async _deleteAllItems() {
    const input = {
      TableName: TABLE_NAME,
      Select: 'SPECIFIC_ATTRIBUTES',
      AttributesToGet: [ 'PK', 'SK' ],
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    };

    while (true) {
      const rsp = await this._send(new ScanCommand(input));
      if (!rsp.Items.length)
        break;

      await this._pushItemQueue(rsp.Items.map(item => ({
        key: 'write:' + keyOfItem(item),
        method: '_deleteItem',
        args: [ item ],
      })));

      if (!rsp.LastEvaluatedKey)
        break;

      input.ExclusiveStartKey = rsp.LastEvaluatedKey;
    }
  }

  /*
   * Single-Part Items
   *
   * Saving of items is delegated to a worker pool since it includes compression.
   * The worker pool will throttle saving of items to a target WCU limit.
   */
  _writeItemExec(writeOps) {
    writeOps.sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (let i = workerQueue.size; i < workerQueue.max; i++) {
      if (writeOps.length === 0)
        break;

      const op = writeOps.shift();
      const method = op.method.slice(1);
      const [ item, obj ] = op.args;
      if (!(item.D ?? item.PD)) {
        console.log('Item is missing data!', method, item);
        op.reject(new ServerError(500, 'Item is missing data!'));
        this.itemQueue.delete(op.key);
        this._triggerItemQueue();
        continue;
      }

      workerQueue.size++;
      op.processing = true;
      op.execStartAt = Date.now();
      pool.exec(method, [ item ], {
        on: op.reject,
      }).then(rsp => {
        if (obj) this.setItemMeta(obj, { item });
        return rsp;
      }).then(op.resolve, op.reject).finally(() => {
        op.execEndAt = Date.now();
        this.debugV(`${method}: ${keyOfItem(item)}`, op.execEndAt - op.execStartAt);
        workerQueue.size--;
        this.itemQueue.delete(op.key);
        this._triggerItemQueue();
      });
    }
  }

  /*
   * Multi-Part Items
   */
  async _countItemParts(key) {
    const rsp = await this._send(new QueryCommand({
      TableName: TABLE_NAME,
      Select: 'COUNT',
      KeyConditionExpression: 'PK = :PV AND begins_with(SK, :SV)',
      ExpressionAttributeValues: {
        ':PV': key.PK,
        ':SV': key.SK,
      },
      // This is effective due to local caching.
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    }));

    return rsp.Count;
  }
  async _queryItemParts(key, keysOnly = false) {
    const input = {
      TableName: TABLE_NAME,
      Select: keysOnly ? 'SPECIFIC_ATTRIBUTES' : 'ALL_ATTRIBUTES',
      AttributesToGet: keysOnly ? [ 'SK' ] : undefined,
      KeyConditionExpression: 'PK = :PV AND begins_with(SK, :SV)',
      ExpressionAttributeValues: {
        ':PV': key.PK,
        ':SV': key.SK,
      },
      // This is effective due to local caching.
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    };
    const items = [];

    while (true) {
      const rsp = await this._send(new QueryCommand(input));
      if (!rsp.Items.length)
        break;

      items.push(...rsp.Items);
      if (!rsp.LastEvaluatedKey)
        break;

      input.ExclusiveStartKey = rsp.LastEvaluatedKey;
    }

    return items;
  }
  async _createItemParts(ops) {
    const createItemIdx = ops.findIndex(o => o.method === '_createItem');
    const createItem = ops.splice(createItemIdx, 1)[0];

    const ts1 = Date.now();
    await this._pushItemQueue(createItem);
    await this._pushItemQueue(ops);
    const ts2 = Date.now();
    this.debugV(`_createItemParts: ${keyOfItem(createItem.args[0])}`, ts2 - ts1);
  }
  async _getItemParts(key, transform, migrateProps) {
    const items = await this._queryItemParts(key);

    let obj;
    if (items.length) {
      const parts = new Map(await Promise.all(items.map(i => DynamoDBAdapter.migrate(i, migrateProps).then(d => [ i.SK, d ]))));

      obj = transform(parts);

      // Save the part keys to aid in saving or deleting the item.
      this.setItemMeta(obj, { partPaths:parts.keys() });
    } else {
      obj = await this._loadItemFromFile(key, migrateProps);
      if (!obj) {
        obj = transform(new Map());
        if (obj === undefined)
          throw new ServerError(404, `Item Not Found: ${key.PK}`);
      }
    }

    return obj;
  }
  async _putItemParts(ops) {
    // Why the extra step?  Queuing this operation as a single item enables duplicate/conflict management.
    return this._pushItemQueue(ops);
  }
  async _deleteItemParts(key, obj, dependents) {
    const ops = [];

    if (!this.hasItemMeta(obj, 'partPaths'))
      throw new Error(`Expected itemMeta when deleting ${key.PK}`);
    //const items = await this._queryItemParts(key, true);

    for (const partKey of this.getItemMeta(obj).partPaths)
      ops.push({
        key: 'write:' + keyOfItem({ PK:key.PK, SK:partKey }),
        method: '_deleteItem',
        args: [
          { PK:key.PK, SK:partKey },
          partKey === '/' ? obj : null,
        ],
      });

    for (const dependent of dependents)
      ops.push({
        key: 'write:' + keyOfItem({ PK:dependent[0].PK, SK:dependent[1].PK }),
        method: '_deleteItem',
        args: [{ PK:dependent[0].PK, SK:dependent[1].PK }],
      });

    this.deleteItemMeta(obj, 'partPaths');

    return this._pushItemQueue(ops);
  }

  /*
   * Item Children
   */
  async _queryItemChildren(key, migrateProps, transform = d => d) {
    const input = {
      TableName: TABLE_NAME,
      Select: key.query.indexKey ? 'ALL_PROJECTED_ATTRIBUTES' : 'ALL_ATTRIBUTES',
      IndexName: key.query.indexKey ? `PK-${key.query.indexKey}` : undefined,
      KeyConditionExpression: 'PK = :PV' + (
        key.query.indexValue?.[0] === 'beginsWith' ? ` AND begins_with(${key.query.indexKey ?? 'SK'}, :SV1)` :
        key.query.indexValue?.[0] === 'between' ? ` AND ${key.query.indexKey ?? 'SK'} BETWEEN :SV1 AND :SV2` :
        key.query.indexValue?.[0] === 'gt' ? ` AND ${key.query.indexKey ?? 'SK'} > :SV1` :
        key.query.indexValue?.[0] === 'lt' ? ` AND ${key.query.indexKey ?? 'SK'} < :SV1` :
        ''
      ),
      ExpressionAttributeValues: {
        ':PV': key.PK,
        ':SV1': key.query.indexValue?.[1],
        ':SV2': key.query.indexValue?.[2],
      },
      ScanIndexForward: key.query.order === 'ASC',
      Limit: key.query.limit,
      // This is effective due to local caching.
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    };

    const items = new Promise(async (resolve, reject) => {
      const items = [];

      while (items.length < (key.query.limit ?? Infinity)) {
        const rsp = await this._send(new QueryCommand(input));
        if (!rsp.Items.length)
          break;

        items.push(...rsp.Items);
        if (!rsp.LastEvaluatedKey)
          break;

        input.ExclusiveStartKey = rsp.LastEvaluatedKey;
      }

      resolve(items);
    });

    return transform(await Promise.all(items.map(i => DynamoDBAdapter.migrate(i, migrateProps))));
  }
  async _putItemChildren(key, children) {
    const ops = children.map(child => (child.D ?? child.PD ?? null) === null ? ({
      key: 'write:' + keyOfItem({ PK:key.PK, SK:child.PK }),
      method: '_deleteItem',
      args: [{ PK:key.PK, SK:child.PK }],
    }) : ({
      key: 'write:' + keyOfItem({ PK:key.PK, SK:child.PK }),
      method: '_putItem',
      args: [ Object.assign(child, { PK:key.PK, SK:child.PK }) ],
    }));

    await this._pushItemQueue(ops);
  }

  /*
   * Utility Methods
   */
  _processKey(key) {
    if (typeof key === 'string')
      key = { PK:key, name:key };

    if (key.query && typeof key.query.indexValue === 'string')
      key.query.indexValue = [ 'beginsWith', key.query.indexValue ];
    if (key.query && !key.query.order)
      key.query.order = 'ASC';

    return Object.assign({
      // If PK is not supplied, a type and id is required.
      PK: key.id ? `${key.type}#${key.id}` : key.type,
      SK: key.childId ? `${key.childType}#${key.childId}` : key.childType ? key.childType : key.path ?? '/',
    }, key);
  }
  _processItem(item, key = null) {
    item = this._processKey(item);

    return {
      PK:  item.PK,
      SK:  item.SK,
      D:   item.data      ? serializer.stringify(item.data)      : undefined,
      PD:  item.indexData ? serializer.stringify(item.indexData) : undefined,
      PF:  item.indexFilter ?? undefined,
      TTL: item.ttl ?? undefined,
      ...Object.assign({}, key?.indexes, item.indexes),
    };
  }
  async *_query(query) {
    const input = {
      TableName: TABLE_NAME,
      Select: query.attributes ? 'SPECIFIC_ATTRIBUTES' : query.indexName ? 'ALL_PROJECTED_ATTRIBUTES' : 'ALL_ATTRIBUTES',
      ProjectionExpression: query.attributes ? query.attributes.join(', ') : undefined,
      IndexName: query.indexName ?? undefined,
      KeyConditionExpression: null,
      ExpressionAttributeValues: {},
      ScanIndexForward: (query.order ?? 'ASC') === 'ASC',
      Limit: query.limit,
      // This is effective due to local caching.
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    };

    const aliasByValue = new Map();
    const conditions = [];
    for (let [ attribute, filter ] of Object.entries(query.filters)) {
      if (typeof filter === 'string')
        filter = { eq:filter };

      for (const [ op, value ] of Object.entries(filter)) {
        if (op === 'beginsWith') {
          const valueAlias = aliasByValue.has(value) ? aliasByValue.get(value) : `:V${aliasByValue.size}`;
          aliasByValue.set(value, valueAlias);
          input.ExpressionAttributeValues[valueAlias] = value;

          conditions.push(`begins_with(${attribute}, ${valueAlias})`);
        } else if (filterOpByName.has(op)) {
          const valueAlias = aliasByValue.has(value) ? aliasByValue.get(value) : `:V${aliasByValue.size}`;
          aliasByValue.set(value, valueAlias);
          input.ExpressionAttributeValues[valueAlias] = value;

          conditions.push(`${attribute} ${filterOpByName.get(op)} ${valueAlias}`);
        } else
          throw new Error(`Unsupported condition '${op}'`);
      }
    }
    input.KeyConditionExpression = conditions.join(' AND ');

    do {
      const rsp = await this._send(new QueryCommand(input));
      for (const item of rsp.Items)
        yield item;

      input.ExclusiveStartKey = rsp.LastEvaluatedKey;
    } while (input.ExclusiveStartKey);
  }
};

emitter(DynamoDBAdapter);
