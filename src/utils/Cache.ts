import { TypedEmitter } from '#utils/emitter.js';
// @ts-expect-error
import ticker from '#utils/ticker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CacheKey = {};

type DeleteReason = 'finalized' | 'collected' | 'rejected' | null;

type CacheEvents<V> = {
  delete: { key: CacheKey; reason: DeleteReason };
};

type StackEntry<K extends CacheKey> = {
  key: K;
  expireAt: number;
};

type BaseMeta<K extends CacheKey> = {
  key: K;
  expireAt: number | null;
};

type ValueMeta<K extends CacheKey, V> = BaseMeta<K> & {
  type: 'value';
  value: V;
};

type PromiseMeta<K extends CacheKey, V> = BaseMeta<K> & {
  type: 'Promise';
  value: PromiseLike<V | undefined>;
};

type WeakRefMeta<K extends CacheKey, V> = BaseMeta<K> & {
  type: 'WeakRef';
  value: WeakRef<V & object>;
};

type Meta<K extends CacheKey, V> =
  | ValueMeta<K, V>
  | PromiseMeta<K, V>
  | WeakRefMeta<K, V>;

type CacheOptions = {
  ttl?: number | null;
};

type CacheValue = object | string | number | boolean | symbol | bigint | null;

type Getter<K extends CacheKey, V extends CacheValue> =
  | V
  | ((key:K) => V | PromiseLike<V | undefined> | undefined);

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

// Caches are expected to be global, so we will assume they are never garbage collected.
const caches:Cache<CacheKey, any>[] = [];
let lastTick = Date.now();

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export default class Cache<K extends CacheKey, V extends CacheValue> extends TypedEmitter<CacheEvents<V>> {
  private readonly ttl:number | null;
  private readonly data:Map<K, Meta<K, V>>;
  private readonly stack:StackEntry<K>[]; // sorted shortest expiration at end for efficient array truncation
  private readonly registry:FinalizationRegistry<WeakRefMeta<K, V>>;

  constructor({ ttl = null }:CacheOptions = {}) {
    super();
    this.ttl = ttl;
    this.data = new Map();
    this.stack = [];
    this.registry = new FinalizationRegistry(m => this.delete(m.key, 'finalized'));
    caches.push(this);
  }

  static tick({ now }:{ now:number }): void {
    if ((now - lastTick) < 5000) return;
    lastTick = now;
    for (const cache of caches)
      cache.tick(now);
  }

  private _setWeakRef(key:K, value:V & object, expireAt:number | null):void {
    const weakMeta:WeakRefMeta<K, V> = { key, type: 'WeakRef', value: new WeakRef(value), expireAt };
    this.data.set(key, weakMeta);
    this.registry.register(value, weakMeta, value);
  }

  tick(now:number): void {
    const stack = this.stack;
    let i = stack.length;
    for (; i > 0; i--) {
      const item = stack[i - 1]!;
      if (item.expireAt > now) break;
      const meta = this.data.get(item.key);
      if (!meta) continue;
      if (meta.type === 'value' && meta.value !== null && typeof meta.value === 'object') {
        this._setWeakRef(item.key, meta.value, meta.expireAt);
      } else {
        this.delete(item.key);
      }
    }
    stack.length = i;
  }

  use(key:K, getter:V | ((key:K) => V)):V;
  use(key:K, getter:Getter<K, V>):V | PromiseLike<V | undefined> | undefined;
  use(key:K, getter:Getter<K, V>):V | PromiseLike<V | undefined> | undefined {
    const value = this.peek(key);
    if (value !== undefined) return value;
    return this.set(key, getter);
  }

  has(key:K):boolean {
    // Can't rely on the has method since the key might exist even though the WeakRef has been collected
    return this.get(key) !== undefined;
  }

  get(key:K):V | undefined {
    const value = this.peek(key);
    if (Promise.isThenable(value))
      return undefined;
    return value;
  }

  peek(key:K):V | PromiseLike<V | undefined> | undefined {
    if (key === undefined || key === null)
      throw new Error(`Cache key cannot be ${typeof key}`);
    const meta = this.data.get(key);
    if (!meta) return undefined;
    if (meta.type === 'WeakRef') {
      const value = meta.value.deref();
      if (value === undefined) {
        this.delete(key, 'collected');
        return undefined;
      }
      return value;
    }
    return meta.value;
  }

  set(key:K, getter:V | ((key:K) => V), expireAt?:number | Date | null):V;
  set(key:K, getter:Getter<K, V>, expireAt?:number | Date | null):V | PromiseLike<V | undefined> | undefined;
  set(key:K, getter:Getter<K, V>, expireAt:number | Date | null = null):V | PromiseLike<V | undefined> | undefined {
    if (key === undefined || key === null)
      throw new Error(`Cache key cannot be ${typeof key}`);
    if (expireAt instanceof Date) expireAt = expireAt.getTime();
    if (expireAt === null && this.ttl !== null) expireAt = Date.now() + this.ttl;
    const value = typeof getter === 'function' ? getter(key) : getter;
    if (value === undefined) return undefined;
    if (Promise.isThenable(value)) {
      const promise = value.then(
        (v:unknown) => this.set(key, v as V, expireAt),
        (e:unknown) => { this.delete(key, 'rejected'); throw e; }
      );
      const meta:PromiseMeta<K, V> = { key, type:'Promise', value:promise, expireAt };
      this.data.set(key, meta);
      return promise;
    } else if (expireAt) {
      const existing = this.data.get(key);
      if (existing?.expireAt) {
        let staleIndex = this.stack.findSortIndex(s => s.expireAt - existing.expireAt!);
        while (staleIndex < this.stack.length && this.stack[staleIndex]!.expireAt === existing.expireAt) {
          if (this.stack[staleIndex]!.key === key) { this.stack.splice(staleIndex, 1); break; }
          staleIndex++;
        }
      }
      const meta:ValueMeta<K, V> = { key, type:'value', value, expireAt };
      this.data.set(key, meta);
      const index = this.stack.findSortIndex(s => s.expireAt - expireAt!);
      this.stack.splice(index, 0, { key, expireAt });
    } else if (value !== null && typeof value === 'object') {
      this._setWeakRef(key, value, expireAt);
    } else {
      const meta:ValueMeta<K, V> = { key, type:'value', value, expireAt:null };
      this.data.set(key, meta);
    }
    return value;
  }

  delete(key:K, reason:DeleteReason = null):void {
    if (reason !== 'finalized') {
      const meta = this.data.get(key);
      if (meta?.type === 'WeakRef') {
        const value = meta.value.deref();
        if (value !== undefined)
          this.registry.unregister(value);
      }
    }
    this.data.delete(key);
    this.emit('delete', { key, reason });
  }

  *values():Generator<V> {
    for (const key of this.data.keys()) {
      const value = this.get(key);
      if (value !== undefined) yield value;
    }
  }

  *[Symbol.iterator]():Generator<[K, V]> {
    for (const key of this.data.keys()) {
      const value = this.get(key);
      if (value !== undefined) yield [key, value];
    }
  }
}

ticker.on('tick', Cache.tick);