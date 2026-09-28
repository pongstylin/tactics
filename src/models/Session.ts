import ActiveModel, { type AbstractEvents } from '#models/ActiveModel.js';
import Cache from '#utils/Cache.js';

type SessionEvents = AbstractEvents & {
  'change:idle': { data:{ newValue:number, oldValue:number } },
  'change:connected': { data:{ newValue:boolean, oldValue:boolean } },
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
    lastActiveAt: Date,
    connected: boolean,
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
    return Math.floor((Date.now() - this.data.lastActiveAt.getTime()) / 1000);
  }
  set idle(idle) {
    this.lastActiveAt = new Date(Date.now() - idle * 1000);
  }
  get lastActiveAt() {
    return this.data.lastActiveAt;
  }
  set lastActiveAt(lastActiveAt) {
    const oldIdle = this.data.lastActiveAt ? this.idle : 0;
    if (lastActiveAt.getTime() === this.data.lastActiveAt?.getTime()) return;

    this.data.lastActiveAt = lastActiveAt;
    this.emit('change:idle', { data:{ newValue:this.idle, oldValue:oldIdle } });
  }
  get connected() {
    return this.data.connected;
  }
  set connected(connected) {
    const oldConnected = this.data.connected;
    if (connected === oldConnected) return;

    this.data.connected = connected;
    this.emit('change:connected', { data:{ newValue:connected, oldValue:oldConnected } });
  }

  close() {
    this.emit('close');
  }
};
