import DebugLogger from 'debug';

import emitter from '#utils/emitter.js';
import serializer from '#utils/serializer.js';

const timeouts = new Map();

export default class Timeout {
  constructor(name, config = {}) {
    if (timeouts.has(name))
      throw new Error(`Timeout name conflict: ${name}`);

    Object.assign(this, {
      name,
      verbose: false,
      debug: DebugLogger(`timeout:${name}`),
      debugV: DebugLogger(`timeout-v:${name}`),

      interval: 0,
      expireIn: 60 * 60 * 1000,
      expireLimit: Infinity,
    }, config, {
      _opened: new Map(),
      _closed: new Map(),
      _isPaused: false,
    });

    timeouts.set(name, this);
  }

  static tick() {
    const now = Date.now();
    for (let itemTimeout of timeouts.values()) {
      itemTimeout._tick(now);
    }
  }

  static fromJSON(data) {
    const timeout = new Timeout(data.name, data.config);

    timeout._opened = data.opened;
    timeout._closed = data.closed;

    return timeout;
  }

  log(operation, message) {
    if (this.verbose === true || Array.isArray(this.verbose) && this.verbose.includes(operation))
      this.debugV(message ?? operation);
    else
      this.debug(message ?? operation);
  }

  pause() {
    this._isPaused = true;
    return this;
  }
  resume() {
    this._isPaused = false;
    return this;
  }

  _tick(now) {
    const closed = this._closed;
    if (closed.size === 0 || this._checkAt > now || this._isPaused)
      return;

    let expiredItems = new Map();
    for (const [ itemId, itemTimeout ] of closed) {
      if (itemTimeout.expireAt > now)
        break;

      expiredItems.set(itemId, itemTimeout.item);
    }

    const totalExpiredItems = expiredItems.size;
    const expireLimit = typeof this.expireLimit === 'function'
      ? this.expireLimit(totalExpiredItems)
      : this.expireLimit;

    if (expireLimit < totalExpiredItems)
      expiredItems = new Map(
        [ ...expiredItems ].slice(0, expireLimit),
      );

    if (expiredItems.size) {
      for (const itemId of expiredItems.keys())
        closed.delete(itemId);

      this.log('expire', `expire=${expiredItems.size}/${totalExpiredItems}; closed=${closed.size}; opened=${this._opened.size}`);
      this._emit({ type:'expire', data:expiredItems });
    }

    this._checkAt = now + this.interval;
  }

  add(itemId, item, ttl = this.expireIn) {
    if (item === undefined || item === null)
      throw new Error(`${this.name}: ${itemId} item is missing`);

    let itemTimeout;
    const expireAt = Date.now() + ttl;

    const opened = this._opened;
    if (opened.has(itemId)) {
      itemTimeout = opened.get(itemId);
      if (expireAt > itemTimeout.expireAt) {
        itemTimeout.expireAt = expireAt;
        this.log('add', `refresh=${itemId}; ttl=${ttl}; openCount=${itemTimeout.openCount}`);
      }
      return item;
    }

    const closed = this._closed;
    if (closed.has(itemId)) {
      itemTimeout = closed.get(itemId);
      if (expireAt > itemTimeout.expireAt) {
        itemTimeout.expireAt = expireAt;
        closed.delete(itemId);
        this.log('add', `refresh=${itemId}; ttl=${ttl}`);
      } else
        return item;
    } else {
      itemTimeout = { item, expireAt };
      this.log('add', `add=${itemId}; ttl=${ttl}`);
    }

    this._addSorted(itemId, itemTimeout);

    return item;
  }
  has(itemId) {
    return this._opened.has(itemId) || this._closed.has(itemId);
  }
  get(itemId) {
    return this._opened.get(itemId)?.item || this._closed.get(itemId)?.item;
  }
  getOpen(itemId) {
    if (!this._opened.has(itemId))
      throw new Error(`${this.name}: ${itemId} is not open`);

    return this._opened.get(itemId).item;
  }
  delete(itemId) {
    if (!this._opened.has(itemId) && !this._closed.has(itemId))
      return;

    this.log('delete', `delete=${itemId}`);

    return this._opened.delete(itemId) || this._closed.delete(itemId);
  }
  get openedSize() {
    return this._opened.size;
  }
  get closedSize() {
    return this._closed.size;
  }
  get size() {
    return this._opened.size + this._closed.size;
  }

