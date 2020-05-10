import config from 'config/client.js';
import Version from 'client/Version.js';
import { getUpdate } from 'client/Update.js';
import EventEmitter from 'events';
import ServerError from 'server/Error.js';

const CLOSE_CLIENT_TIMEOUT = 4000;

// Proprietary codes used by client
const CLOSE_SERVER_TIMEOUT   = 4100;
export const CLOSE_SHUTDOWN  = 4101;
export const CLOSE_INACTIVE  = 4102;
const CLOSE_CLIENT_ERROR     = 4103;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN       = 1;
const SOCKET_CLOSING    = 2;
const SOCKET_CLOSED     = 3;

let sockets = new Map();

export default class ServerSocket {
  constructor(endpoint) {
    Object.assign(this, {
      endpoint: endpoint,
      isActive: false,
      ignoreUpdate: false,

      // The difference in ms between the server and client time
      _serverTimeDiff: null,
      // Open connection to the server.
      _socket: null,
      // Send a sync message after 5 seconds of idle sends.
      _syncTimeout: null,
      // Close connection after 10 seconds of idle receives.
      _closeTimeout: null,

      _whenAuthorized: new Map(),
      _authorizeRoutes: new Map(),
      _whenJoined: new Map(),
      _joinRoutes: new Map(),

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
        // The close code when the session was closed.
        closed: false,
      },

      // Used to detect successful connection to the server.
      _openListener: event => this._onOpen(event),
      // Used to detect failed connection to the server.
      _failListener: event => this._onFail(event),
      // Used to recieve messages from the server.
      _messageListener: event => this._onMessage(event),
      // Used to detect dropped connections to the server.
      _closeListener: event => this._onClose(event),

      _emitter: new EventEmitter(),
    });

    if (window.AUTO_CONNECT)
      this.open();
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
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
  get closed() {
    return this._session.closed;
  }

  /*
   * Get a promise that resolves once the service becomes authorized.
   */
  whenAuthorized(serviceName) {
    let whenAuthorized = this._whenAuthorized;

    if (!whenAuthorized.has(serviceName)) {
      let promise = new Promise((resolve, reject) => {
        this._authorizeRoutes.set(serviceName, { resolve, reject });
      });
      promise.isResolved = false;
      promise.ignoreConnectionReset = true;

      whenAuthorized.set(serviceName, promise);
      return promise;
    }

    return whenAuthorized.get(serviceName);
  }
  whenJoined(serviceName, groupPath) {
    let whenJoined = this._whenJoined;
    let groupKey = `${serviceName}:${groupPath}`;

    if (!whenJoined.has(groupKey)) {
      let promise = new Promise((resolve, reject) => {
        this._joinRoutes.set(groupKey, { resolve, reject });
      });
      promise.isResolved = false;
      promise.ignoreConnectionReset = true;

      whenJoined.set(groupKey, promise);
      return promise;
    }

    return whenJoined.get(groupKey);
  }

  open() {
    if (this.isActive) return;
    this.isActive = true;

    try {
      let socket = new WebSocket(this.endpoint);
      socket.addEventListener('open', this._openListener);
      socket.addEventListener('close', this._failListener);
    }
    catch (e) {
      // Prevent websocket errors from stopping code execution.
      // But rethrow the error so that it can be logged.
      setTimeout(() => { throw e; });
    }
  }
  close(code, reason) {
    if (!code) throw new Error('Required close code');

    let socket = this._socket;
    if (!socket) return;

    this._socket = null;
    this._session.isOpen = false;
    this._session.closed = code;

    let reopen = code < CLOSE_SHUTDOWN;

    if (reopen)
      console.warn(`Connection closed: [${code}] ${reason}`);

    socket.removeEventListener('message', this._messageListener);
    socket.removeEventListener('close', this._closeListener);

    clearTimeout(this._syncTimeout);
    clearTimeout(this._closeTimeout);

    // Close the socket if closing was initiated by the client.
    if (socket.readyState === SOCKET_OPEN)
      socket.close(code, reason);

    this.isActive = false;

    // Notify clients that messages are being queued.
    this._emit({ type:'close' });

    if (reopen)
      this.open();
    else
      this._resetSession();
  }

  /*****************************************************************************
   * Public Methods for sending messages
   ****************************************************************************/
  authorize(serviceName, data) {
    // No point in queueing authorization messages while offline.
    if (!this.isOpen)
      return;

    let session = this._session;
    let requestId = this._enqueue('authorize', {
      service: serviceName,
      data: data,
    });

    return new Promise((resolve, reject) => {
      session.responseRoutes.set(requestId, {resolve, reject});
    }).then(() => {
      let promise = this.whenAuthorized(serviceName);
      promise.isResolved = true;
      this._authorizeRoutes.get(serviceName).resolve();
    }).catch(error => {
      // If the connection is reset while authorizing, ignore it.  A new attempt
      // to authorize will be made when the connection is reestablished.
      if (error === 'Connection reset')
        return;

      throw error;
    });
  }

