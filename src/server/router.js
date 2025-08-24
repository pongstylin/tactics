import url from 'url';
import { v4 as uuid } from 'uuid';
import DebugLogger from 'debug';
import ws from 'ws';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import addKeywords from 'ajv-keywords';

import config from '#config/server.js';
import Timeout from '#server/Timeout.js';
import services, { servicesReady } from '#server/services.js';
import ServerError from '#server/Error.js';
import serializer, { enableValidation } from '#utils/serializer.js';

const CLOSE_GOING_AWAY     = 1001;
const CLOSE_NO_STATUS      = 1005;
const CLOSE_ABNORMAL       = 1006;

// Proprietary codes used by server
const CLOSE_CLIENT_TIMEOUT  = 4000;
const CLOSE_SERVER_SHUTDOWN = 4001;
const CLOSE_REPLACED        = 4002;
const CLOSE_CLIENT_LOGOUT   = 4003;

// Proprietary codes used by client
const CLOSE_SERVER_TIMEOUT = 4100;

const debug = DebugLogger('service:router');
// Verbose debug logger
const debugV = DebugLogger('service-v:router');

const ajv = new Ajv({
  strictTuples: false,
  allowUnionTypes: true,
});
addFormats(ajv);
addKeywords(ajv);

enableValidation(ajv);

const schema = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'client_message',
  type: 'object',
  oneOf: [
    {
      properties: {
        id: { type:'number', minimum:1 },
        type: { type:'string', const:'event' },
        body: {
          type: 'object',
          properties: {
            service: { type:'string' },
            group: { type:'string' },
            type: { type:'string' },
            data: { },
          },
          required: ['service','group','type'],
          additionalProperties: false,
        },
        ack: { type:'number', minimum:0 },
        idle: { type:'number', minimum:0 },
      },
      required: ['id','type','body','ack'],
      additionalProperties: false,
    },
    {
      properties: {
        id: { type:'number', minimum:1 },
        type: { type:'string', const:'request' },
        body: {
          type: 'object',
          properties: {
            service: { type:'string' },
            method: { type:'string' },
            args: { type:'array' },
          },
          required: ['service','method','args'],
          additionalProperties: false,
        },
        ack: { type:'number', minimum:0 },
        idle: { type:'number', minimum:0 },
      },
      required: ['id','type','body','ack'],
      additionalProperties: false,
    },
    {
      properties: {
        id: { type:'number', minimum:1 },
        type: { type:'string', enum:['join','leave'] },
        body: {
          type: 'object',
          properties: {
            service: { type:'string' },
            group: { type:'string' },
            params: { },
          },
          required: ['service','group'],
          additionalProperties: false,
        },
        ack: { type:'number', minimum:0 },
        idle: { type:'number', minimum:0 },
      },
      required: ['id','type','body','ack'],
      additionalProperties: false,
    },
    {
      properties: {
        type: { type:'string', const:'sync' },
        ack: { type:'number', minimum:0 },
        idle: { type:'number', minimum:0 },
      },
      // 'ack' is only required when a session is open
      required: ['type'],
      additionalProperties: false,
    },
    {
      properties: {
        id: { type:'number', minimum:1 },
        type: { type:'string', const:'authorize' },
        body: {
          type: 'object',
          properties: {
            service: { type:'string' },
            data: { },
          },
          required: ['service','data'],
          additionalProperties: false,
        },
        ack: { type:'number', minimum:0 },
        idle: { type:'number', minimum:0 },
      },
      required: ['id','type','body','ack'],
      additionalProperties: false,
    },
    {
      properties: {
        type: { type:'string', const:'open' },
        body: {
          type: 'object',
          properties: {
            version: { type:'string' },
          },
          required: ['version'],
          additionalProperties: false,
        },
      },
      required: ['type','body'],
      additionalProperties: false,
    },
    {
      properties: {
        type: { type:'string', const:'resume' },
        body: {
          type: 'object',
          properties: {
            sessionId: { type:'string', format:'uuid' },
          },
          required: ['sessionId'],
          additionalProperties: false,
        },
        ack: { type:'number', minimum:0 },
        idle: { type:'number', minimum:0 },
      },
      required: ['type','body','ack'],
      additionalProperties: false,
    },
  ],
};
const validate = ajv.compile(schema);