  /*
   * As long as an item is open, it will never expire.
   */
  open(itemId, item) {
    const opened = this._opened;
    const closed = this._closed;

    if (opened.has(itemId)) {
      const itemTimeout = opened.get(itemId);
      itemTimeout.openCount++;

      this.log('open', `open=${itemId}; openCount=${itemTimeout.openCount}`);
      return itemTimeout.item;
    } else if (closed.has(itemId)) {
      const itemTimeout = closed.get(itemId);
      closed.delete(itemId);

      itemTimeout.openCount = 1;
      opened.set(itemId, itemTimeout);

      this.log('open', `reopen=${itemId}`);
      return itemTimeout.item;
    } else {
      const itemTimeout = { item, openCount:1 };
      opened.set(itemId, itemTimeout);

      this.log('open', `open=${itemId}`);
    }

    return item;
  }
  close(itemId, ttl = this.expireIn) {
    const opened = this._opened;
    if (!opened.has(itemId))
      throw new Error(`${this.name}: Attempted to close an item '${itemId}' that is not open`);

    const itemTimeout = opened.get(itemId);
    itemTimeout.openCount--;

    if (itemTimeout.openCount === 0) {
      opened.delete(itemId);

      const expireAt = Date.now() + ttl;
      if (!itemTimeout.expireAt || expireAt > itemTimeout.expireAt)
        itemTimeout.expireAt = expireAt;
      delete itemTimeout.openCount;
      this._addSorted(itemId, itemTimeout);

      this.log('close', `close=${itemId}`);
    } else {
      this.log('close', `close=${itemId}; openCount=${itemTimeout.openCount}`);
    }

    return itemTimeout.item;
  }

  openValues() {
    return [ ...this._opened ].map(([ n, v ]) => v.item);
  }
  values() {
    const openedValues = [ ...this._opened ].map(([ n, v ]) => v.item);
    const closedValues = [ ...this._closed ].map(([ n, v ]) => v.item);

    return openedValues.concat(closedValues);
  }
  clear() {
    const values = this.values();
    this._opened.clear();
    this._closed.clear();

    this.log('clear', `clear=${values.length}`);
    return values;
  }

  _addSorted(itemId, itemTimeout) {
    const closed = this._closed;

    if (closed.size) {
      const closedArray = [ ...closed ];

      if (itemTimeout.expireAt > closedArray.last.expireAt)
        closed.set(itemId, itemTimeout);
      else {
        closedArray.pushSorted([ itemId, itemTimeout ], i =>
          i[1].expireAt - itemTimeout.expireAt
        );
        this._closed = new Map(closedArray);
      }
    } else
      closed.set(itemId, itemTimeout);
  }

  toJSON() {
    const config = {};
    if (this.verbose !== false)
      config.verbose = this.verbose;
    if (this.interval !== 0)
      config.interval = this.interval;
    if (this.expireIn !== 60 * 60 * 1000)
      config.expireIn = this.expireIn;
    if (this.expireLimit !== Infinity)
      config.expireLimit = this.expireLimit;

    return {
      name: this.name,
      config,
      opened: this._opened,
      closed: this._closed,
    };
  }
}

Timeout.timeouts = timeouts;
emitter(Timeout);

serializer.addType({
  name: 'Timeout',
  constructor: Timeout,
  schema: {
    type: 'object',
    required: [ 'name' ],
    additionalProperties: false,
    properties: {
      name: { type:'string' },
      config: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verbose: {
            type: [ 'boolean', 'array' ],
            items: { type:'string' },
          },
          interval: { type:'integer' },
          expireIn: { type:'integer' },
          expireLimit: { type:'integer' },
        },
      },
      opened: { $ref:'#/definitions/set' },
      closed: { $ref:'#/definitions/set' },
    },
    definitions: {
      set: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: [
            { type:[ 'string', 'number' ] },
            {},
          ],
        },
      },
    },
  },
});