  join(serviceName, groupPath, params) {
    let messageBody = {
      service: serviceName,
      group: groupPath,
    };

    if (params)
      messageBody.params = params;

    let requestId = this._enqueue('join', messageBody);

    return new Promise((resolve, reject) => {
      this._session.responseRoutes.set(requestId, {resolve, reject});
    }).then(data => {
      let groupKey = `${serviceName}:${groupPath}`;
      let promise = this.whenJoined(serviceName, groupPath);
      promise.isResolved = true;
      this._joinRoutes.get(groupKey).resolve();

      return data;
    });
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

  request(serviceName, methodName, args = []) {
    if (!Array.isArray(args))
      throw new TypeError('Arguments must be an array');

    let requestId = this._enqueue('request', {
      service: serviceName,
      method: methodName,
      args: args,
    });

    return new Promise((resolve, reject) => {
      this._session.responseRoutes.set(requestId, {resolve, reject});
    });
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
      this.request(serviceName, methodName, args)
    );
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _authorizeThen(serviceName, fn) {
    let promise = this.whenAuthorized(serviceName);

    return promise.then(fn)
      .catch(error => {
        if (error.code === 401) {
          /*
           * If there was an authorization failure, then authorization is
           * assumed to have expired.  In that case, reset the authorization
           * status (if it wasn't already reset by a prior attempt) and requeue
           * the function for when authorization is reestablished.
           */
          if (this._whenAuthorized.get(serviceName) === promise)
            this._whenAuthorized.delete(serviceName);

          return this._authorizeThen(serviceName, fn);
        }

        throw error;
      });
  }
  _enqueue(messageType, body) {
    let session = this._session;
    let message = {
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
    let socket = this._socket;
    let session = this._session;

    // Can't send messages until the connection is established.
    if (!this.isConnected)
      return;
    // Wait until session is confirmed before sending queued messages.
    if (!session.id && message.id)
      return;

    if (session.id && message.type !== 'open')
      message.ack = session.serverMessageId;

    clearTimeout(this._syncTimeout);
    this._syncTimeout = setTimeout(() => this._sendSync(), 5000);

    socket.send(JSON.stringify(message));
  }
  _purgeAcknowledgedMessages(messageId) {
    let session = this._session;

    /*
     * Purge acknowledged messages from the outgoing queue.
     */
    let outbox = session.outbox;
    while (outbox.length) {
      if (messageId < outbox[0].id)
        break;

      outbox.shift();
    }
  }
  _resetSession(session = this._session) {
    // Authorized services are no longer authorized.
    this._authorizeRoutes.forEach(route => route.reject('Connection reset'));
    this._authorizeRoutes.clear();
    this._whenAuthorized.clear();

    // Joined groups are no longer joined.
    this._joinRoutes.forEach(route => route.reject('Connection reset'));
    this._joinRoutes.clear();
    this._whenJoined.clear();

    // Reset the session
    session.responseRoutes.forEach(route => route.reject('Connection reset'));

    session.id = null;
    session.serverMessageId = 0;
    session.clientMessageId = 0;
    session.outbox.length = 0;
    session.responseRoutes.clear();
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }

  /*****************************************************************************
   * Socket Event Handlers
   ****************************************************************************/
  _onOpen({ target:socket }) {
    // This should never happen.
    if (this._socket)
      return socket.close(CLOSE_CLIENT_ERROR, 'Existing connection');

    socket.removeEventListener('open', this._openListener);
    socket.removeEventListener('close', this._failListener);

    socket.addEventListener('message', this._messageListener);
    socket.addEventListener('close', this._closeListener);
    this._socket = socket;

    this._syncTimeout = setTimeout(() => this._sendSync(), 5000);

    if (this._session.id)
      this._sendResume();
    else
      this._sendOpen();
  }

  _onFail({ target:socket, code, reason }) {
    socket.removeEventListener('open', this._openListener);
    socket.removeEventListener('close', this._failListener);

    console.warn(`Connection failed: [${code}] ${reason}`);

    this.isActive = false;
    this.open();
  }

  _onMessage({data}) {
    let now = Date.now();
    let message = JSON.parse(data);
    let session = this._session;

    // Reset the close timeout
    clearTimeout(this._closeTimeout);
    this._closeTimeout = setTimeout(
      () => this.close(CLOSE_SERVER_TIMEOUT),
      process.env.CONNECTION_TIMEOUT,
    );

    let serverTimeDiff = message.now - now;
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
        let expectedMessageId = session.serverMessageId + 1;
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
    if (message.type === 'event')
      this._emit({ type:'event', body:message.body });
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
    let session = this._session;
    let route = session.responseRoutes.get(response.requestId);
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
    let session = this._session;

    /*
     * The message.ack id was already used to remove all acknowledged messages
     * from the outbox.  So, all remaining messages need to be sent.
     */
    let outbox = session.outbox;
    for (let i = 0; i < outbox.length; i++) {
      this._send(outbox[i]);
    }
  }
  async _onSessionMessage(message) {
    let session = this._session;
    session.isOpen = true;
    session.closed = false;

    if (session.id === message.body.sessionId) {
      this._emit({ type:'open', data:{ reason:'resume' }});

      // Resume the session
      this._purgeAcknowledgedMessages(message.ack);
      this._onSyncMessage(message);
    }
    else {
      let outbox = session.outbox.slice();
      let isNew = !session.id;

      if (!isNew)
        this._resetSession(session);

      session.id = message.body.sessionId;
      session.version = new Version(message.body.version);

      let updateError;
      if (!this.ignoreUpdate && !config.version.isCompatibleWith(session.version)) {
        // Only continue if the update fails or is ignored.
        try {
          await getUpdate(session.version);
        }
        catch (error) {
          updateError = error;
        }

        this.ignoreUpdate = true;
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
      }
      else
        this._emit({ type:'open', data:{ reason:'reset', outbox } });

      // Log the error
      if (updateError)
        throw updateError;
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
    if (socket === this._socket)
      return this.close(code, reason);
  }

  destroy(code = CLOSE_SHUTDOWN) {
    this.close(code);
    this._emitter.removeAllListeners();
  }
}
