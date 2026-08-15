import ActiveModel from '#models/ActiveModel.js';
import GameSummary from '#models/GameSummary.js';
// @ts-ignore
import serializer from '#utils/serializer.js';
import Cache from '#utils/Cache.js';

type GameSummaryListEvents = {
  'change:set': { data:{ gameId:string, gameSummary:GameSummary, oldSummary:GameSummary | undefined } },
  'change:prune': { data:{ gameId:string, oldSummary:GameSummary } },
  'change:delete': { data:{ gameId:string, oldSummary:GameSummary } },
};

// What gets shipped over the wire for a remote node to replay - a single-entry delta, not the
// whole `gamesSummary` Map. This is why GameSummaryList needs its own _applySync at all: unlike
// the DDB-backed point-item models, nothing else already ships full state for it.
type GameSummaryListSyncEvent =
  | { op:'set', gameId:string, gameSummary:GameSummary }
  | { op:'prune', gameId:string }
  | { op:'delete', gameId:string };

export default class GameSummaryList extends ActiveModel<GameSummaryListEvents> {
  protected static _cache: Cache<string, GameSummaryList>

  protected data: {
    id: string
    gamesSummary: Map<string, GameSummary>
  }

  constructor(data:GameSummaryList['data']) {
    super();
    this.data = data;
  }

  static get cache() {
    return this._cache ??= new Cache('GameSummaryList');
  }
  static create(id:string) {
    return new GameSummaryList({
      id,
      gamesSummary: new Map(),
    });
  }

  get id() {
    return this.data.id;
  }
  get groupId() {
    if (this.data.id.startsWith('playerGames#'))
      return `/myGames/${this.data.id.split('#')[1]}`;
    return `/collection/${this.data.id}`;
  }
  get size() {
    return this.data.gamesSummary.size;
  }

  keys() {
    return this.data.gamesSummary.keys();
  }
  values() {
    return this.data.gamesSummary.values();
  }
  entries() {
    return this.data.gamesSummary.entries();
  }

  set(gameId:string, gameSummary:GameSummary) {
    const result = this._applySet(gameId, gameSummary);
    if (!result) return false;

    this.emit('change:set', { data: { gameId, gameSummary, oldSummary:result.oldSummary } });
    return true;
  }
  has(gameId:string) {
    return this.data.gamesSummary.has(gameId);
  }
  find(fn:(gs:GameSummary) => GameSummary | undefined) {
    return Array.from(this.data.gamesSummary.values()).find(fn);
  }
  // Call this to prevent the cache size from growing too large
  prune(gameId:string) {
    const result = this._applyRemove(gameId);
    if (!result) return false;

    this.emit('change:prune', { data: { gameId, oldSummary:result.oldSummary } });
    return true;
  }
  // Only called when the game is deleted
  delete(gameId:string) {
    const result = this._applyRemove(gameId);
    if (!result) return false;

    this.emit('change:delete', { data:{ gameId, oldSummary:result.oldSummary } });
    return true;
  }

  /*
   * Applies a remotely-observed single-entry delta (see GameSummaryListSyncEvent) without
   * re-emitting the local change:* events - those exist for locally-triggered mutations only
   * (see set()/prune()/delete() above), and re-emitting them here would incorrectly re-trigger
   * whatever those cascade to (isClean tracking, persistence sync, etc.) for an update that
   * didn't actually originate on this node. ActiveModel.sync() still unconditionally emits the
   * generic 'sync' event after this runs, which is what client-facing listeners should use.
   */
  protected _applySync(event:GameSummaryListSyncEvent) {
    switch (event.op) {
      case 'set': this._applySet(event.gameId, event.gameSummary); break;
      case 'prune':
      case 'delete': this._applyRemove(event.gameId); break;
    }
  }
  private _applySet(gameId:string, gameSummary:GameSummary) {
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (oldSummary && gameSummary.equals(oldSummary))
      return null;

    gamesSummary.set(gameId, gameSummary);
    return { oldSummary };
  }
  private _applyRemove(gameId:string) {
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (!oldSummary) return null;

    gamesSummary.delete(gameId);
    return { oldSummary };
  }
};

serializer.addType({
  name: 'GameSummaryList',
  constructor: GameSummaryList,
  schema: {
    type: 'object',
    required: [ 'id', 'gamesSummary' ],
    properties: {
      id: { type:'string' },
      gamesSummary: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string', format:'uuid' },
            { $ref:'GameSummary' },
          ],
          additionalItems: false,
        },
      },
    },
    additionalProperties: false,
  },
});
