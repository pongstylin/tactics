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
import zlib from 'zlib';
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,

  BatchGetCommand,
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import DebugLogger from 'debug';

import config from '#config/server.js';
import FileAdapter from '#data/FileAdapter.js';
import ServerError from '#server/Error.js';
import Timeout from '#server/Timeout.js';
import emitter from '#utils/emitter.js';
import serializer from '#utils/serializer.js';
import sleep from '#utils/sleep.js';

const client = new DynamoDBClient({ region:process.env.AWS_DEFAULT_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DDB_TABLE;

const itemMeta = new WeakMap();
const keyOfItem = r => `${r.PK}:${r.SK}`;
const keyOfRequest = r => r.DeleteRequest ? keyOfItem(r.DeleteRequest.Key) : keyOfItem(r.PutRequest.Item);

export default class DynamoDBAdapter extends FileAdapter {
  constructor(props) {
    super(props);

    this.itemQueue = new Map();
    this.whenCompressed = Promise.resolve();
    this._triggerItemQueueTimeout = null;
  }

  // No migrations yet.  The item PK and SK values will be used to determine the
  // item type and migrate as needed.  Migrations may retrieve and mutate
  // additional items.  The final step is normalizing the object.
  async migrate(item, props) {
    return serializer.parse(await this._decompress(item.D ?? item.PD));
  }

  /*
   * All save operations must serialize objects before queueing the operations.
   * This allows objects to change and schedule another save while a save operation is in progress.
   */
  createItem(key, obj) {
    if (this.readonly)
      return;

    const item = this._processItem(Object.assign({}, key, {
      data: obj,
    }));

    const queueKey = key.name ?? keyOfItem(item);
    return this._pushItemQueue({ key:queueKey, method:'_createItem', args:[ item ] });
  }
  getItem(key, migrateProps, defaultValue = undefined) {
    key = this._processKey(key);

    const queueKey = keyOfItem(key);
    return this._pushItemQueue({ key:queueKey, method:'_getItem', args:[ key, migrateProps, defaultValue ] });
  }
  putItem(key, obj) {
    if (this.readonly)
      return;

    const item = this._processItem(Object.assign({}, key, {
      data: obj,
    }));

    const queueKey = 'write:' + keyOfItem(item);
    return this._pushItemQueue({ key:queueKey, method:'_putItem', args:[ item ] });
  }
  deleteItem(key) {
    if (this.readonly)
      return;

    key = this._processKey(key);

    const queueKey = 'write:' + keyOfItem(key);
    return this._pushItemQueue({ key:queueKey, method:'_deleteItem', args:[ key ] });
  }

  createItemParts(key, obj, transform) {
    if (this.readonly)
      return;

    key = this._processKey(key);

    const parts = transform(obj);
    if (parts.size === 0)
      return;

    for (const [ partKey, part ] of parts.entries()) {
      part.data = serializer.stringify(part.data);
      if (key.indexes && partKey === '/')
        part.indexes = Object.assign(part.indexes ?? {}, key.indexes);
    }

    const queueKey = 'write:' + (key.name ?? key.PK);
    return this._pushItemQueue({ key:queueKey, method:'_createItemParts', args:[ key, obj, parts ] });
  }
  getItemParts(key, transform, migrateProps = undefined) {
    key = this._processKey(key);

    const queueKey = key.name ?? key.PK;
    return this._pushItemQueue({ key:queueKey, method:'_getItemParts', args:[ key, transform, migrateProps ] });
  }
  putItemParts(key, obj, transform) {
    if (this.readonly)
      return;

    key = this._processKey(key);

    const parts = transform(obj);
    if (parts.size === 0)
      return;

    for (const [ partKey, part ] of parts.entries()) {
      part.data = serializer.stringify(part.data);
      if (key.indexes && partKey === '/')
        part.indexes = Object.assign(part.indexes ?? {}, key.indexes);
    }

    const queueKey = 'write:' + (key.name ?? key.PK);
    return this._pushItemQueue({ key:queueKey, method:'_putItemParts', args:[ key, obj, parts ] });
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

    const queueKey = [
      args[0].name ?? '',
      args[0].query.indexKey ?? 'SK',
      args[0].query.indexValue ?? '',
      args[0].query.order ?? 'ASC',
      args[0].query.limit ?? 0,
    ].join('&');
    return this._pushItemQueue({ key:queueKey, method:'_queryItemChildren', args });
  }
  putItemChildren(...args) {
    if (this.readonly)
      return;

    args[0] = this._processKey(args[0]);
    args[1] = args[1].map(c => this._processItem(c, args[0]));

    const queueKey = 'write:' + (args[0].name ?? args[0].PK);
    return this._pushItemQueue({ key:queueKey, method:'_putItemChildren', args });
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
          if (op.method === '_getItem' || op.method === '_getItemParts' || op.method === '_queryItemChildren')
            return op2.promise;
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
    const putItemOps = [];
    const deleteItemOps = [];
    const otherItemOps = [];

    for (const op of queue) {
      if (op.processing)
        continue;
      op.processing = true;

      switch (op.method) {
        case '_getItem':
          getItemOps.push(op);
          break;
        case '_putItem':
          putItemOps.push(op);
          break;
        case '_deleteItem':
          deleteItemOps.push(op);
          break;
        default:
          otherItemOps.push(op);
      }
    }

    if (getItemOps.length)
      this._getItemBatch(getItemOps);

    if (putItemOps.length || deleteItemOps.length)
      this._writeItemBatch(putItemOps, deleteItemOps);

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

      for (const op of ops) {
        const [ key, migrateProps, defaultValue ] = op.args;
        const itemKey = keyOfItem(key);

        if (keys.has(itemKey)) {
          op.processing = false;
          this._triggerItemQueue();
          continue;
        }

        let obj;

        if (items.has(itemKey)) {
          obj = await this.migrate(items.get(itemKey), migrateProps);
        } else {
          obj = await this._loadItemFromFile(key, migrateProps);

          if (!obj) {
            obj = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
            if (obj === undefined)
              throw new ServerError(404, `Item Not Found: ${key.PK}`);
          }
        }

        this.itemQueue.delete(op.key);
        op.resolve(obj);
      }
    }));
  }
  async _writeItemBatch(putOps, deleteOps) {
    const ops = putOps.concat(deleteOps);
    const requests = await Promise.all(
      putOps.map(async op => ({
        PutRequest: { Item:Object.assign({}, op.args[0], {
          D: op.args[0].D ? await this._compress(op.args[0].D) : undefined,
          PD: op.args[0].PD ? await this._compress(op.args[0].PD) : undefined,
        }) },
      })).concat(deleteOps.map(op => ({
        DeleteRequest: { Key:{ PK:op.args[0].PK, SK:op.args[0].SK } },
      })))
    );
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

      for (const op of ops) {
        const itemKey = keyOfItem(op.args[0]);

        if (delayed.has(itemKey)) {
          op.processing = false;
          this._triggerItemQueue();
          continue;
        }

        this.itemQueue.delete(op.key);
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
   */
  async _createItem(item) {
    await Promise.all([
      item.D && this._compress(item.D).then(c => item.D = c),
      item.PD && this._compress(item.PD).then(c => item.PD = c),
    ]);

    try {
      await this._send(new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
        ReturnValues: 'NONE',
        ReturnConsumedCapacity: 'NONE',
        ReturnItemCollectionMetrics: 'NONE',
      }));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException)
        throw new ServerError(409, `Item exists: ${item.PK}, ${item.SK}`);
      throw error;
    }
  }
  async hasItem(key) {
    const rsp = await this._send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: key.PK,
        SK: key.SK,
      },
      ConsistentRead: false,
      ProjectionExpression: 'X', // Effectively means to return nothing
      ReturnConsumedCapacity: 'NONE',
    }));

    return !!rsp.Item;
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
  async _createItemParts(key, obj, parts) {
    itemMeta.set(obj, parts.keys());

    const ops = Array.from(parts).map(([ k, p ]) => ({
      key: 'write:' + keyOfItem({ PK:key.PK, SK:k }),
      method: k === '/' ? '_createItem' : '_putItem',
      args: [ Object.assign(this._processItem(p), { PK:key.PK, SK:k }) ],
    }));

    const createItemIdx = ops.findIndex(o => o.method === '_createItem');
    if (createItemIdx === -1)
      throw new Error(`Missing root part`);

    // Safer but slower
    //const createItem = ops.splice(createItemIdx, 1)[0];
    //await this._pushItemQueue(createItem);
    //await this._pushItemQueue(ops);

    await this._writeItemBatch(ops, []);
  }
  async _getItemParts(key, transform, migrateProps) {
    const items = await this._queryItemParts(key);

    let obj;
    if (items.length) {
      const parts = new Map(await Promise.all(items.map(i => this.migrate(i, migrateProps).then(d => [ i.SK, d ]))));

      obj = transform(parts);

      // Save the part keys to aid in saving or deleting the item.
      itemMeta.set(obj, parts.keys());
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
  async _putItemParts(key, obj, parts) {
    const ops = Array.from(parts).filter(([ k, p ]) => p.isDirty).map(([ k, p ]) => ({
      key: 'write:' + keyOfItem({ PK:key.PK, SK:k }),
      method: '_putItem',
      args: [ Object.assign(this._processItem(p), { PK:key.PK, SK:k }) ],
    }));

    if (itemMeta.has(obj)) {
      for (const partKey of itemMeta.get(obj))
        if (!parts.has(partKey))
          ops.push({
            key: 'write:' + keyOfItem({ PK:key.PK, SK:partKey }),
            method: '_deleteItem',
            args: [{ PK:key.PK, SK:partKey }],
          });
    } else {
      // itemMeta would only be set when loading an object from file.
      const numItems = await this._countItemParts(key);
      if (numItems)
        throw new Error(`Expected itemMeta when putting ${key.PK}`);
    }

    itemMeta.set(obj, parts.keys());

    return this._pushItemQueue(ops);
  }
  async _deleteItemParts(key, obj, dependents) {
    const ops = [];

    if (!itemMeta.has(obj))
      throw new Error(`Expected itemMeta when deleting ${key.PK}`);
    //const items = await this._queryItemParts(key, true);

    for (const partKey of itemMeta.get(obj))
      ops.push({
        key: 'write:' + keyOfItem({ PK:key.PK, SK:partKey }),
        method: '_deleteItem',
        args: [{ PK:key.PK, SK:partKey }],
      });

    for (const dependent of dependents)
      ops.push({
        key: 'write:' + keyOfItem({ PK:dependent[0].PK, SK:dependent[1].PK }),
        method: '_deleteItem',
        args: [{ PK:dependent[0].PK, SK:dependent[1].PK }],
      });

    itemMeta.delete(obj);

    return this._pushItemQueue(ops);
  }

  /*
   * Item Children
   */
  async _queryItemChildren(key, migrateProps, transform = d => d) {
    const typeDef = this.fileTypes.get(key.type);
    const input = {
      TableName: TABLE_NAME,
      Select: key.query.indexKey ? 'ALL_PROJECTED_ATTRIBUTES' : 'ALL_ATTRIBUTES',
      IndexName: key.query.indexKey ? `PK-${key.query.indexKey}` : undefined,
      KeyConditionExpression: 'PK = :PV' + (
        key.query.expression ? ` AND ${key.query.expression}` :
        key.query.indexValue ? ` AND begins_with(${key.query.indexKey}, :SV)` :
        ''
      ),
      ExpressionAttributeValues: {
        ':PV': key.PK,
        ':SV': key.query.indexKey ? key.query.indexValue : key.SK,
      },
      ScanIndexForward: key.query.order === 'ASC',
      Limit: key.query.limit,
      // This is effective due to local caching.
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    };

    const [ fileExists, items ] = await Promise.all([
      this.statFile(key.name, true).then(s => s !== null),
      new Promise(async (resolve, reject) => {
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
      }),
    ]);

    let obj;
    if (fileExists) {
      obj = await this._loadItemFromFile(key, migrateProps);
      if (!obj)
        obj = transform([]);
    } else {
      obj = transform(await Promise.all(items.map(i => this.migrate(i, migrateProps))));
    }

    return obj;
  }
  async _putItemChildren(key, children) {
    if (children.length === 0)
      return;

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

    if (key.query && !key.query.order)
      key.query.order = 'ASC';

    return Object.assign({
      // If PK is not supplied, a type and id is required.
      PK: key.id ? `${key.type}#${key.id}` : key.type,
      SK: '/',
    }, key);
  }
  _processItem(item, key = null) {
    item = this._processKey(item);

    return {
      PK: item.PK,
      SK: item.SK,
      D:  typeof item.data      === 'string' ? item.data      : item.data      ? serializer.stringify(item.data)      : undefined,
      PD: typeof item.indexData === 'string' ? item.indexData : item.indexData ? serializer.stringify(item.indexData) : undefined,
      PF: item.indexFilter ?? undefined,
      ...Object.assign({}, key?.indexes, item.indexes),
    };
  }
  _compress(str) {
    // Avoid compressing already compressed data when reprocessing items.
    if (Buffer.isBuffer(str))
      return str;
    if (typeof str !== 'string')
      throw new Error('Unable to compress');

    return this.whenCompressed = this.whenCompressed.then(() => new Promise(resolve => {
      zlib.brotliCompress(str, {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: str.length,
        },
      }, (error, compressed) => {
        if (error)
          console.error('Error while compressing:', error);
        resolve(compressed);
      });
    }));
  }
  _decompress(data) {
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
};

emitter(DynamoDBAdapter);
