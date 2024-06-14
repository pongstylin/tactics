import Transport from 'tactics/Transport.js';
import serializer from 'utils/serializer.js';

let counter = 0;

export default class LocalTransport extends Transport {
  /*
   * The default constructor is not intended for public use.
   */
  constructor() {
    const worker = new Worker('ww.min.js');
    worker.addEventListener('message', ({ data:message }) => this._onMessage(serializer.parse(message)));

    super({
      _worker:    worker,
      _resolvers: new Map(),
    });
  }

  /*
   * Constructors
   */
  static createGame(gameStateData) {
    let transport = new LocalTransport();
    transport._post({ type:'create', data:gameStateData });

    return transport;
  }

  /*
   * Proxy these methods to the worker game object.
   * Returns a promise that resolves to the method result, if any.
   */
  join() {
    return this._call('join', arguments);
  }
  restart() {
    super.restart();

    this._post({ type:'restart' });
  }

  getTurnData() {
    return this._call('getTurnData', arguments);
  }
  getTurnActions() {
    return this._call('getTurnActions', arguments);
  }
  submitAction() {
    return this._call('submitAction', arguments);
  }
  undo() {
    return this._call('undo', arguments);
  }

  /*
   * Private methods that send messages to the worker.
   */
  _call(method, args) {
    const resolvers = this._resolvers;
    const id = ++counter;

    this._post({
      type: 'call',
      // Convert arguments to a true Array.
      data: { id, method, args:Array.from(args) },
    });

    const promise = new Promise();
    resolvers.set(id, promise);

    return promise;
  }

  _post(message) {
    this._worker.postMessage(message);
    return this;
  }

  _onMessage(message) {
    const { type, data } = message;

    if (type === 'init')
      this._makeReady({ state:data });
    else if (type === 'sync')
      this._emit(data);
    else if (type === 'reply') {
      const resolvers = this._resolvers;

      const promise = resolvers.get(data.id);
      if (!promise)
        throw new Error('No such resolver id: '+data.id);

      resolvers.delete(data.id);
      promise.resolve(data.value);
    } else
      console.warn('Unhandled message', message);
  }
}
