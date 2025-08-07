import 'plugins/promise.js';
import config from 'config/client.js';
import Version from 'models/Version.js';
import { installUpdate } from 'client/Update.js';
import ServerError from 'server/Error.js';
import getIdle from 'components/getIdle.js';
import emitter from 'utils/emitter.js';
import serializer from 'utils/serializer.js';

const CLOSE_GOING_AWAY = 1001;

const CLOSE_CLIENT_TIMEOUT = 4000;
export const CLOSE_CLIENT_LOGOUT  = 4003;

// Proprietary codes used by client
export const CLOSE_SERVER_TIMEOUT  = 4100;
export const CLOSE_CLIENT_SHUTDOWN = 4101;
export const CLOSE_INACTIVE        = 4102;
const CLOSE_CLIENT_ERROR           = 4103;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN       = 1;
const SOCKET_CLOSING    = 2;
const SOCKET_CLOSED     = 3;

export default class ServerSocket {
  constructor(endpoint) {
    Object.assign(this, {
      endpoint: endpoint,
      isActive: false,

      // The difference in ms between the server and client time
      _serverTimeDiff: null,
      // Open connection to the server.
      _socket: null,
      // Send a sync message after 5 seconds of idle sends.
      _syncTimeout: null,
      // Close connection after CONNECTION_TIMEOUT seconds of idle receives.
      _closeTimeout: null,

      _whenAuthorized: new Map(),
      _whenJoined: new Map(),

      // The close code when the socket was closed.
      closed: false,

      // Track a session across connections
      _session: {
        // Used to restore a session upon reconnection.
        id: null,
        // The server version
        version: null,
        // (ack) Used to detect missed server messages.
        serverMessageId: 0,
        // Used to determine last sent message Id.
        clientMessageId: 0,
        // Outgoing message queue.
        outbox: [],
        // Pending response routes
        responseRoutes: new Map(),
        // Is the socket connected and the session opened?
        isOpen: false,
      },

      // Used to detect successful connection to the server.
      _openListener: event => this._onOpen(event),
      // Used to detect failed connection to the server.
      _failListener: event => this._onFail(event),
      // Used to recieve messages from the server.
      _messageListener: event => this._onMessage(event, Date.now()),
      // Used to detect dropped connections to the server.
      _closeListener: event => this._onClose(event),
    });

    if (window.AUTO_CONNECT)
      this.open();
  }

  get now() {
    return Date.now() + (this._serverTimeDiff || 0);
  }
  get isConnected() {
    let socket = this._socket;

    return socket && socket.readyState === SOCKET_OPEN;
  }
  get isOpen() {
    return this._session.isOpen;
  }
  get version() {
    return this._session.version;
  }

  /*
   * Get a promise that resolves once the service becomes authorized.
   */
  whenAuthorized(serviceName) {
    const whenAuthorized = this._whenAuthorized;

    if (!whenAuthorized.has(serviceName)) {
      const authorizePromise = new Promise();
      authorizePromise.ignoreConnectionReset = true;

      whenAuthorized.set(serviceName, authorizePromise);
      return authorizePromise;
    }

    return whenAuthorized.get(serviceName);
  }
  whenJoined(serviceName, groupPath) {
    const whenJoined = this._whenJoined;
    const groupKey = `${serviceName}:${groupPath}`;

    if (!whenJoined.has(groupKey)) {
      const joinPromise = new Promise();
      joinPromise.ignoreConnectionReset = true;

      whenJoined.set(groupKey, joinPromise);
      return joinPromise;
    }

    return whenJoined.get(groupKey);
  }

