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
   * Stubs to be implemented by subclasses
   */
  will(client, messageType, bodyType) {
    return true;
  }
  dropClient() {
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
