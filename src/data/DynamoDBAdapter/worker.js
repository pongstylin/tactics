import { workerData } from 'worker_threads';
import { compress } from '#utils/ddb.js';

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
