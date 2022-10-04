import sleep from 'utils/sleep.js';

/*
 * The primary purpose of extending and replacing native promises is so that we
 * can track when and where a promise was created for use in logging of any
 * rejections that aren't handled.  Since we're doing that, we also add deferred
 * action capabilities as well.  This simplifies ServerSocket client code that
 * defers authorization, joining groups, and other requested actions.
 *
 * This is only used on the client side.
 */
if (!self.Promise.isEnhanced) {
  const NativePromise = self.Promise;
  const nativeFetch = self.fetch;

  class EnhancedPromise extends NativePromise {
    constructor(fn, tags = {}) {
      const data = {
        value: undefined,
        bound: {},
        isResolved: false,
        isRejected: false,
        tags: Object.assign(tags, {
          createdAt: new Date(),
          createdStack: new Error().stack,
        }),
      };
      super((resolve, reject) => {
        data.resolver = resolve;
        data.rejector = reject;
      });

      data.bound.resolver = this.resolve.bind(this);
      data.bound.rejector = this.reject.bind(this);
      this._data = data;
      if (fn)
        fn(data.bound.resolver, data.bound.rejector);

      return this;
    }

    static wrap(nativePromise, tags) {
      return new EnhancedPromise(
        (resolve, reject) => nativePromise.then(resolve, reject),
        tags,
      );
    }
    static get isEnhanced() {
      return true;
    }

    tag(key, value) {
      this._data.tags[key] = value;
    }
    resolve(value) {
      const data = this._data;
      if (typeof value?.then === 'function')
        return value.then(data.bound.resolver, data.bound.rejector);

      data.isResolved = true;
      data.resolver(data.value = value);

      return value;
    }
    reject(value) {
      const data = this._data;

      data.tags.rejectedAt = new Date();
      data.tags.rejectedStack = new Error().stack;
      data.isRejected = true;
      data.rejector(data.value = value);

      return value;
    }

    get value() {
      return this._data.value;
    }
    get isPending() {
      return !this._data.isResolved && !this._data.isRejected;
    }
    get isResolved() {
      return this._data.isResolved;
    }
    get isRejected() {
      return this._data.isRejected;
    }
    get isFinalized() {
      return this._data.isResolved || this._data.isRejected;
    }
    get tags() {
      return this._data.tags;
    }
  }

  const enhancedFetch = function (resource, init) {
    const fetchInit = { ...init };
    delete fetchInit.retry;

    const startedAt = Date.now();

    return EnhancedPromise.wrap(
      nativeFetch(resource, init).catch(async error => {
        if (init.retry) {
          await sleep(1000 - (Date.now() - startedAt));
          return enhancedFetch(resource, init);
        }

        error.fileName = resource.toString();
        throw error;
      }),
      {
        resource,
        init,
        online: navigator.onLine,
      },
    );
  };

  self.NativePromise = NativePromise;
  self.Promise = EnhancedPromise;
  self.nativeFetch = nativeFetch;
  self.fetch = enhancedFetch;
}
