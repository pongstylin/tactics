import EventEmitter from 'events';

/*
 * An active model always has a unique identifier.
 * Two instances of an active model with the same ID must not exist.
 * Active models are cached by data adapters.
 * Data adapters listen for changes on active model instances.
 * When an active model is no longer needed, it must be destroyed.
 */
export default class ActiveModel {
  constructor(props) {
    Object.assign(this, {
      _emitter: new EventEmitter(),
    }, props);
  }

  on() {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    this._emitter.addListener(...arguments);
    return this;
  }
  once(eventType, fn) {
    const listener = () => {
      this.off(eventType, listener);
      fn();
    };

    this.on(eventType, listener);
  }
  off() {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    this._emitter.removeListener(...arguments);
    return this;
  }
  emit(event) {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    if (typeof event === 'string')
      event = { type:event };

    const parts = event.type.split(':');

    this._emitter.emit('event', event);
    for (let i = 1; i <= parts.length; i++) {
      this._emitter.emit(parts.slice(0, i).join(':'), event);
    }
  }

  toJSON() {
    if (!this._emitter)
      throw new Error('Active model is destroyed');

    const json = {};

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
