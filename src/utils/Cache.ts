// @ts-expect-error
import DebugLogger from 'debug';
import { TypedEmitter } from '#utils/emitter.js';
// @ts-expect-error
import ticker from '#utils/ticker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CacheKey = {};

type DeleteReason = 'finalized' | 'collected' | 'rejected' | 'replaced' | 'deleted' | (string & {});
type ExternalDeleteReason = Exclude<DeleteReason, 'finalized'>;

type CacheEvents<V> = {
  delete: { key: CacheKey; reason: DeleteReason };
};

type StackEntry<K extends CacheKey> = {
  id: number;
  key: K;
  expireAt: number;
};

type BaseMeta<K extends CacheKey> = {
  key: K;
  stackEntry: StackEntry<K> | null;
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
  limit?: number;
};

type CacheValue = object | string | number | boolean | symbol | bigint | null;

type Getter<K extends CacheKey, V extends CacheValue> =
  | V
  | ((key:K) => V | PromiseLike<V | undefined> | undefined);

type CacheStats = {
  hits: number;
  misses: number;
  sets: number;
  deletes: Map<string, number>;
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

// Caches are expected to be global, so we will assume they are never garbage collected.
const caches = new Map<string, Cache<CacheKey, any>>();
let lastTick = Date.now();
let monoCounter = 0;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export default class Cache<K extends CacheKey, V extends CacheValue> extends TypedEmitter<CacheEvents<V>> {
  private readonly ttl:number | null;
  private readonly limit:number;
  private readonly data:Map<K, Meta<K, V>>;
  private readonly stack:StackEntry<K>[]; // sorted newest (highest id) at front, oldest at end
  private readonly registry:FinalizationRegistry<WeakRefMeta<K, V>>;
  private readonly stats:CacheStats;
  private readonly debug:(...args:any[]) => void;

  constructor(name:string, options:CacheOptions = {}) {
    super();
    if (caches.has(name))
      throw new Error(`Cache with name '${name}' already exists`);
    const { ttl = 3_600_000, limit = 100 } = options;
    this.ttl = ttl;
    this.limit = limit;
    this.data = new Map();
    this.stack = [];
    this.registry = new FinalizationRegistry((weakMeta:WeakRefMeta<K, V>) => {
      if (this.data.get(weakMeta.key) === weakMeta)
        this._delete(weakMeta.key, 'finalized');
    });
    this.stats = { hits:0, misses:0, sets:0, deletes:new Map() };
    this.debug = DebugLogger(`cache:${name}`);
    caches.set(name, this);
  }

  static tick({ now }:{ now:number }): void {
    if ((now - lastTick) < 5000) return;
    lastTick = now;
    for (const cache of caches.values()) {
      cache.tick(now);
      const s = cache.stats;
      const deleteStr = [...s.deletes.entries()].map(([r,n]) => `${r}=${n}`).join('; ');
      cache.debug(
        `data=${cache.data.size}; stack=${cache.stack.length}` +
        `; hits=${s.hits}; misses=${s.misses}; sets=${s.sets}` +
        (deleteStr ? `; deletes: ${deleteStr}` : '; deletes=0')
      );
      if (cache.stack.length && cache.stack.length > cache.data.size) {
        const typeCounts = Array.from(cache.data.values()).reduce((p,c) => {
          const type = c.type satisfies keyof typeof p;
          p[type] = (p[type] ?? 0) + 1;
          return p;
        }, {
          value: 0,
          Promise: 0,
          WeakRef: 0,
        });
        cache.debug(`value=${typeCounts.value}; Promise=${typeCounts.Promise}; WeakRef=${typeCounts.WeakRef}`);
      }
    }
  }

  private _popStack(meta:ValueMeta<K, V>):void {
    const i = this.stack.findSortIndex(s => meta.stackEntry!.id - s.id);
    if (this.stack[i] === meta.stackEntry) this.stack.splice(i, 1);
    meta.stackEntry = null;
  }

  private _pushStack(key:K, meta:ValueMeta<K, V>):void {
    if (meta.stackEntry !== null) this._popStack(meta);
    const stackEntry:StackEntry<K> = { id: ++monoCounter, key, expireAt: Date.now() + this.ttl! };
    meta.stackEntry = stackEntry;
    this.stack.unshift(stackEntry);
    if (this.stack.length > this.limit)
      this._evict(this.stack[this.stack.length - 1]!.key);
  }

  private _refresh(key:K, meta:ValueMeta<K, V>):void {
    if (this.ttl === null) return;
    this._pushStack(key, meta);
  }

  private _evict(key:K):void {
    const meta = this.data.get(key);
    if (!meta || meta.type !== 'value') return;
    this.stack.pop();
    if (meta.value !== null && typeof meta.value === 'object')
      this._setWeakRef(key, meta.value);
    else
      this._delete(key, 'finalized');
  }

  private _setWeakRef(key:K, value:V & object):void {
    const weakMeta:WeakRefMeta<K, V> = { key, type:'WeakRef', value:new WeakRef(value), stackEntry:null };
    this.data.set(key, weakMeta);
    this.registry.register(value, weakMeta, value);
  }

  private tick(now:number): void {
    const stack = this.stack;
    let i = stack.length;
    for (; i > 0; i--) {
      const item = stack[i - 1]!;
      if (item.expireAt > now) break;
      const meta = this.data.get(item.key);
      if (!meta) continue;
      if (meta.type === 'value' && meta.value !== null && typeof meta.value === 'object') {
        this._setWeakRef(item.key, meta.value);
      } else {
        this._delete(item.key, 'finalized');
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
    if (key === undefined || key === null)
      throw new Error(`Cache key cannot be ${typeof key}`);
    const value = this._fetch(key);
    if (value === undefined)
      this.stats.misses++;
    else if (!Promise.isThenable(value))
      this.stats.hits++;
    if (Promise.isThenable(value)) return undefined;
    return value;
  }

  peek(key:K):V | PromiseLike<V | undefined> | undefined {
    if (key === undefined || key === null)
      throw new Error(`Cache key cannot be ${typeof key}`);
    const value = this._fetch(key);
    if (value === undefined)
      this.stats.misses++;
    else if (!Promise.isThenable(value))
      this.stats.hits++;
    return value;
  }

  private _fetch(key:K):V | PromiseLike<V | undefined> | undefined {
    const meta = this.data.get(key);
    if (!meta) return undefined;
    if (meta.type === 'WeakRef') {
      const value = meta.value.deref();
      if (value === undefined) {
        this._delete(key, 'collected');
        return undefined;
      }
      if (this.ttl !== null) {
        this.registry.unregister(value);
        const valueMeta:ValueMeta<K, V> = { key, type:'value', value:value as V, stackEntry:null };
        this.data.set(key, valueMeta);
        this._pushStack(key, valueMeta);
      }
      return value;
    }
    if (meta.type === 'value') this._refresh(key, meta);
    return meta.value;
  }

  set(key:K, getter:V | ((key:K) => V)):V;
  set(key:K, getter:Getter<K, V>):V | PromiseLike<V | undefined> | undefined;
  set(key:K, getter:Getter<K, V>):V | PromiseLike<V | undefined> | undefined {
    if (key === undefined || key === null)
      throw new Error(`Cache key cannot be ${typeof key}`);
    const expireAt = this.ttl !== null ? Date.now() + this.ttl : null;
    const value = typeof getter === 'function' ? getter(key) : getter;
    if (value === undefined) return undefined;
    const existing = this.data.get(key);
    if (existing?.type === 'Promise') {
      // The promise is resolving to its final value — not a new set.
    } else if (existing) {
      const existingValue = existing.type === 'WeakRef' ? existing.value.deref() : existing.value;
      if (existingValue === value) return value;
      this._delete(key, 'replaced');
      this.stats.sets++;
    } else {
      this.stats.sets++;
    }
    if (Promise.isThenable(value)) {
      const promise = value.then(
        (v:unknown) => this.set(key, v as V),
        (e:unknown) => { this._delete(key, 'rejected'); throw e; }
      );
      const meta:PromiseMeta<K, V> = { key, type:'Promise', value:promise, stackEntry:null };
      this.data.set(key, meta);
      return promise;
    } else if (expireAt) {
      const meta:ValueMeta<K, V> = { key, type:'value', value, stackEntry:null };
      this.data.set(key, meta);
      this._pushStack(key, meta);
    } else if (value !== null && typeof value === 'object') {
      this._setWeakRef(key, value);
    } else {
      const meta:ValueMeta<K, V> = { key, type:'value', value, stackEntry:null };
      this.data.set(key, meta);
    }
    return value;
  }

  delete(key:K, reason:ExternalDeleteReason = 'deleted'):void {
    if ((reason as DeleteReason) === 'finalized')
      throw new Error(`'finalized' is a reserved delete reason`);
    this._delete(key, reason);
  }

  private _delete(key:K, reason:DeleteReason):void {
    if (reason !== 'finalized') {
      const meta = this.data.get(key);
      if (meta?.type === 'WeakRef') {
        const value = meta.value.deref();
        if (value !== undefined)
          this.registry.unregister(value);
      }
      if (meta?.type === 'value')
        if (meta.stackEntry !== null) this._popStack(meta);
    }
    this.data.delete(key);
    this.stats.deletes.set(reason, (this.stats.deletes.get(reason) ?? 0) + 1);
    this.emit('delete', { key, reason });
  }

  *values():Generator<V> {
    for (const [key, meta] of this.data.entries()) {
      if (meta.type === 'WeakRef') {
        const value = meta.value.deref();
        if (value !== undefined) yield value;
      } else if (meta.type === 'value') {
        yield meta.value;
      }
    }
  }

  *[Symbol.iterator]():Generator<[K, V]> {
    for (const [key, meta] of this.data.entries()) {
      if (meta.type === 'WeakRef') {
        const value = meta.value.deref();
        if (value !== undefined) yield [key, value];
      } else if (meta.type === 'value') {
        yield [key, meta.value];
      }
    }
  }
}

ticker.on('tick', Cache.tick);