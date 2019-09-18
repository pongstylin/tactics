import url from 'url';
import uuid from 'uuid/v4';
import DebugLogger from 'debug';
import ws from 'ws';
import Ajv from 'ajv';

import config from 'config/server.js';
import ServerError from 'server/Error.js';

/*
 * Import service classes based on server configuration.
 */
let services = new Map();

export default Promise.all(
  [...config.endpoints]
    .filter(([serviceName, endpoint]) => endpoint === 'local')
    .map(([serviceName, endpoint]) => {
      let serviceModuleName = serviceName.toUpperCase('first');

      return import(`server/${serviceModuleName}Service.js`).then(module => {
        let service = module.default;
        service.on('joinGroup', event => joinGroup(service.name, event));
        service.on('leaveGroup', event => leaveGroup(service.name, event));
        service.on('closeGroup', event => closeGroup(service.name, event));
        service.on('event', event => sendEvent(service.name, event));

        services.set(serviceName, service);
      });
    })
).then(() => route);

const CLOSE_GOING_AWAY     = 1001;
const CLOSE_NO_STATUS      = 1005;
const CLOSE_ABNORMAL       = 1006;

// Proprietary codes used by server
const CLOSE_CLIENT_TIMEOUT = 4000;
const CLOSE_REPLACED       = 4001;

// Proprietary codes used by client
const CLOSE_SERVER_TIMEOUT = 4100;

let debug = DebugLogger('service:router');
// Verbose debug logger
let debugV = DebugLogger('service-v:router');

let ajv = new Ajv();
let schema = {
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
            params: { type:'object' },
          },
          required: ['service','group'],
          additionalProperties: false,
        },
        ack: { type:'number', minimum:0 },
      },
      required: ['id','type','body','ack'],
      additionalProperties: false,
    },
    {
      properties: {
        type: { type:'string', const:'sync' },
        ack: { type:'number', minimum:0 },
      },
      required: ['type','ack'],
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
      },
      required: ['id','type','body','ack'],
      additionalProperties: false,
    },
    {
      properties: {
        type: { type:'string', const:'open' },
      },
      required: ['type'],
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
      },
      required: ['type','body','ack'],
      additionalProperties: false,
    },
  ],
};
let validate = ajv.compile(schema);

/*
 * Schema validation errors include why a given JSON payload does not match
 * each one of the "oneOf" sub-schemas.  This is way too much information and
 * is a weakness with combining schemas into one.  To ovecome that weakness,
 * we only return error details for the schema that matches the message type of
 * the JSON payload.
 */
let messageTypeErrorPath = new Map();

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

let sessions = new Map();
let closedSessions = new Set();

/*
 * This function is called to route a new connection.
 */
function route(client, request) {
  Object.assign(client, {
    id: null,
    session: null,
    request: request,
    address: request.headers['x-forwarded-for']
      || request.connection.remoteAddress,
    agent: request.headers['user-agent'] || null,
  });
  client.id = client.address;

  debug(`connect: client=${client.id}; agent=${client.agent}`);

  // Enforce an idle timeout for this connection
  client.lastReceivedAt = new Date().getTime();
  inboundClients.add(client);

  client.on('message', onMessage);
  client.on('close', onClose);
}

/*******************************************************************************
 * Group Management
 ******************************************************************************/
