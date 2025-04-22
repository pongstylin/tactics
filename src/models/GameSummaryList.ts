import ActiveModel from '#models/ActiveModel.js';
import GameSummary from '#models/GameSummary.js';
import serializer from '#utils/serializer.js';

export default class GameSummaryList extends ActiveModel {
  protected data: {
    id: string
    gamesSummary: Map<string, GameSummary>
  }

  constructor(data) {
    super();
    this.data = data;
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

  set(gameId, gameSummary) {
    const gamesSummary = this.data.gamesSummary;
    const oldSummary = gamesSummary.get(gameId);
    if (gameSummary.equals(oldSummary))
      return false;

    gamesSummary.set(gameId, gameSummary);
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
      type: 'change:prune',
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
    this.emit({
      type: 'change:delete',
      data: { gameId, oldSummary },
    });

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