  open() {
    if (this.isActive) return;
    this.isActive = true;

    if (this._socket)
      this._destroySocket(this._socket, CLOSE_CLIENT_ERROR, 'Socket conflict in open');

    try {
      const socket = this._socket = new WebSocket(this.endpoint);
      socket.addEventListener('open', this._openListener);
      socket.addEventListener('close', this._failListener);
    } catch (e) {
      // Prevent websocket errors from stopping code execution.
      // But log the error.
      report(e);
    }
  }
  close(code, reason) {
    if (!this.isActive) return;
    this.isActive = false;

    if (!code) throw new Error('Required close code');

    /*
     * A socket won't exist if the connection was lost and we are between retry
     * attempts.  But we might still close() to stop retrying.
     *
     * A socket can be in any of these states at time of closing:
     *   1) CONNECTING: (client initiated by client)
     *      Remove socket event listeners and close and discard the socket.
     *   2) CONNECTED: (close intiated by client)
     *      Remove socket event listeners and close and discard the socket.
     *      Clear timeouts.
     *      A session may or may not be open.
     *   3) CLOSED: (close initiated by server)
     *      Remove socket event listeners and discard the socket.
     *      Clear timeouts.
     *      A session may or may not be open.
     */
    const socket = this._socket;
    const reopen = code !== CLOSE_GOING_AWAY && code < CLOSE_CLIENT_SHUTDOWN;

    if (socket) {
      // Close the socket if closing was initiated by the client.
      // If closing was initiated by the server, this does nothing.
      this._destroySocket(socket, code, reason);
      this._socket = null;
      this.closed = code;

      clearTimeout(this._syncTimeout);
      clearTimeout(this._closeTimeout);

      /*
       * A session won't be open if the socket was never fully connected or if a
       * session hasn't been negotiated with the server yet.
       */
      if (this._session.isOpen) {
        this._session.isOpen = false;

        // Notify clients that we are offline.
        this._emit({ type:'close', data:{ code, reopen } });
      }
    }

    /*
     * Don't reopen if the socket was closed due to inactivity or a shutdown.
     * Do reopen if the socket was closed due to connection loss or timeout.
     */
    if (reopen) {
      console.warn(`Connection closed: [${code}] ${reason}`);

      if (code === CLOSE_CLIENT_LOGOUT)
        this._resetSession();

      // Try to reconnect and resume the session without major interruption.
      this.open();
    } else {
      this._resetSession();
    }
  }

  /*****************************************************************************
   * Public Methods for sending messages
   ****************************************************************************/
  async authorize(serviceName, data) {
    // No point in queueing authorization messages while offline.
    if (!this.isOpen)
      return;

    const requestId = this._enqueue('authorize', {
      service: serviceName,
      data: data,
    });
    const responsePromise = new Promise();

    this._session.responseRoutes.set(requestId, responsePromise);

    try {
      await responsePromise;
      this.whenAuthorized(serviceName).resolve();
    } catch(error) {
      // If the connection is reset while authorizing, ignore it.  A new attempt
      // to authorize will be made when the connection is reestablished.
      if (error === 'Connection reset')
        return;

      throw error;
    }
  }

  async join(serviceName, groupPath, params) {
    const messageBody = {
      service: serviceName,
      group: groupPath,
    };

    if (params)
      messageBody.params = params;

    const groupKey = `${serviceName}:${groupPath}`;
    const requestId = this._enqueue('join', messageBody);
    const responsePromise = new Promise();

    this._session.responseRoutes.set(requestId, responsePromise);

    const data = await responsePromise;
    this.whenJoined(serviceName, groupPath).resolve();

    return data;
  }
  async leave(serviceName, groupPath) {
    const messageBody = {
      service: serviceName,
      group: groupPath,
    };

    const requestId = this._enqueue('leave', messageBody);
    const responsePromise = new Promise();

    this._session.responseRoutes.set(requestId, responsePromise);

    const data = await responsePromise;
    const groupKey = `${serviceName}:${groupPath}`;
    this._whenJoined.delete(groupKey);

    return data;
  }
  emit(serviceName, groupPath, eventType, data) {
    return this.whenJoined(serviceName, groupPath).then(() => {
      this._enqueue('event', {
        service: serviceName,
        group: groupPath,
        type: eventType,
        data: data,
      });
    });
  }

  request(serviceName, methodName, args = [], rejectIfNotOpen = false) {
    if (rejectIfNotOpen === true && this._session.isOpen === false)
      return Promise.reject('Connection reset');

    if (!Array.isArray(args))
      throw new TypeError('Arguments must be an array');

    const requestId = this._enqueue('request', {
      service: serviceName,
      method: methodName,
      args: args,
    });
    const responsePromise = new Promise();

    this._session.responseRoutes.set(requestId, responsePromise);

    return responsePromise;
  }

  /*
   * These methods delay sending messages until authorization is established.
   */
  joinAuthorized(serviceName, groupPath, params) {
    return this._authorizeThen(serviceName, () =>
      this.join(serviceName, groupPath, params)
    );
  }
  emitAuthorized(serviceName, groupPath, eventType, data) {
    return this._authorizeThen(serviceName, () =>
      this.emit(serviceName, groupPath, eventType, data)
    );
  }
  requestAuthorized(serviceName, methodName, args) {
    return this._authorizeThen(serviceName, () =>
      this.request(serviceName, methodName, args, true)
    );
  }