/*
 * Schema validation errors include why a given JSON payload does not match
 * each one of the "oneOf" sub-schemas.  This is way too much information and
 * is a weakness with combining schemas into one.  To ovecome that weakness,
 * we only return error details for the schema that matches the message type of
 * the JSON payload.
 */
const messageTypeErrorPath = new Map();

schema.oneOf.forEach((schema, i) => {
  let path = '#/oneOf/' + i;

  let messageType = schema.properties.type;
  if (messageType.const)
    messageTypeErrorPath.set(messageType.const, path);
  else if (messageType.enum)
    messageType.enum.forEach(mt => messageTypeErrorPath.set(mt, path));
  else
    throw new Error('Unsupported sub-schema');
});

const sessions = new Map();

/*
 * This Set and Map guards against duplicate/concurrent API requests.
 * The Set is used for detecting and rejecting duplicate/concurrent API requests.
 * The Map is used for consolidating duplicate/concurrent requests into a single response.
 */
const requests = new Set();
const requestsMap = new Map();

/*
 * This function is called to route a new connection.
 */
export function onConnect(client, request) {
  Object.assign(client, {
    id: uuid(),
    session: null,
    request: request,
    address: request.headers['x-forwarded-for']
      || request.connection.remoteAddress,
    agent: request.headers['user-agent'] || null,
  });

  debug(`connect: client=${client.address}; agent=${client.agent}`);

  // Enforce an idle timeout for this connection
  inboundClientTimeout.add(client.id, client);

  client.on('message', onMessage);
  client.on('close', onClose);
}

export function onShutdown() {
  debug(`shutdown: clients=${inboundClientTimeout.size}`);

  for (const client of inboundClientTimeout.values()) {
    closeClient(client, CLOSE_SERVER_SHUTDOWN);
  }
}

/*******************************************************************************
 * Group Management
 ******************************************************************************/
servicesReady.then(() => {
  for (const service of services.values()) {
    service.on('joinGroup', event => joinGroup(service.name, event));
    service.on('leaveGroup', event => leaveGroup(service.name, event));
    service.on('closeGroup', event => closeGroup(service.name, event));
    service.on('event', event => sendEvent(service.name, event));
    service.on('logout', event => logout(service.name, event));
  }
});

const groups = new Map();

function joinGroup(serviceName, { client:clientId, body }) {
  let groupId = [serviceName, body.group].join(':');
  let group = groups.get(groupId)
  if (!group)
    groups.set(groupId, group = new Map());

  /*
   * A user can join the group from multiple sessions, so build a list of
   * unique users in the group.  This list will be sent to the new session.
   */
  let groupUserIds = new Set();
  let groupUsers = [];
  for (let user of group.values()) {
    if (groupUserIds.has(user.id)) continue;
    groupUserIds.add(user.id);

    groupUsers.push(user);
  }

  // Let everybody know this user has joined the group, if we haven't already.
  if (!groupUserIds.has(body.user.id)) {
    let messageBody = {
      service: serviceName,
      group: body.group,
      user: body.user,
    };

    for (let groupedClientId of group.keys()) {
      enqueue(sessions.get(groupedClientId), 'enter', messageBody);
    }

    groupUsers.push(body.user);
  }

  group.set(clientId, body.user);

  enqueue(sessions.get(clientId), 'join', {
    service: serviceName,
    group: body.group,
    users: groupUsers,
  });
}

