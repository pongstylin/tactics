import EventEmitter from 'events';

// The theoretical max number of listeners is equal to the number of units that can co-exist on the board.
EventEmitter.defaultMaxListeners = 11 * 11 - 3 * 4;

const testWildcard = /[\*\?]/;
const instances = new WeakMap();
const getPrivateData = instance => {
  if (instances.has(instance))
    return instances.get(instance);

  const wildTypes = new Map();
  const emitter = new EventEmitter()
    .on('removeListener', (eventType, fn) => {
      if (wildTypes.has(eventType) && emitter.listenerCount(eventType) === 0)
        wildTypes.delete(eventType);
    })
    .on('newListener', (eventType, fn) => {
      if (testWildcard.test(eventType) && !wildTypes.has(eventType))
        wildTypes.set(
          eventType,
          new RegExp('^' +
            eventType
              .replace(/([^\w\*\?])/g, '\\$1')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '\\w+') +
          '$'),
        );
    });

  const instanceData = { emitter, wildTypes };
  instances.set(instance, instanceData);
  return instanceData;
};

const props = {
  on: {
    value() {
      getPrivateData(this).emitter.on(...arguments);
      return this;
    },
  },
  once: {
    value() {
      getPrivateData(this).emitter.once(...arguments);
      return this;
    },
  },
  off: {
    value() {
      if (arguments.length < 2)
        getPrivateData(this).emitter.removeAllListeners(...arguments);
      else
        getPrivateData(this).emitter.off(...arguments);
      return this;
    },
  },

  _emit: {
    value(event) {
      const { emitter, wildTypes } = getPrivateData(this);
      emitter.emit(event.type, event);

      for (const [ eventType, matcher ] of wildTypes) {
        if (matcher.test(event.type))
          emitter.emit(eventType, event);
      }
    },
  },
};

export default constructor => Object.defineProperties(constructor.prototype, props);
