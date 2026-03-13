import { TypedEmitter } from '#utils/emitter.js';

type Getter<K, V> = ((key:K) => V | Promise<V>) | V;
type ExpireAt = Date | number | null;

type CacheEvents<K> = {
  'delete': { key:K, reason:'finalized' | 'collected' | 'rejected' | string },
};

export default class Cache<K, V> extends TypedEmitter<CacheEvents<K>> implements Iterable<[K, V]> {
  private data:Map<K, {
    type: 'Promise' | 'WeakRef' | 'value',
    value: Promise<V> | WeakRef<V> | V,
    expireAt: number | null,
  }>

  use<T extends Getter<K, V>>(key:K, getter:T): V | UnwrapFunction<T>;
  has(key:K): boolean;
  get(key:K): V | undefined;
  set<T extends Getter<K, V>>(key:K, getter:T, expireAt:ExpireAt = null): V | UnwrapFunction<T>;
  delete(key:K, reason:string | null = null);

  values(): Generator<V>;
  [Symbol.iterator](): Iterator<[K, V]>;
}