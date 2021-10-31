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

export default class ActiveModel {
  _emitter?: EventEmitter
  constructor(props: any) {
    this._emitter = new EventEmitter()
    Object.assign(this, props);
  }

  on(...args: RegEvtArgs) {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    this._emitter.addListener(...args);
    return this;
  }
  once(eventType: EventType, fn: EventCB) {
    const listener = () => {
      this.off(eventType, listener);
      fn();
    };

    this.on(eventType, listener);
  }
  off(...args: RegEvtArgs) {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    this._emitter.removeListener(...args);
    return this;
  }

  emit(event: any) {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    if (typeof event === 'string')
      event = { type:event };

    const parts = event.type.split(':');

    for (let i = 1; i <= parts.length; i++) {
      this._emitter.emit(parts.slice(0, i).join(':'), event);
    }
  }

  toJSON() {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    // Is there a better way to do this?
    const json: any = {};

    for (const [ key, value ] of Object.entries(this)) {
      if (key[0] === '_') continue;

      json[key] = value;
    }

    return json;
  }

  destroy() {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    this._emitter.removeAllListeners();
    delete this._emitter;
  }
}