  /*
   * These methods delay sending messages until a group is joined.
   */
  requestJoined(serviceName, groupPath, methodName, args = []) {
    return this._joinThen(serviceName, groupPath, () =>
      this.request(serviceName, methodName, [ groupPath, ...args ], true)
    );
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _destroySocket(socket, code, reason) {
    if (code === CLOSE_CLIENT_ERROR)
      report({
        type: 'CLOSE_CLIENT_ERROR',
        error: 'Unexpected shutdown of socket',
        reason,
        socketState: socket.readyState,
      });

    socket.removeEventListener('open', this._openListener);
    socket.removeEventListener('close', this._failListener);
    socket.removeEventListener('message', this._messageListener);
    socket.removeEventListener('close', this._closeListener);
    if (socket.readyState < SOCKET_CLOSING)
      socket.close(code, reason);
  }

  _authorizeThen(serviceName, fn) {
    const promise = this.whenAuthorized(serviceName);

    return promise.then(fn)
      .catch(error => {
        // Clear the authorized promise if it wasn't already cleared.
        if (error === 'Connection reset' || error.code === 401)
          if (this._whenAuthorized.get(serviceName) === promise)
            this._whenAuthorized.delete(serviceName);

        if (error.code === 401)
          return this._authorizeThen(serviceName, fn);

        throw error;
      });
  }
  _joinThen(serviceName, groupPath, fn) {
    const promise = this.whenJoined(serviceName, groupPath);
    const groupKey = `${serviceName}:${groupPath}`;

    return promise.then(fn)
      .catch(error => {
        // Clear the joined promise if it wasn't already cleared.
        if (error === 'Connection reset' || error.code === 412)
          if (this._whenJoined.get(groupKey) === promise)
            this._whenJoined.delete(groupKey);

        if (error.code === 412)
          return this._joinThen(serviceName, groupPath, fn);

        throw error;
      });
  }
  _enqueue(messageType, body) {
    const session = this._session;
    const message = {
      id: ++session.clientMessageId,
      type: messageType,
      body: body,
    };

    session.outbox.push(message);
    this._send(message);

    return message.id;
  }
  _sendSync() {
    this._send({ type:'sync' });
  }
  _sendOpen() {
    this._send({
      type: 'open',
      body: { version:config.version },
    });
  }
  _sendResume() {
    this._send({
      type: 'resume',
      body: { sessionId:this._session.id },
    });
  }
  _send(message) {
    const socket = this._socket;
    const session = this._session;

    // Can't send messages until the connection is established.
    if (!this.isConnected)
      return;
    // Wait until session is open before sending queued messages.
    if (!session.isOpen && message.id)
      return;

    if (session.id && message.type !== 'open') {
      message.ack = session.serverMessageId;
      message.idle = getIdle();
    }
    // TODO
    //if (message.body)
    //  message.body = serializer.transform(message.body);

    clearTimeout(this._syncTimeout);
    this._syncTimeout = setTimeout(() => this._sendSync(), 5000);

    socket.send(JSON.stringify(message));
  }
  _purgeAcknowledgedMessages(messageId) {
    const session = this._session;

    /*
     * Purge acknowledged messages from the outgoing queue.
     */
    const outbox = session.outbox;
    while (outbox.length) {
      if (messageId < outbox[0].id)
        break;

      outbox.shift();
    }
  }
  _resetSession(session = this._session) {
    // Authorized services are no longer authorized.
    this._whenAuthorized.forEach(promise => promise.reject('Connection reset'));
    this._whenAuthorized.clear();

    // Joined groups are no longer joined.
    this._whenJoined.forEach(promise => promise.reject('Connection reset'));
    this._whenJoined.clear();

    // Reset the session
    session.responseRoutes.forEach(route => route.reject('Connection reset'));
    session.responseRoutes.clear();

    session.id = null;
    session.serverMessageId = 0;
    session.clientMessageId = 0;
    session.outbox.length = 0;
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }

  /*****************************************************************************
   * Socket Event Handlers
   ****************************************************************************/
  _onOpen({ target:socket }) {
    if (socket !== this._socket)
      return this._destroySocket(socket, CLOSE_CLIENT_ERROR, 'Socket conflict in _onOpen');

    socket.removeEventListener('open', this._openListener);
    socket.removeEventListener('close', this._failListener);

    socket.addEventListener('message', this._messageListener);
    socket.addEventListener('close', this._closeListener);

    this._syncTimeout = setTimeout(() => this._sendSync(), 5000);

    if (this._session.id)
      this._sendResume();
    else
      this._sendOpen();
  }

  _onFail({ target:socket, code, reason }) {
    if (socket !== this._socket)
      return this._destroySocket(socket, CLOSE_CLIENT_ERROR, 'Socket conflict in _onFail');

    socket.removeEventListener('open', this._openListener);
    socket.removeEventListener('close', this._failListener);
    this._socket = null;

    console.warn(`Connection failed: [${code}] ${reason}`);

    this.isActive = false;
    this.open();
  }

  _onMessage({ target:socket, data }, now) {
    if (socket !== this._socket)
      return this._destroySocket(socket, CLOSE_CLIENT_ERROR, 'Socket conflict in _onMessage');

    const message = JSON.parse(data);
    const session = this._session;

    if (message.body)
      message.body = serializer.normalize(message.body);

    // Reset the close timeout
    clearTimeout(this._closeTimeout);
    this._closeTimeout = setTimeout(
      () => this.close(CLOSE_SERVER_TIMEOUT),
      parseInt(process.env.CONNECTION_TIMEOUT),
    );

    /*
     * While this does not attempt to measure and subtract latency, it does
     * minimize the effect of latency on the time difference.
     */
    const serverTimeDiff = message.now - now;
    if (this._serverTimeDiff === null)
      this._serverTimeDiff = serverTimeDiff;
    else
      this._serverTimeDiff = Math.max(this._serverTimeDiff, serverTimeDiff);

    /*
     * Discard repeat messages.  Resync if a message was skipped.
     */
    if (session.id) {
      if ('ack' in message)
        this._purgeAcknowledgedMessages(message.ack);

      if (message.id) {
        const expectedMessageId = session.serverMessageId + 1;
        if (message.id < expectedMessageId)
          return;
        if (message.id > expectedMessageId)
          return this._sendSync();

        session.serverMessageId = message.id;
      }
    }

    /*
     * Route the message.
     */
    if ([ 'event', 'join', 'leave' ].includes(message.type))
      this._emit({ type:message.type, body:message.body });
    else if (message.type === 'response')
      this._onResponseMessage(message.body);
    else if (message.type === 'sync')
      this._onSyncMessage(message);
    else if (message.type === 'session')
      this._onSessionMessage(message);
    else if (message.type === 'error')
      this._onErrorMessage(message);
  }
  _onResponseMessage(response) {
    const session = this._session;
    const route = session.responseRoutes.get(response.requestId);
    if (!route) {
      console.error('Unable to route response', response);
      return;
    }

    if (response.error)
      route.reject(new ServerError(response.error));
    else
      route.resolve(response.data);

    session.responseRoutes.delete(response.requestId);
  }
  _onSyncMessage(message) {
    const session = this._session;

    /*
     * The message.ack id was already used to remove all acknowledged messages
     * from the outbox.  So, all remaining messages need to be sent.
     */
    const outbox = session.outbox;
    for (let i = 0; i < outbox.length; i++) {
      this._send(outbox[i]);
    }
  }
  async _onSessionMessage(message) {
    const session = this._session;
    session.isOpen = true;
    session.closed = false;

    if (session.id === message.body.sessionId) {
      this._emit({ type:'open', data:{ reason:'resume' }});

      // Resume the session
      this._purgeAcknowledgedMessages(message.ack);
      this._onSyncMessage(message);
    } else {
      const outbox = session.outbox.slice();
      const isNew = !session.id;

      if (!isNew)
        this._resetSession(session);

      session.id = message.body.sessionId;
      session.version = new Version(message.body.version);

      let updateError;
      if (!session.version.isCompatibleWith(config.version)) {
        installUpdate(session.version);
        return this.destroy('Version mismatch');
      }

      /*
       * Only communicate with compatible servers.
       */
      if (isNew) {
        // New connections do not reset the session.  Presumably, this is to let
        // requests made before the connection was established to be submitted
        // once it is.  In that case, flush the outbox.  This is useful when the
        // game page requests game data before the connection is open.  It would
        // hang for ~5 seconds until a sync message was received.
        this._onSyncMessage(message);

        this._emit({ type:'open', data:{ reason:'new' } });
      } else
        this._emit({ type:'open', data:{ reason:'reset', outbox } });
    }
  }
  _onErrorMessage(message) {
    let error = message.error;
    let source = error.source || {};

    // Can't resume?  Then open a new session.
    if (source.type === 'resume')
      this._sendOpen();
    else {
      if (source.id) {
        let session = this._session;
        let route = session.responseRoutes.get(source.id);
        if (route)
          route.reject(new ServerError({
            code: 500,
            message: 'Unexpected server error',
          }));
      }

      console.error(error);
    }
  }
  _onClose({ target:socket, code, reason }) {
    if (socket !== this._socket)
      return this._destroySocket(socket, CLOSE_CLIENT_ERROR, 'Socket conflict in _onClose');

    return this.close(code, reason);
  }

  destroy(reason) {
    this.close(CLOSE_CLIENT_SHUTDOWN, reason);
  }
};

emitter(ServerSocket);