let groups = new Map();

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
  let groupId = [serviceName, body.group].join(':');
  let group = groups.get(groupId);
  if (!group)
    return;

  group.delete(clientId);
  if (group.size === 0)
    groups.delete(groupId);
  else {
    /*
     * Does the user ID still exist in the group under a different session?
     */
    let exists = [...group.values()].find(u => u.id === body.user.id);
    if (!exists) {
      let messageBody = {
        service: serviceName,
        group: body.group,
        user: body.user,
      };

      for (let groupedClientId of group.keys()) {
        enqueue(sessions.get(groupedClientId), 'exit', messageBody);
      }
    }
  }

  // The session won't exist if the user left as the result of disconnecting.
  let session = sessions.get(clientId);
  if (session)
    enqueue(session, 'leave', {
      service: serviceName,
      group: body.group,
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

function sendEvent(serviceName, { body }) {
  let messageBody = { service:serviceName, ...body };

  let groupId = [serviceName, body.group].join(':');
  let group = groups.get(groupId);
  if (!group) return;

  for (let sessionId of group.keys()) {
    enqueue(sessions.get(sessionId), 'event', messageBody);
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

  let session = client.session;
  if (session)
    message.ack = session.clientMessageId;

  client.send(JSON.stringify(message), error => {
    if (error) {
      debug(`${message.type}-out: client=${client.id}; send-error=${error.message}`);
      return;
    }

    debugMessage(client, message, 'out');

    client.lastSentAt = new Date();
    outboundClients.delete(client);
    outboundClients.add(client);

    if (session && message.id)
      session.lastSentMessageId = message.id;
  });
}

function debugMessage(client, message, inOrOut) {
  let prefix = `${message.type}-${inOrOut}: client=${client.id}`;
  let body = message.body;

  let suffix;
  if (message.type === 'sync')
    suffix = `[${message.ack}]`;
  else if (message.type === 'event')
    suffix = `[${message.id}] ${body.service}:${body.type}`;
  else if (message.type === 'request')
    suffix = `[${message.id}] ${body.service}:${body.method}`;
  else if (message.type === 'response')
    if (body.error)
      suffix = `[${message.id}] requestId=${body.requestId}; error=${body.error.message}`;
    else
      suffix = `[${message.id}] requestId=${body.requestId}`;
  else if (message.type === 'join' || message.type === 'leave')
    suffix = `[${message.id}] ${body.service}:${body.group}`;
  else if (message.type === 'authorize')
    suffix = `[${message.id}] ${body.service}`;
  else if (message.type === 'resume')
    suffix = `sessionId=${body.sessionId}`;
  else if (message.type === 'error')
    suffix = `error=${message.error.message}`;

  if (message.type === 'sync')
    if (suffix)
      debugV(`${prefix}; ${suffix}`);
    else
      debugV(prefix);
  else
    if (suffix)
      debug(`${prefix}; ${suffix}`);
    else
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
  inboundClients.delete(client);
  outboundClients.delete(client);

  let session = client.session;
  if (session)
    if (code === CLOSE_GOING_AWAY || code > CLOSE_SERVER_TIMEOUT)
      deleteSession(session);
    else if (code !== CLOSE_REPLACED)
      closeSession(session);
}

function closeSession(session) {
  // Maintain the session in case the client comes back.
  // The session will be deleted once it times out.
  session.closedAt = new Date();
  closedSessions.add(session);
}

function deleteSession(session) {
  let client = session.client;
  if (session.timeout)
    debug(`gone: client=${client.id}; [${client.closed.code}] session timeout`);
  else
    debug(`gone: client=${client.id}; [${client.closed.code}] client exit`);

  closedSessions.delete(session);

  // Delete the session immediately since the client won't come back.
  // This code is used when the websocket webpage is refreshed or closed.
  sessions.delete(session.id);

  groups.forEach(group => group.delete(session.id));

  services.forEach(service => service.dropClient(client));
}

/*******************************************************************************
 * Client Event Handlers
 ******************************************************************************/
function onMessage(data) {
  let client = this;

  // Ignore messages sent right as the server starts closing the connection.
  if (client.closed)
    return;

  // Move the client to the back of the list, keeping idle clients forward.
  client.lastReceivedAt = new Date().getTime();
  inboundClients.delete(client);
  inboundClients.add(client);

  let message;
  try {
    message = JSON.parse(data);
  }
  catch (error) {
    debug(`message-in: client=${client.id}; bytes=${data.length}`);

    return sendError(client, new ServerError({
      code: 415,
      message: 'Message data is not valid JSON'
    }));
  }

  try {
    if (!validate(message)) {
      debug(`message-in: client=${client.id}; bytes=${data.length}`);

      let schemaPath = messageTypeErrorPath.get(message.type);
      let matcher = new RegExp('^' + schemaPath);
      if (schemaPath)
        throw new ServerError({
          code: 422,
          message: 'Unrecognized JSON schema for ' + message.type,
          details: validate.errors
            .filter(detail => matcher.test(detail.schemaPath))
            .map(detail => 'Message ' + detail.message),
        });
      else
        throw new ServerError({
          code: 422,
          message: 'Missing or unrecognized message type',
        });
    }

    debugMessage(client, message, 'in');

    let session = client.session;
    if (session) {
      purgeAcknowledgedMessages(session, message);

      if (message.id) {
        /*
         * Discard repeat messages.  Resync if a message was skipped.
         */
        let expectedMessageId = session.clientMessageId + 1;
        if (message.id < expectedMessageId)
          return;
        if (message.id > expectedMessageId)
          return sendSync(client);

        session.clientMessageId = message.id;
      }
    }

    if (client.session) {
      if (message.type === 'event')
        onEventMessage(client, message);
      else if (message.type === 'request')
        onRequestMessage(client, message);
      else if (message.type === 'join')
        onJoinMessage(client, message);
      else if (message.type === 'leave')
        onLeaveMessage(client, message);
      else if (message.type === 'sync')
        onSyncMessage(client, message);
      else if (message.type === 'authorize')
        onAuthorizeMessage(client, message);
      else /* 'open' || 'resume' */
        throw new ServerError({
          code: 405,
          message: 'A session is already open',
        });
    }
    else {
      if (message.type === 'open')
        onOpenMessage(client, message);
      else if (message.type === 'resume')
        onResumeMessage(client, message);
      else /* 'event', 'request', 'join', 'leave', 'sync' */
        throw new ServerError({
          code: 405,
          message: 'A session must first be opened or resumed',
        });
    }
  }
  catch (error) {
    sendError(client, error, message);
  }
}

function onAuthorizeMessage(client, message) {
  let session = client.session;
  let requestId = message.id;
  let body = message.body;
  let service = services.get(body.service);
  let method = 'onAuthorize';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError(501, 'Service does not support authorization');

  try {
    let response = service[method](client, body.data);

    if (response instanceof Promise)
      response
        .then(data => enqueue(session, 'response', { requestId, data }))
        .catch(error => sendErrorResponse(client, requestId, error));
    else
      enqueue(session, 'response', { requestId, data:response });
  }
  catch (error) {
    sendErrorResponse(client, requestId, error);
  }
}

function onEventMessage(client, message) {
  let body = message.body;
  let service = services.get(body.service);
  let method = 'on' + body.type.toUpperCase('first') + 'Event';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError(404, 'No such event type');

  let groupId = [body.service, body.group].join(':');
  let group = groups.get(groupId);
  if (!group || !group.has(client.id))
    throw new ServerError(409, 'Must first join the group');

  service.will(client, message.type, body.type);

  service[method](client, body.group, body.data);
}

function onRequestMessage(client, message) {
  let session = client.session;
  let requestId = message.id;
  let body = message.body;
  let service = services.get(body.service);
  let method = 'on' + body.method.toUpperCase('first') + 'Request';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError({
      code: 404,
      message: 'No such request method',
      source: { method:body.method },
    });

  try {
    service.will(client, message.type, body.method);

    let response = service[method](client, ...body.args);

    if (response instanceof Promise)
      response
        .then(data => enqueue(session, 'response', { requestId, data }))
        .catch(error => sendErrorResponse(client, requestId, error));
    else
      enqueue(session, 'response', { requestId, data:response });
  }
  catch (error) {
    sendErrorResponse(client, requestId, error);
  }
}

function onJoinMessage(client, message) {
  let session = client.session;
  let requestId = message.id;
  let body = message.body;
  let service = services.get(body.service);
  let method = 'onJoinGroup';

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!(method in service))
    throw new ServerError(501, 'Service does not support joining groups');

  let groupId = [body.service, body.group].join(':');
  let group = groups.get(groupId);
  if (group && group.has(client.id))
    throw new ServerError(409, 'Already joined group');

  try {
    service.will(client, 'join', body.group);

    let response = service[method](client, body.group, body.params);

    if (response instanceof Promise)
      response
        .then(data => enqueue(session, 'response', { requestId, data }))
        .catch(error => sendErrorResponse(client, requestId, error));
    else
      enqueue(session, 'response', { requestId, data:response });
  }
  catch (error) {
    sendErrorResponse(client, requestId, error);
  }
}

function onLeaveMessage(client, message) {
  let body = message.body;
  let service = services.get(body.service);

  if (!service)
    throw new ServerError(404, 'No such service');
  if (!('onLeaveGroup' in service))
    throw new ServerError(501, 'Service does not support leaving groups');

  let groupId = [body.service, body.group].join(':');
  let group = groups.get(groupId);
  if (!group || !group.has(client.id))
    throw new ServerError(409, 'Already left group');

  service.will(client, 'leave', body.group);

  service.onLeaveGroup(client, body.group);
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

  let session = client.session = {
    id: uuid(),
    clientMessageId: 0,
    serverMessageId: 0,
    lastSentMessageId: 0,
    outbox: [],
  };
  client.id = session.id;
  session.client = client;

  sessions.set(client.id, session);

  send(client, {
    type: 'session',
    body: {
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

  if (session.closedAt) {
    // Reopen the session
    delete session.closedAt;
    closedSessions.delete(session);
  }
  else
    // Close the previous client, but not the session
    closeClient(session.client, CLOSE_REPLACED);

  client.session = session;
  client.id = session.id;
  session.client = client;

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
  let client = this;

  closeClient(client, code, reason);
}

/*******************************************************************************
 * Connection and Session Monitoring
 *
 * Send sync messages every 5 seconds on otherwise outbound-idle connections.
 * Close connections after 10 seconds of being inbound-idle.
 ******************************************************************************/
/*
 * These sets are ordered by clients that are idle longest to shortest.
 */
let inboundClients = new Set();
let outboundClients = new Set();

setInterval(() => {
  try {
    let inboundTimeout = new Date() - 10000; // 10 seconds ago
    for (let client of inboundClients) {
      if (client.lastReceivedAt > inboundTimeout)
        break;

      closeClient(client, CLOSE_CLIENT_TIMEOUT);
    }

    let outboundTimeout = new Date(new Date() - 5000); // 5 seconds ago
    for (let client of outboundClients) {
      if (client.lastSentAt > outboundTimeout)
        break;

      sendSync(client);
    }

    // When a connection is lost, the session will timeout after 30 seconds.
    // A token is refreshed 60 seconds before it expires.  Make sure this buffer
    // always exceeds the session timeout.
    let sessionTimeout = new Date(new Date() - 30000); // 30 seconds ago
    for (let session of closedSessions) {
      if (session.closedAt > sessionTimeout)
        break;

      session.timeout = true;

      deleteSession(session);
    }
  }
  catch (error) {
    console.error(error);
  }
}, 1000);
