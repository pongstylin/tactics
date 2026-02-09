import Cache from '#utils/Cache.js';
import { TypedEmitter } from '#utils/emitter.js';

/*
 * An active model always has a unique identifier.
 * Two instances of an active model with the same ID must not exist.
 * Data adapters listen for changes on active model instances.
 */

export type AbstractEvents = {
  'change': {},
  'destroy': {},
};

abstract class ActiveModel<ModelEvents extends AbstractEvents & Record<string, object> = AbstractEvents> extends TypedEmitter<ModelEvents> {
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

  // This needs to be copied to sub classes to expose the overridden types on the _cache property.
  static get cache() {
    return this._cache ??= new Cache();
  }

  clean(force = false):object | true | false {
    if (!force && this.isClean)
      return false;

    return this.isClean = true;
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
    this.emit('destroy');
  }
}

export default ActiveModel;
