import ActiveModel from 'models/ActiveModel.js';
import GameSummary from 'models/GameSummary.js';
import serializer from 'utils/serializer.js';

export default class GameSummaryList extends ActiveModel {
  protected data: {
    playerId: string
    gamesSummary: Map<string, GameSummary>
  }

  constructor(data) {
    super();
    this.data = data;
  }

  static create(playerId) {
    return new GameSummaryList({
      playerId,
      gamesSummary: new Map(),
    });
  }

  get playerId() {
    return this.data.playerId;
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
    if (gamesSummary.has(gameId)) {
      const summaryA = JSON.stringify(gamesSummary.get(gameId));
      const summaryB = JSON.stringify(gameSummary);
      if (summaryA === summaryB)
        return false;
    }

    gamesSummary.set(gameId, gameSummary);
    this.emit('change:set');

    return true;
  }
  has(gameId) {
    return this.data.gamesSummary.has(gameId);
  }
  delete(gameId) {
    const gamesSummary = this.data.gamesSummary;
    if (!gamesSummary.has(gameId)) return false;

    this.data.gamesSummary.delete(gameId);
    this.emit('change:delete');

    return true;
  }
};

serializer.addType({
  name: 'GameSummaryList',
  constructor: GameSummaryList,
  schema: {
    type: 'object',
    required: [ 'playerId', 'gamesSummary' ],
    properties: {
      playerId: { type:[ 'string', 'null' ], format:'uuid' },
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