function leaveGroup(serviceName, { client:clientId, body }) {
  const groupId = [serviceName, body.group].join(':');
  const group = groups.get(groupId);
  if (!group)
    throw new Error('Expected group');

  group.delete(clientId);
  if (group.size === 0)
    groups.delete(groupId);
  else {
    /*
     * Does the user ID still exist in the group under a different session?
     */
    const exists = [...group.values()].find(u => u.id === body.user.id);
    if (!exists) {
      const messageBody = {
        service: serviceName,
        group: body.group,
        user: body.user,
      };

      for (const groupedClientId of group.keys()) {
        enqueue(sessions.get(groupedClientId), 'exit', messageBody);
      }
    }
  }

  // The session won't exist if the user left as the result of disconnecting.
  const session = sessions.get(clientId);
  if (session)
    enqueue(session, 'leave', {
      service: serviceName,
      group: body.group,
      reason: body.reason,
    });
}

function closeGroup(serviceName, { body }) {
  let groupId = [serviceName, body.group].join(':');
  let group = groups.get(groupId);
  if (!group)
    return;

  groups.delete(groupId);

  for (let sessionId of group.keys()) {
    enqueue(sessions.get(sessionId), 'leave', {
      service: serviceName,
      group: body.group,
    });
  }
}

function logout(serviceName, { clientId }) {
  // Only expected to happen when something else went wrong first.
  if (!sessions.has(clientId)) {
    console.log('Warning: Attempt to logout a session that does not exist!', clientId);
    return;
  }
  const client = sessions.get(clientId).client;

  closeClient(client, CLOSE_CLIENT_LOGOUT);
}

/*******************************************************************************
 * Message Sending
 ******************************************************************************/
function purgeAcknowledgedMessages(session, message) {
  let outbox = session.outbox;
  while (outbox.length) {
    if (message.ack < outbox[0].id)
      break;

    outbox.shift();
  }
}

function sendEvent(serviceName, { clientId, userId, body }) {
  const messageBody = { service:serviceName, ...body };

  const groupId = [serviceName, body.group].join(':');
  const group = groups.get(groupId);
  if (!group) return;

  if (clientId) {
    if (group.has(clientId))
      enqueue(sessions.get(clientId), 'event', messageBody);
  } else {
    for (const [ sessionId, user ] of group) {
      if (userId && userId !== user.id)
        continue;

      enqueue(sessions.get(sessionId), 'event', messageBody);
    }
  }
}

function sendErrorResponse(client, requestId, error) {
  if (!(error instanceof ServerError)) {
    console.error(error);

    error = new ServerError(500, 'Internal Server Error');
  }

  enqueue(client.session, 'response', { requestId, error });
}

function enqueue(session, messageType, body) {
  let message = {
    id: ++session.serverMessageId,
    type: messageType,
    body: body,
  };

  session.outbox.push(message);
  if (session.client)
    send(session.client, message);

  return message.id;
}

function sendSync(client) {
  send(client, { type:'sync' });
}

function sendError(client, error, source) {
  if (!(error instanceof ServerError)) {
    console.error(error);

    error = new ServerError(500, 'Internal Server Error');
  }

  if (source) {
    error.source = error.source || {};
    error.source.type = source.type;

    if (source.id)
      error.source.id = source.id;
  }

  send(client, {
    type: 'error',
    error: error,
  });
}

function send(client, message) {
  if (client.readyState !== ws.OPEN) return;

  const session = client.session;
  const body = message.body;
  if (session)
    message.ack = session.clientMessageId;
  if (body)
    message.body = serializer.transform(body);
  message.now = Date.now();

  client.send(JSON.stringify(message), error => {
    if (error) {
      // Example: "write EPIPE" (client is disconnecting)
      debug(`${message.type}-out: client=${client.id}; send-error=${error.message}`);
      return;
    }

    message.body = body;
    debugMessage(client, message, 'out');

    // Reset the outbound client timeout for this client.
    outboundClientTimeout.add(client.id, client);

    if (session && message.id)
      session.lastSentMessageId = message.id;
  });
}

