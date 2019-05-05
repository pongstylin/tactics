import ws from 'ws';
import DebugLogger from 'debug';
import EventEmitter from 'events';

import ServerError from 'server/Error.js';

// Keep track of all registered services
export const services = new Map();

export default class {
  constructor(data) {
    if (data.name === undefined)
      throw new TypeError('Required service name');

    Object.assign(this, {
      debug: DebugLogger('service:' + data.name),

      // Keys: Group names
      // Values: Sets of clients that are part of the group
      groups: new Map(),

      // Keys: Clients
      // Values: Action stats maps
      _throttles: new Map(),

      _emitter: new EventEmitter(),
    }, data);

    services.set(this.name, this);
  }

  on() {
    this._emitter.addListener(...arguments);
  }
  off() {
    this._emitter.removeListener(...arguments);
  }

  /*
   * Test if the service will handle the eventName from client
   */
  will(client, messageType, bodyType) {
  }

  isClientInGroup(groupName, client) {
    let group = this.groups.get(groupName);

    return group && group.has(client);
  }
  addClientToGroup(groupName, client) {
    let groups = this.groups;

    if (groups.has(groupName))
      groups.get(groupName).add(client);
    else
      groups.set(groupName, new Set([client]));
  }
  dropClient(client) {
    this.groups.forEach(group => group.delete(client));
  }
  dropClientFromGroup(groupName, client) {
    let groups = this.groups;

    if (groups.has(groupName))
      groups.get(groupName).delete(client);
  }

  sendResponse(client, message, data) {
    let promise;
    if (data instanceof Promise)
      promise = data;
    else
      promise = Promise.resolve(data);

    return promise.then(d =>
      this.sendToClient(client, {
        type: message.type,
        id:   message.id,
        data: d,
      })
    );
  }
  sendErrorResponse(client, message, error) {
    let errorData = {
      code: error.code || 500,
      message: error.message,
    };

    return this.sendToClient(client, {
      type:  message.type,
      id:    message.id,
      error: errorData,
    });
  }

  /*
   * Send data to all clients within a group.
   * Returns a promise resolved when sending of data is complete.
   * The promise may be rejected with a Map of all clients with errors.
   */
  sendToGroup(groupName, message) {
    let recipients = this.groups.get(groupName) || [];
    let errors = new Map();

    this.debug(`message-out: group=${groupName}; ${message.type}`);

    let promises = [...recipients].map(client =>
      this.sendToClient(client, message, false)
        .catch(error => errors.set(client, error))
    );

    return Promise.all(promises).then(() => {
      if (errors.size) throw errors;
    });
  }
  sendToClient(client, message, debugIt = true) {
    if (debugIt)
      if (message.error)
        this.debug(`message-error: client=${client.id}; ${message.type}; [${message.error.code}] ${message.error.message}`);
      else if (message.id)
        this.debug(`message-reply: client=${client.id}; ${message.type}`);
      else
        this.debug(`message-out: client=${client.id}; ${message.type}`);

    message.service = this.name;

    return new Promise((resolve, reject) =>
      client.send(
        JSON.stringify(message),
        { binary:false },
        error => {
          if (error) return reject(error);
          resolve();
        },
      )
    );
  }

  /*
   * Call this method before taking a throttled action
   *  identifier: This could be the client object, address, or device ID.
   *  actionName: Human readable name of the client's action
   *  limit: The maximum number of times the client may perform the action.
   *  period: The period (in seconds) in which the limit applies.
   *
   * If the throttle limit is reached, an error is thrown.
   * 
   * TODO: This just throttles a single connection.  We also need throttling
   * on connections from a single client address.  This belongs outside the
   * service context.
   */
  throttle(identifier, actionName, limit = 3, period = 15) {
    if (!this._throttles.has(identifier))
      this._throttles.set(identifier, new Map());

    let actions = this._throttles.get(identifier);
    let actionKey = [actionName, limit, period].join('\0');

    if (!actions.has(actionKey))
      actions.set(actionKey, []);

    let actionHits = actions.get(actionKey);

    // Prune hits that are older than the period.
    let maxAge = new Date(new Date() - period*1000);
    while (actionHits[0] < maxAge)
      actionHits.shift();

    if (actionHits.length === limit)
      throw new ServerError(429, 'Too Many Requests: ' + actionName);

    actionHits.push(new Date());
  }

  _emit(event) {
    this._emitter.emit(event.type, event);
  }
};
