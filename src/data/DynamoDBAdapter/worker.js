import { workerData } from 'worker_threads';
import zlib from 'zlib';

import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,

  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import workerpool from 'workerpool';
import ServerError from '#server/Error.js';

const region = process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const client = new DynamoDBClient({
  region,
  endpoint: process.env.DDB_ENDPOINT ?? `https://dynamodb.${region}.amazonaws.com`,
});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DDB_TABLE ?? 'tactics';
const throttle = new Int32Array(workerData.throttleBuffer);
const WCU_INDEX = 0;
const WCU_THROTTLE_PERIOD = 60; // 1 minute
const WCU_LIMIT = parseInt(process.env.DDB_WCU_LIMIT ?? '25') * WCU_THROTTLE_PERIOD;

/*
function getStringSize(str) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  return encoded.length;
}
function getNumberSize(num) {
  return val.toString().length;
}
function getBooleanSize(bool) {
  return 1;
}
function getNullSize() {
  return 1;
}
function getValueSize(val) {
  if (typeof val === 'string')
    return getStringSize(val);
  else if (typeof val === 'number')
    return getNumberSize(val);
  else if (typeof val === 'boolean')
    return getBooleanSize(val);
  else if (val === null)
    return getNullSize();
  else if (val === undefined)
    return 0;
  else if (Buffer.isBuffer(val))
    return val.length;
  throw new Error(`Unable to compute value size: ${typeof val}`);
}
function getItemSize(item) {
  let size = 0;
  for (const [ key, val ] of Object.entries(item)) {
    size += getStringSize(key);
    size += getValueSize(val);
  }

  return size;
}
function getItemWCU(item) {
  const size = getItemSize(item);
  const numIndexes = Array.from(Object.entries(item)).filter(([ k, v ]) => v !== undefined && indexKeys.has(k)).length;

  return Math.ceil(size / 1024) * (1 + numIndexes);
}
*/

function compress(str) {
  if (str === undefined)
    return str;
  if (typeof str !== 'string')
    throw new Error('Unable to compress');

  return zlib.brotliCompressSync(str, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: str.length,
    },
  });
}

async function createItem(item, skipWait = false) {
  item.D = compress(item.D);
  item.PD = compress(item.PD);

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK)',
    ReturnValues: 'NONE',
    ReturnConsumedCapacity: 'TOTAL',
    ReturnItemCollectionMetrics: 'NONE',
  });

  if (!skipWait) {
    let throttleWCU = Atomics.load(throttle, WCU_INDEX);
    while (throttleWCU >= WCU_LIMIT) {
      Atomics.wait(throttle, WCU_INDEX, throttleWCU);
      throttleWCU = Atomics.load(throttle, WCU_INDEX);
    }
  }

  try {
    const rsp = await docClient.send(command);
    Atomics.add(throttle, WCU_INDEX, rsp.ConsumedCapacity.CapacityUnits);
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException)
      workerpool.workerEmit(new ServerError(409, `Item exists: ${item.PK}, ${item.SK}`));
    else
      throw error;
  }
}

async function putItem(item, skipWait = false) {
  item.D = compress(item.D);
  item.PD = compress(item.PD);

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ReturnValues: 'NONE',
    ReturnConsumedCapacity: 'TOTAL',
    ReturnItemCollectionMetrics: 'NONE',
  });

  if (!skipWait) {
    let throttleWCU = Atomics.load(throttle, WCU_INDEX);
    while (throttleWCU >= WCU_LIMIT) {
      Atomics.wait(throttle, WCU_INDEX, throttleWCU);
      throttleWCU = Atomics.load(throttle, WCU_INDEX);
    }
  }

  const rsp = await docClient.send(command);
  Atomics.add(throttle, WCU_INDEX, rsp.ConsumedCapacity.CapacityUnits);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection in worker:', 'reason:', reason);
  workerpool.workerEmit(new ServerError(500, `Internal server error`));
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in worker:', error);
  workerpool.workerEmit(new ServerError(500, `Internal server error`));
});

workerpool.worker({ createItem, putItem });
