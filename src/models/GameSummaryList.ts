import ActiveModel, { type AbstractEvents } from '#models/ActiveModel.js';
import GameSummary from '#models/GameSummary.js';
// @ts-ignore
import serializer from '#utils/serializer.js';
import Cache from '#utils/Cache.js';

type GameSummaryListEvents = AbstractEvents & {
  'change:set': { data:{ gameId:string, gameSummary:GameSummary, oldSummary:GameSummary | undefined } },
  'change:prune': { data:{ gameId:string, oldSummary:GameSummary } },
  'change:delete': { data:{ gameId:string, oldSummary:GameSummary } },
};

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
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (oldSummary && gameSummary.equals(oldSummary))
      return false;

    gamesSummary.set(gameId, gameSummary);
    this.emit('change:set', { data: { gameId, gameSummary, oldSummary } });

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
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (!oldSummary) return false;

    this.data.gamesSummary.delete(gameId);
    this.emit('change:prune', { data: { gameId, oldSummary } });

    return true;
  }
  // Only called when the game is deleted
  delete(gameId:string) {
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (!oldSummary) return false;

    this.data.gamesSummary.delete(gameId);
    this.emit('change:delete', { data:{ gameId, oldSummary } });

    return true;
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
