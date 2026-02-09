import { TypedEmitter } from '#utils/emitter.js';
import ticker from '#utils/ticker.js';

// Caches are expected to be global, so we will assume they are never garbage collected.
const caches = [];
let lastTick = performance.now();

export default class Cache extends TypedEmitter {
  constructor() {
    super();

    this.data = new Map();
    this.stack = []; // sorted shortest expiration at end for efficient array truncation
    this.registry = new FinalizationRegistry(m => this.delete(m.key, 'finalized'));
    caches.push(this);
  }

  static tick({ now }) {
    if ((now - lastTick) < 5000) return;
    lastTick = now;

    for (const cache of caches)
      cache.tick(now);
  }
  tick(now) {
    const stack = this.stack;
    let i = stack.length;
    for (; i > 0; i--) {
      const item = stack[i - 1];
      if (item.expireAt > now) break;

      const meta = this.data.get(item.key);
      if (meta.value !== null && typeof meta === 'object') {
        meta.type = 'WeakRef';
        meta.value = new WeakRef(meta.value);
      } else
        this.delete(item.key);
    }

    stack.length = i;
  }

  use(key, getter) {
    const value = this.await(key);
    if (value !== undefined) return value;

    return this.set(key, getter);
  }
  has(key) {
    // Can't rely on the has method since the key might exist even though the WeakRef has been collected
    return this.get(key) !== undefined;
  }
  get(key) {
    const value = this.await(key);
    if (value instanceof Promise)
      return;

    return value;
  }
  await(key) {
    if (key === undefined || key === null)
      throw new Error(`Cache key cannot be ${typeof key}`);

    const meta = this.data.get(key);
    if (!meta) return;
    if (meta.type === 'WeakRef') {
      const value = meta.value.deref();
      if (value === undefined)
        this.delete(key, 'collected');
      return value;
    }

    return meta.value;
  }
  set(key, getter, expireAt = null) {
    if (key === undefined || key === null)
      throw new Error(`Cache key cannot be ${typeof key}`);

    if (expireAt instanceof Date) expireAt = expireAt.getTime();

    const value = typeof getter === 'function' ? getter(key) : getter;
    if (value === undefined) return;

    const meta = { key, type:'value', value, expireAt };
    this.data.set(key, meta);

    if (Promise.isThenable(value)) {
      meta.type = 'Promise';
      meta.value = value.then(v => this.set(key, v, expireAt), e => {
        this.delete(key, 'rejected');
        throw e;
      });
    } else if (expireAt) {
      const index = this.stack.findSortIndex(s => s.expireAt - expireAt);
      this.stack.splice(index, 0, { key, expireAt });
    } else if (value !== null && typeof value === 'object') {
      meta.type = 'WeakRef';
      meta.value = new WeakRef(value);
      this.registry.register(value, meta);
    }

    return value;
  }
  delete(key, reason = null) {
    if (reason !== 'finalized') {
      const meta = this.data.get(key);
      if (meta && meta.type === 'WeakRef') {
        const value = meta.value.deref();
        if (value !== undefined)
          this.registry.unregister(value);
      }
    }

    this.data.delete(key);
    this.emit('delete', { key, reason });
  }

  *values() {
    for (const meta of this.data.values())
      yield meta.type === 'WeakRef' ? meta.value.deref() : meta.value; 
  }

  *[Symbol.iterator]() {
    for (const [ key, meta ] of this.data.entries())
      yield [ key, meta.type === 'WeakRef' ? meta.value.deref() : meta.value ];
  }
}

ticker.on('tick', Cache.tick);
