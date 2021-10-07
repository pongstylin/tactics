import DebugLogger from 'debug';
import EventEmitter from 'events';

const timeouts = new Map();

class Timeout {
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

      _emitter: new EventEmitter(),
    }, config, {
      _opened: new Map(),
      _closed: new Map(),
    });

    timeouts.set(name, this);
  }

  static tick() {
    const now = Date.now();
    for (let itemTimeout of timeouts.values()) {
      itemTimeout._tick(now);
    }
  }

  log(operation, message) {
    if (this.verbose === true || Array.isArray(this.verbose) && this.verbose.includes(operation))
      this.debugV(message ?? operation);
    else
      this.debug(message ?? operation);
  }

  _tick(now) {
    const closed = this._closed;
    if (closed.size === 0 || this._checkAt > now)
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
      this.emit({ type:'expire', data:expiredItems });
    }

    this._checkAt = now + this.interval;
  }

  add(itemId, item, ttl = this.expireIn) {
    if (item === undefined || item === null)
      throw new Error(`${this.name}: ${itemId} item is missing`);

    if (this._opened.has(itemId))
      return item;

    const closed = this._closed;
    if (closed.has(itemId)) {
      const itemTimeout = closed.get(itemId);
      itemTimeout.expireAt = Date.now() + ttl;

      if (ttl === this.expireIn) {
        closed.delete(itemId);
        closed.set(itemId, itemTimeout);
      }

      this.log('add', `refresh=${itemId}`);
    } else {
      closed.set(itemId, {
        item,
        expireAt: Date.now() + ttl,
      });

      this.log('add', `add=${itemId}`);
    }

    if (ttl !== this.expireIn)
      this._closed = new Map(
        [ ...closed ].sort((a,b) => a[1].expireAt - b[1].expireAt)
      );

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
      delete itemTimeout.expireAt;
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
  close(itemId) {
    const opened = this._opened;
    if (!opened.has(itemId))
      throw new Error(`${this.name}: Attempted to close an item '${itemId}' that is not open`);

    const itemTimeout = opened.get(itemId);
    itemTimeout.openCount--;

    if (itemTimeout.openCount === 0) {
      opened.delete(itemId);

      itemTimeout.expireAt = Date.now() + this.expireIn;
      delete itemTimeout.openCount;
      this._closed.set(itemId, itemTimeout);

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

  on() {
    this._emitter.addListener(...arguments);
    return this;
  }
  off() {
    this._emitter.removeListener(...arguments);
    return this;
  }
  emit(event) {
    this._emitter.emit('event', event);
    this._emitter.emit(event.type, event);
  }
}

Timeout.timeouts = timeouts;

export default Timeout;
