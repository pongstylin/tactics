import { EventEmitter } from 'eventemitter3';

// ---------------------------------------------------------------------------
// Core type utilities
// ---------------------------------------------------------------------------

/** All colon-separated prefixes of a string literal, including itself.
 *  e.g. 'a:b:c' -> 'a' | 'a:b' | 'a:b:c'
 */
type Prefixes<S extends string> = S extends `${infer Head}:${infer Tail}`
  ? Head | `${Head}:${Prefixes<Tail>}`
  : S;

/** All keys of Map whose string key starts with Prefix (including exact match). */
type KeysWithPrefix<Map, Prefix extends string> = {
  [K in keyof Map]: K extends `${Prefix}:${string}` | Prefix ? K : never;
}[keyof Map];

/** An event object: the user-defined payload merged with a `type` discriminant. */
type TypedEvent<K extends string, Payload> = Payload & { type: K };

/** Union of typed event objects for all keys that start with Prefix. */
type EventUnder<Map, Prefix extends string> = {
  [K in KeysWithPrefix<Map, Prefix> & keyof Map]: TypedEvent<K & string, Map[K]>;
}[KeysWithPrefix<Map, Prefix> & keyof Map];

/** All valid listenable events = leaf events + namespace prefixes + wildcard */
type ListenableEvent<Map> =
  | '*'
  | { [K in keyof Map]: K extends string ? Prefixes<K> : never }[keyof Map];

/** The event object type a listener receives for a given listenable event. */
type EventFor<Map, E extends string> =
  E extends '*'
    ? EventUnder<Map, string>                                         // wildcard — union of every event object
    : TypedEvent<E & string, E extends keyof Map ? Map[E] : never>   // leaf type, if E is a key (never if not)
      | EventUnder<Map, E>;                                           // union with all events beneath E as a namespace

type EmitArgs<EventMap extends { [K in keyof EventMap]: object }> = {
  [E in keyof EventMap]:
    | [eventType: E, payload?: EventMap[E]]
    | [payload: EventMap[E] & { type: E }]
}[keyof EventMap];

/** All event map entries in EventMap that fall within the given namespace prefix. */
export type NamespaceEventMap<EventMap extends { [K in keyof EventMap]: object }, Prefix extends string> = {
  [K in KeysWithPrefix<EventMap, Prefix> & keyof EventMap]: EventMap[K];
};

// ---------------------------------------------------------------------------
// Listener type
// ---------------------------------------------------------------------------

type Listener<T> = (event: T) => unknown;

// ---------------------------------------------------------------------------
// TypedEmitter
// ---------------------------------------------------------------------------

/**
 * EventMap should be a flat record of colon-separated event names to their payload types.
 * Payloads must be plain objects. Each listener receives the payload merged with
 * a `type` property containing the exact event type string.
 *
 * ```ts
 * type Events = {
 *   'user:created': { id: string; name: string };
 *   'user:deleted': { id: string };
 *   'order:placed':  { orderId: string; total: number };
 * };
 * ```
 */
export class TypedEmitter<EventMap extends { [K in keyof EventMap]: object }> {
  private ee = new EventEmitter();

  /**
   * Unique symbol used as the context for listeners registered without an
   * explicit context. Allows all listeners to be tracked uniformly.
   */
  private readonly defaultContext = Symbol('defaultContext');

  /**
   * Map from context -> Set of registeredFns. Gives O(1) membership tests
   * and deletions.
   */
  private contextMap = new Map<unknown, Set<Listener<unknown>>>();

  /**
   * Reverse map from registeredFn -> context for O(1) context lookups
   * in off() and removeAllListeners().
   */
  private fnToContext = new Map<Listener<unknown>, unknown>();

  /**
   * Reverse map from registeredFn -> eventType, for O(1) eventType lookups
   * when removing all listeners for a context without a specific eventType.
   */
  private fnToEventType = new Map<Listener<unknown>, string>();

  /**
   * Reverse map from eventType -> Set of registeredFns, for O(1) lookups
   * when removing all listeners for a specific event type across all contexts.
   */
  private eventTypeToFns = new Map<string, Set<Listener<unknown>>>();

  /**
   * Bidirectional map between original once listeners and their wrappers.
   * Stores both original->wrapper and wrapper->original so that untrack()
   * can clean up both entries regardless of which end it receives, making
   * it the single place responsible for onceWrappers cleanup.
   */
  private onceWrappers = new Map<Listener<unknown>, Listener<unknown>>();

  /**
   * Cache of precomputed namespace prefix arrays for each event type string,
   * so emit() avoids repeated split/join work on hot paths. Never cleared —
   * prefix arrays contain no listener state and are cheap to keep.
   */
  private prefixCache = new Map<string, string[]>();

