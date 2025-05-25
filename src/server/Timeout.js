import DebugLogger from 'debug';

import emitter from '#utils/emitter.js';
import serializer from '#utils/serializer.js';

const timeouts = new Map();
const intervals = [];

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
    for (let itemTimeout of timeouts.values())
      itemTimeout._tick(now);

    if (intervals.length && intervals[0].expireAt <= Date.now()) {
      for (const interval of intervals.slice()) {
        if (interval.expireAt > Date.now())
          break;
        interval.expireAt += interval.duration;
        interval.callback();
      }
      intervals.sort((a,b) => a.expireAt - b.expireAt);
    }
  }

  static setInterval(callback, duration, delay = true) {
    intervals.push({
      callback,
      duration,
      expireAt: typeof delay === 'number' ? Date.now() + delay : Date.now() + duration,
    });
    if (!delay)
      callback();
    intervals.sort((a,b) => a.expireAt - b.expireAt);
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
  flush() {
    this._tick(Date.now());
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

  add(itemId, item, ttl = null) {
    if (item === undefined || item === null)
      throw new Error(`${this.name}: ${itemId} item is missing`);

    let itemTimeout;

    const opened = this._opened;
    if (opened.has(itemId)) {
      itemTimeout = opened.get(itemId);
      const expireAt = this._setExpireAt(itemTimeout, ttl);
      this.log('add', `refresh=${itemId}; ttl=${ttl}; expireAt=${expireAt.toISOString()}; openCount=${itemTimeout.openCount}`);
      return item;
    }

    const closed = this._closed;
    if (closed.has(itemId)) {
      itemTimeout = closed.get(itemId);
      const expireAt = this._setExpireAt(itemTimeout, ttl);
      this.log('add', `refresh=${itemId}; ttl=${ttl}; expireAt=${expireAt.toISOString()}`);

      closed.delete(itemId);
    } else {
      itemTimeout = { item };
      const expireAt = this._setExpireAt(itemTimeout, ttl);
      this.log('add', `add=${itemId}; ttl=${ttl}; expireAt=${expireAt.toISOString()}`);
    }

    this._addSorted(itemId, itemTimeout);

    return item;
  }
  sync(target, targetId, itemId, item, expireAt = null) {
    this._opened.delete(itemId);
    this._closed.delete(itemId);
    if (target._opened.has(targetId)) {
      const itemTimeout = Object.assign({}, target._opened.get(targetId), { item });
      this._opened.set(itemId, itemTimeout);
      this.log('sync', `open=${itemId}; openCount=${itemTimeout.openCount}`);
    } else if (target._closed.has(targetId)) {
      const itemTimeout = Object.assign({}, target._closed.get(targetId), { item });
      if (expireAt)
        itemTimeout.expireAt = new Date(Math.max(expireAt, itemTimeout.expireAt));
      this._addSorted(itemId, itemTimeout);
      this.log('sync', `add=${itemId}; expireAt=${itemTimeout.expireAt.toISOString()}`);
    } else {
      this.log('sync', `delete=${itemId}`);
    }
  }
  has(itemId) {
    return this._opened.has(itemId) || this._closed.has(itemId);
  }
  get(itemId) {
    return this._opened.get(itemId)?.item ?? this._closed.get(itemId)?.item;
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
  close(itemId, ttl = null) {
    const opened = this._opened;
    if (!opened.has(itemId)) {
      console.log(`Warning: ${this.name}: Attempted to close an item '${itemId}' that is not open`);
      return;
    }

    const itemTimeout = opened.get(itemId);
    itemTimeout.openCount--;

    if (itemTimeout.openCount === 0) {
      opened.delete(itemId);

      const expireAt = this._setExpireAt(itemTimeout, ttl);
      delete itemTimeout.openCount;
      this._addSorted(itemId, itemTimeout);

      this.log('close', `close=${itemId}; expireAt=${expireAt.toISOString()}`);
    } else {
      this.log('close', `close=${itemId}; openCount=${itemTimeout.openCount}`);
    }

    return itemTimeout.item;
  }

  openedKeys() {
    return this._opened.keys();
  }
  openedValues() {
    return [ ...this._opened ].map(([ k, v ]) => v.item);
  }
  closedKeys() {
    return this._closed.keys();
  }
  closedValues() {
    return [ ...this._closed ].map(([ k, v ]) => v.item);
  }
  keys() {
    return [ ...this._opened.keys(), ...this._closed.keys() ];
  }
  values() {
    const openedValues = [ ...this._opened ].map(([ k, v ]) => v.item);
    const closedValues = [ ...this._closed ].map(([ k, v ]) => v.item);

    return openedValues.concat(closedValues);
  }
  clear() {
    const values = this.values();
    this._opened.clear();
    this._closed.clear();

    this.log('clear', `clear=${values.length}`);
    return values;
  }

  _setExpireAt(itemTimeout, ttl) {
    const now = Date.now();

    if (ttl === null) {
      const expireAt = new Date(now + this.expireIn);
      if (!itemTimeout.expireAt || expireAt > itemTimeout.expireAt)
        itemTimeout.expireAt = expireAt;
    } else {
      const expireAt = typeof ttl === 'number' ? new Date(now + ttl) : ttl instanceof Date ? ttl : new Date(NaN);
      if (isNaN(expireAt.getTime()))
        throw new TypeError(`ttl is not a valid number or Date: ${ttl}`);

      itemTimeout.expireAt = expireAt;
    }

    return itemTimeout.expireAt;
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