function debugMessage(client, message, inOrOut) {
  const prefix = `${message.type}-${inOrOut}: client=${client.id}`;
  const body = message.body;

  let suffix;
  let suffixV;
  if (message.type === 'sync') {
    suffix = `[${message.ack ?? '-'}]`;
    if (message.idle !== undefined)
      suffix += ` idle=${message.idle}`;
  } else if (message.type === 'event') {
    suffix  = `[${message.id}] ${body.service}:${body.group}:${body.type}`;
    suffixV = `[${message.id}] data=${JSON.stringify(body.data)}`;
  } else if (message.type === 'request') {
    suffix  = `[${message.id}] ${body.service}:${body.method}`;
    suffixV = `[${message.id}] args=${JSON.stringify(body.args)}`;
  } else if (message.type === 'response')
    if (body.error)
      suffix = `[${message.id}] requestId=${body.requestId}; error=[${body.error.code}] ${body.error.message}`;
    else {
      suffix = `[${message.id}] requestId=${body.requestId}`;

      // Truncate a few cases where response data can be big.
      if (body.data?.hits) {
        const logData = Object.assign({}, body.data, { hits:body.data.hits.length });
        suffixV = `[${message.id}] data=${JSON.stringify(logData)}`;
      } else if (body.data?.results) {
        const logData = body.data.results.constructor === Array
          ? body.data.results.map(r => Object.assign({}, r, { hits:r.hits.length }))
          : Object.assign({}, body.data.results, { hits:body.data.results.hits.length });
        suffixV = `[${message.id}] data=${JSON.stringify(logData)}`;
      } else if (body.data?.state) {
        const logData = Object.assign({}, body.data, { state:true });
        suffixV = `[${message.id}] data=${JSON.stringify(logData)}`;
      } else if (body.data?.gameData) {
        const logData = Object.assign({}, body.data, {
          gameData: Object.assign({}, body.data.gameData, { state:true }),
        });
        suffixV = `[${message.id}] data=${JSON.stringify(logData)}`;
      } else
        suffixV = `[${message.id}] data=${JSON.stringify(body.data)}`;
    }
  else if (message.type === 'join' && inOrOut === 'in')
    suffix = `[${message.id}] ${body.service}:${body.group}; params=${JSON.stringify(body.params)}`;
  else if (
    message.type === 'join'  || message.type === 'leave' ||
    message.type === 'enter' || message.type === 'exit'
  )
    suffix = `[${message.id}] ${body.service}:${body.group}`;
  else if (message.type === 'authorize')
    suffix = `[${message.id}] ${body.service}`;
  else if (message.type === 'open')
    suffix = `version=${body.version}`;
  else if (message.type === 'resume')
    suffix = `sessionId=${body.sessionId}`;
  else if (message.type === 'error')
    suffix = `error=[${message.error.code}] ${message.error.message}`;

  if (message.type === 'sync') {
    if (suffix || suffixV) {
      debugV(`${prefix}; ${suffix}`);
      if (suffixV)
        debugV(`${prefix}; ${suffixV}`);
    } else
      debugV(prefix);
  } else
    if (suffix || suffixV) {
      debug(`${prefix}; ${suffix}`);
      if (suffixV)
        debugV(`${prefix}; ${suffixV}`);
    } else
      debug(prefix);
}

function closeClient(client, code, reason) {
  // The client can already be closed if closing was initiated by the server.
  if (client.closed) return;

  client.closed = { code, reason };
  debug(`disconnect: client=${client.id}; [${code}] ${reason}`);

  if (client.readyState === ws.OPEN)
    client.close(code, reason);
  else if (client.readyState === ws.CONNECTING)
    client.terminate();

  // Stop monitoring the connection.
  inboundClientTimeout.delete(client.id);
  outboundClientTimeout.delete(client.id);

  let session = client.session;
  if (session)
    if (code === CLOSE_GOING_AWAY || code === CLOSE_SERVER_SHUTDOWN || code === CLOSE_CLIENT_LOGOUT || code > CLOSE_SERVER_TIMEOUT)
      deleteSession(session, code);
    else if (code !== CLOSE_REPLACED)
      closedSessionTimeout.add(session.id, session);
}

