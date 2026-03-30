import ActiveModel, { type AbstractEvents } from '#models/ActiveModel.js';
import Cache from '#utils/Cache.js';

type SessionEvents = AbstractEvents & {
  'change:idle': { data:{ newValue:number, oldValue:number } },
  'close': {},
};

export default class Session extends ActiveModel<SessionEvents> {
  protected static _cache: Cache<string, Session>;

  protected data: {
    id: string,
    clientMessageId: number,
    serverMessageId: number,
    lastSentMessageId: number,
    outbox: [],
    client: any,
    idle: number,
  };

  constructor(data:Session['data']) {
    super();
    this.data = data;
    return this;
  }

  static get cache() {
    return this._cache ??= new Cache('Session', { ttl:null });
  }
  static create(data:Session['data']) {
    return this.cache.set(data.id, new Session(data));
  }

  get id() {
    return this.data.id;
  }
  get clientMessageId() {
    return this.data.clientMessageId;
  }
  set clientMessageId(clientMessageId) {
    this.data.clientMessageId = clientMessageId;
  }
  get serverMessageId() {
    return this.data.serverMessageId;
  }
  set serverMessageId(serverMessageId) {
    this.data.serverMessageId = serverMessageId;
  }
  get lastSentMessageId() {
    return this.data.lastSentMessageId;
  }
  set lastSentMessageId(lastSentMessageId) {
    this.data.lastSentMessageId = lastSentMessageId;
  }
  get outbox() {
    return this.data.outbox;
  }
  get client() {
    return this.data.client;
  }
  set client(client) {
    this.data.client = client;
  }
  get idle() {
    return this.data.idle;
  }
  set idle(idle) {
    const oldIdle = this.data.idle;
    if (idle === oldIdle) return;

    this.data.idle = idle;
    this.emit('change:idle', { data:{ newValue:idle, oldValue:oldIdle } });
  }

  close() {
    this.emit('close');
  }
};
