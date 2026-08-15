import Cache from '#utils/Cache.js';
import { TypedEmitter } from '#utils/emitter.js';

/*
 * An active model always has a unique identifier.
 * Two instances of an active model with the same ID must not exist.
 * Data adapters listen for changes on active model instances.
 */

export type AbstractEvents = {
  'change': {},
  'sync': { event:object },
  'destroy': {},
};

type ModelSpecificEvents<ModelEvents extends { [K in keyof ModelEvents]: object }> =
  Omit<ModelEvents, keyof AbstractEvents>;

abstract class ActiveModel<ModelEvents extends { [K in keyof ModelEvents]: object } = {}> extends TypedEmitter<AbstractEvents & ModelSpecificEvents<ModelEvents>> {
  protected static _cache: Cache<any, ActiveModel<AbstractEvents>>

  protected abstract data: any;
  public isClean: boolean = true;
  public isPersisted: boolean = true;

  constructor(props:{
    isClean?: boolean;
    isPersisted?: boolean;
  } = {}) {
    super();

    Object.assign(this, props);
    (this as TypedEmitter<AbstractEvents>).on('change', () => {
      this.isClean = false;
    });
  }

  // This needs to be implemented in sub classes to expose the overridden types on the _cache property.
  static get cache() {
    return this._cache ??= new Cache('ActiveModel');
  }

  clean(force = false):object | true | false {
    if (!force && this.isClean)
      return false;

    return this.isClean = true;
  }

  protected emitBase(...args: Parameters<TypedEmitter<AbstractEvents>['emit']>): this {
    (this as TypedEmitter<AbstractEvents>).emit(...args);
    return this;
  }

  /*
   * Applies a remotely-observed change (e.g. from another app node, via Valkey pub/sub) to this
   * instance. Unlike a locally-triggered mutation, this must NOT emit 'change' - 'change' means
   * "something on THIS node just decided to persist/re-sync this," and re-emitting it here would
   * cause the update to be echoed back out to the cluster. `sync` is the corresponding signal for
   * "this instance's state just moved, for any reason" - things like GameSessionGame that exist
   * to keep a connected client in sync should listen for `sync`, not `change`.
   *
   * `sync()` itself is not meant to be overridden - it's what guarantees the 'sync' event always
   * fires regardless of what a subclass's mutation logic does. Override `_applySync()` instead to
   * customize how the incoming event is applied (e.g. GameSummaryList incrementally updating one
   * entry rather than replacing its whole data).
   */
  sync(event:object) {
    this._applySync(event);
    this.emitBase('sync', { event });
  }
  // Straight replacement, not a merge - works regardless of whether `data` is a plain object,
  // Set, Map, or Array, since it never inspects the existing value. Any event that only carries a
  // partial update needs its own override; the base class has no way to know which fields are
  // safe to leave untouched.
  protected _applySync(event:object) {
    this.data = (event as { data?:object }).data;
  }

  toJSON() {
    if (this.data instanceof Set)
      return [ ...this.data ];
    else if (this.data instanceof Map)
      return [ ...this.data ];
    else if (Array.isArray(this.data))
      return [ ...this.data ];
    return { ...this.data };
  }

  destroy() {
    this.emitBase('destroy');
  }
}

export default ActiveModel;