function deleteSession(session, code) {
  const client = session.client;
  if (code === CLOSE_CLIENT_TIMEOUT)
    debug(`gone: client=${client.id}; [${client.closed.code}] session timeout`);
  else
    debug(`gone: client=${client.id}; [${client.closed.code}] client exit`);

  closedSessionTimeout.delete(session.id);

  // Delete the session immediately since the client won't come back.
  // This code is used when the websocket webpage is refreshed or closed.
  sessions.delete(session.id);

  for (const [ groupId, group ] of groups) {
    if (!group.has(client.id))
      continue;

    const [ serviceName, groupPath ] = groupId.split(':');
    const service = services.get(serviceName);

    service.onLeaveGroup(client, groupPath);
    if (group.has(client.id))
      throw new Error(`Expected to leave group: ${groupId}`);
  }

  for (const service of services.values()) {
    service.dropClient(client);
  }
}

/*******************************************************************************
 * Client Event Handlers
 ******************************************************************************/
async function onMessage(data) {
  const now = Date.now();
  const client = this;

  // Ignore messages sent right as the server starts closing the connection.
  if (client.closed)
    return;

  // Reset inbound client timeout for this client
  inboundClientTimeout.add(client.id, client);

  let message;
  try {
    message = JSON.parse(data);
  } catch (error) {
    debug(`message-in: client=${client.id}; bytes=${data.length}`);

    return sendError(client, new ServerError({
      code: 415,
      message: 'Message data is not valid JSON'
    }));
  }

  // TODO
  //if (message.body)
  //  message.body = serializer.normalize(message.body);

  try {
    if (!validate(message)) {
      debug(`message-in: client=${client.id}; type=${message.type}; bytes=${data.length}`);

      const schemaPath = messageTypeErrorPath.get(message.type);
      const matcher = new RegExp('^' + schemaPath);
      const details = validate.errors.filter(detail => matcher.test(detail.schemaPath));

      console.error('Validation failed:', details);

      if (schemaPath)
        throw new ServerError({
          code: 422,
          message: 'Unrecognized JSON schema for ' + message.type,
          details: details.map(detail => 'Message ' + detail.message),
        });
      else
        throw new ServerError({
          code: 422,
          message: 'Missing or unrecognized message type',
        });
    }

    message.receivedAt = now;

    debugMessage(client, message, 'in');

    const session = client.session;

    if (session) {
      // It is possible for a 'sync' message to be sent without an 'ack' if the
      // server sent the 'session', but the client hasn't received it yet.
      // Also, nothing to purge if 'ack' is 0.
      if (message.ack)
        purgeAcknowledgedMessages(session, message);

      if (message.id) {
        /*
         * Discard repeat messages.  Resync if a message was skipped.
         */
        const expectedMessageId = session.clientMessageId + 1;
        if (message.id < expectedMessageId)
          return;
        if (message.id > expectedMessageId)
          return sendSync(client);

        session.clientMessageId = message.id;
      }

      if (message.type === 'event')
        await onEventMessage(client, message);
      else if (message.type === 'request')
        await onRequestMessage(client, message);
      else if (message.type === 'join')
        await onJoinMessage(client, message);
      else if (message.type === 'leave')
        await onLeaveMessage(client, message);
      else if (message.type === 'sync')
        onSyncMessage(client, message);
      else if (message.type === 'authorize')
        await onAuthorizeMessage(client, message);
      else
        // 'open', 'resume'
        throw new ServerError({
          code: 405,
          message: 'A session is already open',
        });

      /*
       * Process idle change after processing the message since processing the
       * idle change can enqueue a new outbound message.  This can cause the
       * outbound message to be sent twice if it is in response to a 'sync'.
       */
      if (message.idle !== undefined) {
        const oldIdle = session.idle;
        session.idle = message.idle;

        if (session.onIdleChange)
          session.onIdleChange(session, oldIdle);
      }
    } else {
      if (message.type === 'open')
        onOpenMessage(client, message);
      else if (message.type === 'resume')
        onResumeMessage(client, message);
      // Ignore sync messages until session is open
      // They still serve to keep the connection from timing out.
      else if (message.type !== 'sync')
        // 'event', 'request', 'join', 'leave'
        throw new ServerError({
          code: 405,
          message: 'A session must first be opened or resumed',
        });
    }
  } catch (error) {
    sendError(client, error, message);
  }
}

