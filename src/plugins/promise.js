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
        isResolved: false,
        isRejected: false,
        isFinalized: false,
        tags: Object.assign(tags, {
          createdAt: new Date(),
          createdStack: new Error().stack,
        }),
      };
      super((resolve, reject) => {
        data.resolver = resolve;
        data.rejector = reject;
      });

      this._data = data;
      if (fn)
        fn(this.resolve.bind(this), this.reject.bind(this));

      return this;
    }

    static wrap(nativePromise, tags) {
      return new EnhancedPromise(
        (resolve, reject) => nativePromise.then(resolve).catch(reject),
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
      data.isResolved = data.isFinalized = true;
      data.value = value;
      data.resolver(value);
    }
    reject(value) {
      const data = this._data;
      data.tags.rejectedAt = new Date();
      data.tags.rejectedStack = new Error().stack;
      data.isRejected = data.isFinalized = true;
      data.value = value;
      data.rejector(value);
    }

    get value() {
      return this._data.value;
    }
    get isResolved() {
      return this._data.isResolved;
    }
    get isRejected() {
      return this._data.isRejected;
    }
    get isFinalized() {
      return this._data.isFinalized;
    }
    get tags() {
      return this._data.tags;
    }
  }

  const enhancedFetch = function (resource, init) {
    return EnhancedPromise.wrap(nativeFetch(resource, init), {
      resource,
      init,
      online: navigator.onLine,
    });
  };

  self.NativePromise = NativePromise;
  self.Promise = EnhancedPromise;
  self.nativeFetch = nativeFetch;
  self.fetch = enhancedFetch;
}
