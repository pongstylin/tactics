import EventEmitter from 'events';
import ServerError from 'server/Error.js';

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN       = 1;
const SOCKET_CLOSING    = 2;
const SOCKET_CLOSED     = 3;

// Observed in Chrome as the result of socket.close().
// Observed in Chrome when the server shuts down.
//const CLOSED_NO_STATUS = 1005;

// Observed w/ error in Chrome when a connection is refused.
// Observed w/ error in Chrome when a connection times out.
// Observed w/o error in Chrome when the server crashed.
//const CLOSE_ABNORMAL = 1006;

let sockets = new Map();

export default class ServerSocket {
  constructor(endpoint) {
    Object.assign(this, {
      endpoint: endpoint,
      autoConnect: true,

      // Open connection to the server.
      _socket: null,
      // Send a sync message after 5 seconds of idle sends.
      _syncTimeout: null,
      // Close connection after 10 seconds of idle receives.
      _closeTimeout: null,
      _whenAuthorized: new Map(),
      _resolveAuthorized: new Map(),

      // Track a session across connections
      _session: {
        // Used to restore a session upon reconnection.
        id: null,
        // (ack) Used to detect missed server messages.
        serverMessageId: 0,
        // Used to determine last sent message Id.
        clientMessageId: 0,
        // Outgoing message queue.
        outbox: [],
        // Pending response routes
        responseRoutes: new Map(),
        // Is the socket connected and the session opened?
        open: false,
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

    this._open();
  }

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }

  get isConnected() {
    let socket = this._socket;

    return socket && socket.readyState === SOCKET_OPEN;
  }
  get isOpen() {
    return this._session.open;
  }

  /*
   * Get a promise that resolves once the service becomes authorized.
   */
  whenAuthorized(serviceName) {
    let whenAuthorized = this._whenAuthorized;

    if (!whenAuthorized.has(serviceName)) {
      let promise = new Promise(resolve => {
        this._resolveAuthorized.set(serviceName, resolve);
      });
      promise.isResolved = false;

      whenAuthorized.set(serviceName, promise);
      return promise;
    }

    return whenAuthorized.get(serviceName);
  }

  close() {
    this.autoConnect = false;
    if (this._socket)
      this._socket.close();
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
      this._resolveAuthorized.get(serviceName)();
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
    });
  }
  emit(serviceName, groupPath, eventType, data) {
    this._enqueue('event', {
      service: serviceName,
      group: groupPath,
      type: eventType,
      data: data,
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
  _open() {
    let socket = new WebSocket(this.endpoint);
    socket.addEventListener('open', this._openListener);
    socket.addEventListener('close', this._failListener);
  }
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

          return this._authorizeThen(fn);
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
  _sync() {
    this._send({ type:'sync' });
  }
  _sendOpen() {
    this._send({ type:'open' });
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
    this._syncTimeout = setTimeout(() => this._sync(), 5000);

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
  _closeIfNeeded() {
    let socket = this._socket;
    let readyState = socket.readyState;
    if (readyState === SOCKET_CLOSING)
      return;
    if (readyState === SOCKET_CLOSED)
      return;

    socket.close();
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }

  /*****************************************************************************
   * Socket Event Handlers
   ****************************************************************************/
  _onOpen(event) {
    let socket = event.target;
    socket.removeEventListener('open', this._openListener);
    socket.removeEventListener('close', this._failListener);

    if (this._socket)
      this._closeIfNeeded();

    socket.addEventListener('message', this._messageListener);
    socket.addEventListener('close', this._closeListener);
    this._socket = socket;

    if (this._session.id)
      this._sendResume();
    else
      this._sendOpen();
  }

  _onFail(event) {
    let socket = event.target;
    socket.removeEventListener('open', this._openListener);
    socket.removeEventListener('close', this._failListener);

    console.warn(`Connection failed: [${event.code}] ${event.reason}`);

    if (this.autoConnect)
      this._open();
  }

  _onMessage({data}) {
    let message = JSON.parse(data);
    let session = this._session;

    // Reset the close timeout
    clearTimeout(this._closeTimeout);
    this._closeTimeout = setTimeout(() => this._closeIfNeeded(), 10000);

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
          return this._sync();

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
  _onSessionMessage(message) {
    let session = this._session;
    session.open = true;

    if (session.id === message.body.sessionId) {
      this._emit({ type:'open', data:{ reason:'resume' }});

      // Resume the session
      this._purgeAcknowledgedMessages(message.ack);
      this._onSyncMessage(message);
    }
    else if (session.id) {
      // Reset the session
      session.responseRoutes.forEach(route => route.reject('Connection reset'));

      let outbox = session.outbox.slice();

      session.id = message.body.sessionId;
      session.serverMessageId = 0;
      session.clientMessageId = 0;
      session.outbox.length = 0;
      session.responseRoutes.clear();

      this._emit({ type:'open', data:{ reason:'reset', outbox }});
    }
    else {
      // Open new session
      session.id = message.body.sessionId;

      this._emit({ type:'open', data:{ reason:'new' }});

      // Send queued messages
      this._onSyncMessage(message);
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

  _onClose({code, reason}) {
    clearTimeout(this._syncTimeout);
    clearTimeout(this._closeTimeout);

    // Authorized services are no longer authorized.
    this._whenAuthorized.forEach((promise, serviceName) => {
      if (promise.isResolved)
        this._whenAuthorized.delete(serviceName);
    });

    let socket = event.target;
    socket.removeEventListener('message', this._messageListener);
    socket.removeEventListener('close', this._closeListener);

    console.warn(`Connection closed: [${code}] ${reason}`);

    this._socket = null;
    this._session.open = false;

    // Notify clients that messages are being queued.
    this._emit({ type:'close' });

    if (this.autoConnect)
      this._open();
  }

  destroy() {
    this.close();
    this._emitter.removeAllListeners();
  }
}