async function onAuthorizeMessage(client, message) {
  const session = client.session;
  const requestId = message.id;
  const body = message.body;
  const service = services.get(body.service);
  const method = 'onAuthorize';

  if (!service)
    throw new ServerError(404, 'No such service');

  const requestKey = `${client.id}:authorize:${body.service}`;

  try {
    if (requests.has(requestKey))
      throw new ServerError(409, 'Concurrent authorization conflict');
    requests.add(requestKey);

    service.will(client, message.type, body);

    const data = await service[method](client, body.data);
    if (client.closed)
      return;

    enqueue(session, 'response', { requestId, data });
  } catch (error) {
    sendErrorResponse(client, requestId, error);
  }

  requests.delete(requestKey);
}

async function onEventMessage(client, message) {
  const body = message.body;
  const service = services.get(body.service);
  const method = 'on' + body.type.split(':').map(p => p.toUpperCase('first')).join('') + 'Event';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError(404, 'No such event type');

  const groupId = [body.service, body.group].join(':');
  const group = groups.get(groupId);
  if (!group || !group.has(client.id))
    throw new ServerError(412, 'Must first join the group');

  service.will(client, message.type, body);

  try {
    await service[method](client, body.group, body.data);
  } catch (error) {
    sendError(client, error, message);
  }
}

async function onRequestMessage(client, message) {
  const session = client.session;
  const requestId = message.id;
  const body = message.body;
  const service = services.get(body.service);
  const method = 'on' + body.method.toUpperCase('first') + 'Request';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError({
      code: 404,
      message: 'No such request method',
      source: { method:body.method },
    });

  const requestKey = `${client.id}:request:${body.service}:${body.method}:${JSON.stringify(body.args)}`;

  try {
    if (!requestsMap.has(requestKey)) {
      service.will(client, message.type, body);

      requestsMap.set(requestKey, service[method](client, ...body.args, message.receivedAt));
    }

    const data = await requestsMap.get(requestKey);
    if (client.closed)
      return;

    enqueue(session, 'response', { requestId, data });
  } catch (error) {
    sendErrorResponse(client, requestId, error);
  }

  requestsMap.delete(requestKey);
}

async function onJoinMessage(client, message) {
  const session = client.session;
  const requestId = message.id;
  const body = message.body;
  const service = services.get(body.service);
  const method = 'onJoinGroup';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError(501, 'Service does not support joining groups');

  const groupId = [body.service, body.group].join(':');
  const group = groups.get(groupId);
  if (group && group.has(client.id))
    throw new ServerError(409, 'Already joined group');

  const requestKey = `${client.id}:join:${groupId}`;

  try {
    if (requests.has(requestKey))
      throw new ServerError(409, 'Concurrent join conflict');
    requests.add(requestKey);

    service.will(client, message.type, body);

    const data = await service[method](client, body.group, body.params);
    if (client.closed)
      return;

    enqueue(session, 'response', { requestId, data });
  } catch (error) {
    sendErrorResponse(client, requestId, error);
  }

  requests.delete(requestKey);
}