  private getPrefixes(eventType: string): string[] {
    let prefixes = this.prefixCache.get(eventType);
    if (prefixes === undefined) {
      const parts = eventType.split(':');
      prefixes = [];
      for (let i = 1; i < parts.length; i++) {
        prefixes.push(parts.slice(0, i).join(':'));
      }
      this.prefixCache.set(eventType, prefixes);
    }
    return prefixes;
  }

  /** Register a fn in all reverse-lookup structures. */
  private track(context: unknown, eventType: string, fn: Listener<unknown>): void {
    if (!this.contextMap.has(context)) {
      this.contextMap.set(context, new Set());
    }
    this.contextMap.get(context)!.add(fn);
    this.fnToContext.set(fn, context);
    this.fnToEventType.set(fn, eventType);

    if (!this.eventTypeToFns.has(eventType)) {
      this.eventTypeToFns.set(eventType, new Set());
    }
    this.eventTypeToFns.get(eventType)!.add(fn);
  }

  /** Remove a single fn from all reverse-lookup structures. O(1). */
  private untrack(fn: Listener<unknown>, eventType: string): void {
    const context = this.fnToContext.get(fn);
    if (context !== undefined) {
      this.fnToContext.delete(fn);
      const fns = this.contextMap.get(context);
      if (fns) {
        fns.delete(fn);
        if (fns.size === 0) this.contextMap.delete(context);
      }
    }

    this.fnToEventType.delete(fn);

    // Clean up onceWrappers in both directions — fn may be either the
    // original or the wrapper depending on which end untrack receives.
    const other = this.onceWrappers.get(fn);
    if (other !== undefined) {
      this.onceWrappers.delete(fn);
      this.onceWrappers.delete(other);
    }

    const byEvent = this.eventTypeToFns.get(eventType);
    if (byEvent) {
      byEvent.delete(fn);
      if (byEvent.size === 0) this.eventTypeToFns.delete(eventType);
    }
  }

  // -------------------------------------------------------------------------
  // on
  // -------------------------------------------------------------------------

  on<E extends ListenableEvent<EventMap>>(
    eventType: E,
    listener: Listener<EventFor<EventMap, E>>,
    context?: unknown
  ): this {
    const et = eventType as string;
    const fn = listener as Listener<unknown>;
    this.ee.on(et, fn);
    this.track(context ?? this.defaultContext, et, fn);
    return this;
  }

  // -------------------------------------------------------------------------
  // once
  // -------------------------------------------------------------------------

  once<E extends ListenableEvent<EventMap>>(
    eventType: E,
    listener: Listener<EventFor<EventMap, E>>,
    context?: unknown
  ): this {
    const et = eventType as string;
    const fn = listener as Listener<unknown>;

    const wrapper: Listener<unknown> = (event) => {
      fn(event);
      this.untrack(wrapper, et);
    };

    this.onceWrappers.set(fn, wrapper);
    this.onceWrappers.set(wrapper, fn);
    this.ee.once(et, wrapper);
    this.track(context ?? this.defaultContext, et, wrapper);
    return this;
  }

  // -------------------------------------------------------------------------
  // off
  // -------------------------------------------------------------------------

  off<E extends ListenableEvent<EventMap>>(
    eventType: E,
    listener: Listener<EventFor<EventMap, E>>
  ): this {
    const et = eventType as string;
    const fn = listener as Listener<unknown>;
    const registeredFn = this.onceWrappers.get(fn) ?? fn;
    this.ee.removeListener(et, registeredFn);
    this.untrack(registeredFn, et);
    return this;
  }

  // -------------------------------------------------------------------------
  // emit — only exact (leaf) events can be emitted
  // Two call signatures:
  //   emit('event:name', payload)   — two-argument form
  //   emit({ type: 'event:name', ...payload }) — single-object form
  // -------------------------------------------------------------------------

  emit(...args: EmitArgs<EventMap>): this {
    const [eventTypeOrPayload, payload] = args as [unknown, unknown?];
    const et = (typeof eventTypeOrPayload === 'object'
      ? (eventTypeOrPayload as { type: unknown }).type
      : eventTypeOrPayload) as string;
    const eventObject = typeof eventTypeOrPayload === 'object'
      ? { ...eventTypeOrPayload as object }
      : { ...payload as object, type: et };

    // Emit to the exact event type first.
    this.ee.emit(et, eventObject);

    // Then emit to each namespace prefix using the precomputed cache.
    for (const ns of this.getPrefixes(et)) {
      this.ee.emit(ns, eventObject);
    }

    // Finally fire the wildcard.
    this.ee.emit('*', eventObject);

    return this;
  }


