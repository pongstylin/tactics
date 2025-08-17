import EventEmitter from 'events';

/*
 * An active model always has a unique identifier.
 * Two instances of an active model with the same ID must not exist.
 * Active models are cached by data adapters.
 * Data adapters listen for changes on active model instances.
 * When an active model is no longer needed, it must be destroyed.
 */

type EventType = string | symbol
type EventCB = (...args: any[]) => void
type RegEvtArgs = [EventType, EventCB]

abstract class ActiveModel {
  protected abstract data: any
  private emitter: EventEmitter | null
  public isClean: boolean = true
  public isPersisted: boolean = true

  constructor(props:{
    isClean?: boolean;
    isPersisted?: boolean;
  } = {}) {
    Object.assign(this, {
      emitter: new EventEmitter(),
    }, props);
  }

  clean(force = false) {
    if (!force && this.isClean)
      return false;

    return this.isClean = true;
  }

  on(...args: RegEvtArgs) {
    if (!this.emitter)
      throw new Error('Active model is destroyed');

    this.emitter.addListener(...args);
    return this;
  }
  once(eventType: EventType, fn: EventCB) {
    const listener = event => {
      this.off(eventType, listener);
      fn(event);
    };

    this.on(eventType, listener);
  }
  off(...args: RegEvtArgs) {
    if (!this.emitter)
      throw new Error('Active model is destroyed');

    this.emitter.removeListener(...args);
    return this;
  }

  emit(event: any) {
    if (!this.emitter)
      throw new Error('Active model is destroyed');

    if (typeof event === 'string')
      event = { type:event };

    // Get a local ref to the emitter just in case one of the listeners destroys this model.
    const emitter = this.emitter;
    const parts = event.type.split(':');

    if (parts[0] === 'change')
      this.isClean = false;

    for (let i = 1; i <= parts.length; i++)
      emitter.emit(parts.slice(0, i).join(':'), event);
  }

  toJSON() {
    if (!this.emitter)
      throw new Error('Active model is destroyed');

    if (this.data instanceof Set)
      return [ ...this.data ];
    else if (this.data instanceof Map)
      return [ ...this.data ];
    else if (Array.isArray(this.data))
      return [ ...this.data ];
    return { ...this.data };
  }

  destroy() {
    if (!this.emitter)
      throw new Error('Active model is destroyed');

    this.emitter.removeAllListeners();
    this.emitter = null;
  }
}

export default ActiveModel;