async function onLeaveMessage(client, message) {
  const session = client.session;
  const requestId = message.id;
  const body = message.body;
  const service = services.get(body.service);
  const method = 'onLeaveGroup';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError(501, 'Service does not support leaving groups');

  const groupId = [body.service, body.group].join(':');
  const group = groups.get(groupId);
  if (!group || !group.has(client.id))
    throw new ServerError(409, 'Already left group');

  try {
    service.will(client, message.type, body);

    const data = await service[method](client, body.group);
    if (client.closed)
      return;

    enqueue(session, 'response', { requestId, data });
  } catch (error) {
    sendErrorResponse(client, requestId, error);
  }
}

function onSyncMessage(client, message) {
  /*
   * The message.ack id was already used to remove all acknowledged messages
   * from the queue.  So, all remaining messages need to be sent.
   */
  let outbox = client.session.outbox;
  for (let i = 0; i < outbox.length; i++) {
    send(client, outbox[i]);
  }
}

function onOpenMessage(client, message) {
  if (client.session)
    throw new ServerError(400, 'Session already established');

  const session = {
    id: client.id,
    clientMessageId: 0,
    serverMessageId: 0,
    lastSentMessageId: 0,
    outbox: [],
    client: client,
    idle: null,
    onIdleChange: null,
  };

  client.version = message.body.version;
  client.session = session;

  sessions.set(client.id, session);

  send(client, {
    type: 'session',
    body: {
      version: config.version,
      sessionId: session.id,
    },
  });
}

/*
 * All errors return 401 code for security (obscurity) reasons.
 */
function onResumeMessage(client, message) {
  if (client.session)
    throw new ServerError(401, 'Not authorized');

  let session = sessions.get(message.body.sessionId);
  if (!session)
    throw new ServerError(401, 'Not authorized');

  let minExpectedAck = session.outbox.length
    ? session.outbox[0].id - 1
    : session.serverMessageId;
  let maxExpectedAck = session.lastSentMessageId;

  if (message.ack < minExpectedAck || message.ack > maxExpectedAck)
    throw new ServerError(401, 'Not authorized');

  if (closedSessionTimeout.has(session.id))
    closedSessionTimeout.delete(session.id);
  else
    // Close the previous client, but not the session
    closeClient(session.client, CLOSE_REPLACED);

  // Move timeouts to the new client ID.
  inboundClientTimeout.delete(client.id);
  outboundClientTimeout.delete(client.id);

  client.id = session.id;
  client.version = session.client.version;
  client.session = session;

  session.client = client;

  inboundClientTimeout.add(client.id, client);

  purgeAcknowledgedMessages(session, message);
  onSyncMessage(client, message);

  send(client, {
    type: 'session',
    body: {
      sessionId: session.id,
    },
    ack: session.clientMessageId,
  });
}

function onClose(code, reason) {
  const client = this;

  closeClient(client, code, reason);
}

/*******************************************************************************
 * Connection and Session Monitoring
 *
 * Close connections after inbound-idle connection timeout has been reached.
 * Send sync messages every 5 seconds on otherwise outbound-idle connections.
 * Remove closed sessions after 30 seconds.
 ******************************************************************************/
const inboundClientTimeout = new Timeout('inboundClient', {
  verbose: [ 'add', 'delete' ],
  expireIn: parseInt(process.env.CONNECTION_TIMEOUT),
});
inboundClientTimeout.on('expire', ({ data:clients }) => clients.forEach((c,i) => closeClient(c, CLOSE_CLIENT_TIMEOUT)));

const outboundClientTimeout = new Timeout('outboundClient', {
  verbose: true,
  expireIn: 5000,
});
outboundClientTimeout.on('expire', ({ data:clients }) => clients.forEach((c,i) => sendSync(c)));

const closedSessionTimeout = new Timeout('closedSession', { expireIn:30000 });

closedSessionTimeout.on('expire', ({ data:sessions }) => sessions.forEach((s,i) => deleteSession(s, CLOSE_CLIENT_TIMEOUT)));

setInterval(Timeout.tick, 1000);
