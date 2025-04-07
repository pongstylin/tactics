import ActiveModel from '#models/ActiveModel.js';
import GameSummary from '#models/GameSummary.js';
import serializer from '#utils/serializer.js';

export default class GameSummaryList extends ActiveModel {
  protected data: {
    id: string
    gamesSummary: Map<string, GameSummary>
  }
  protected dirtyGamesSummary: Map<string, GameSummary>;

  constructor(data) {
    super();
    this.data = data;
    this.dirtyGamesSummary = new Map();
  }

  static create(id) {
    return new GameSummaryList({
      id,
      gamesSummary: new Map(),
    });
  }

  get id() {
    return this.data.id;
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

  set(gameId, gameSummary, force = false) {
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (!force && oldSummary) {
      const summaryA = JSON.stringify(oldSummary);
      const summaryB = JSON.stringify(gameSummary);
      if (summaryA === summaryB)
        return false;
    }

    gamesSummary.set(gameId, gameSummary);
    this.dirtyGamesSummary.set(gameId, gameSummary);
    this.emit({
      type: 'change:set',
      data: { gameId, gameSummary, oldSummary },
    });

    return true;
  }
  has(gameId) {
    return this.data.gamesSummary.has(gameId);
  }
  // Call this to prevent the cache size from growing too large
  prune(gameId) {
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (!oldSummary) return false;

    this.data.gamesSummary.delete(gameId);
    this.emit({
      type: 'change:delete',
      data: { gameId, oldSummary },
    });

    return true;
  }
  // Only called when the game is deleted
  delete(gameId) {
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (!oldSummary) return false;

    this.data.gamesSummary.delete(gameId);
    this.dirtyGamesSummary.delete(gameId);
    this.emit({
      type: 'change:delete',
      data: { gameId, oldSummary },
    });

    return true;
  }

  toNewValues(force) {
    if (!this.clean(force))
      return [];

    const values = Array.from(force ? this.data.gamesSummary.values() : this.dirtyGamesSummary.values());
    this.dirtyGamesSummary.clear();

    return values;
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