  // -------------------------------------------------------------------------
  // emitAsync — emit and await all listeners before returning
  // Uses Promise.allSettled so all listeners run even if some reject.
  // Rejects with an AggregateError if any listeners threw/rejected.
  // -------------------------------------------------------------------------

  async emitAsync(...args: EmitArgs<EventMap>): Promise<void> {
    const [eventTypeOrPayload, payload] = args as [unknown, unknown?];
    const et = (typeof eventTypeOrPayload === 'object'
      ? (eventTypeOrPayload as { type: unknown }).type
      : eventTypeOrPayload) as string;
    const eventObject = typeof eventTypeOrPayload === 'object'
      ? { ...eventTypeOrPayload as object }
      : { ...payload as object, type: et };

    const targets = [et, ...this.getPrefixes(et), '*'];
    const promises: Promise<unknown>[] = [];

    for (const target of targets) {
      for (const fn of this.eventTypeToFns.get(target) ?? []) {
        promises.push(Promise.resolve(fn(eventObject)));
      }
    }

    const results = await Promise.allSettled(promises);
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason);

    if (errors.length > 0)
      throw new AggregateError(errors, `${errors.length} listener(s) rejected during emitAsync('${et}')`);
  }

  // -------------------------------------------------------------------------
  // removeAllListeners
  // -------------------------------------------------------------------------

  removeAllListeners<E extends ListenableEvent<EventMap>>(
    eventType?: E,
    context?: unknown
  ): this {
    const et = eventType as string | undefined;
    if (context !== undefined) {
      // Remove listeners for the given context, optionally filtered by eventType.
      const fns = this.contextMap.get(context);
      if (fns) {
        for (const fn of [...fns]) {
          const fnEt = this.fnToEventType.get(fn)!;
          if (et === undefined || fnEt === et) {
            this.ee.removeListener(fnEt, fn);
            this.untrack(fn, fnEt);
          }
        }
      }
    } else if (et) {
      // Remove all listeners for a specific event type across all contexts.
      this.ee.removeAllListeners(et);
      const fns = this.eventTypeToFns.get(et);
      if (fns) {
        for (const fn of [...fns]) {
          this.untrack(fn, et);
        }
      }
    } else {
      // Remove everything.
      this.ee.removeAllListeners();
      this.onceWrappers.clear();
      this.contextMap.clear();
      this.fnToContext.clear();
      this.fnToEventType.clear();
      this.eventTypeToFns.clear();
    }

    return this;
  }
}

// ---------------------------------------------------------------------------
// emitter — mixes TypedEmitter methods into a class prototype
// ---------------------------------------------------------------------------

/**
 * Mixes TypedEmitter methods directly onto a class prototype. Call once at
 * module level after defining the class. Use interface merging to expose the
 * emitter methods to TypeScript.
 *
 * ```ts
 * type MyEvents = { 'data:received': { value: number } };
 *
 * class MyService {
 *   fetch() { (this as any)._emit('data:received', { value: 42 }); }
 * }
 * interface MyService extends TypedEmitter<MyEvents> {}
 * emitter<MyEvents>(MyService);
 * ```
 */
export default function emitter<EventMap extends { [K in keyof EventMap]: object }>(
  Class: { new(...args: any[]): object; prototype: object }
): void {
  const proto = Class.prototype as Record<string, unknown>;
  const instances = new WeakMap<object, TypedEmitter<EventMap>>();

  const getInstance = (self: object): TypedEmitter<EventMap> => {
    if (!instances.has(self)) instances.set(self, new TypedEmitter<EventMap>());
    return instances.get(self)!;
  };

  proto['on'] = function(this: object, eventType: ListenableEvent<EventMap>, listener: Listener<unknown>, context?: unknown) {
    getInstance(this).on(eventType, listener as never, context);
    return this;
  };

  proto['once'] = function(this: object, eventType: ListenableEvent<EventMap>, listener: Listener<unknown>, context?: unknown) {
    getInstance(this).once(eventType, listener as never, context);
    return this;
  };

  proto['off'] = function(this: object, eventType: ListenableEvent<EventMap>, listener: Listener<unknown>) {
    getInstance(this).off(eventType, listener as never);
    return this;
  };

  proto['_emit'] = function(this: object, ...args: EmitArgs<EventMap>) {
    getInstance(this).emit(...args);
    return this;
  };

  proto['_emitAsync'] = function(this: object, ...args: EmitArgs<EventMap>) {
    return getInstance(this).emitAsync(...args);
  };

  proto['removeAllListeners'] = function(this: object, eventType?: ListenableEvent<EventMap>, context?: unknown) {
    getInstance(this).removeAllListeners(eventType, context);
    return this;
  };
}