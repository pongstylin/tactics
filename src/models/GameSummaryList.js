import ActiveModel from 'models/ActiveModel.js';
import GameSummary from 'models/GameSummary.js';

export default class GameSummaryList extends ActiveModel {
  constructor(playerId, gamesSummary) {
    super({
      playerId,
      gamesSummary,
    });
  }

  static load(playerId, data) {
    const gamesSummary = new Map();

    for (const [ gameId, gameSummaryData ] of data) {
      gamesSummary.set(gameId, GameSummary.load(gameSummaryData));
    }

    return new GameSummaryList(playerId, gamesSummary);
  }

  get size() {
    return this.gamesSummary.size;
  }
  keys() {
    return this.gamesSummary.keys();
  }
  values() {
    return this.gamesSummary.values();
  }
  entries() {
    return this.gamesSummary.entries();
  }

  set(gameId, gameSummary) {
    const gamesSummary = this.gamesSummary;
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
    return this.gamesSummary.has(gameId);
  }
  delete(gameId) {
    const gamesSummary = this.gamesSummary;
    if (!gamesSummary.has(gameId)) return false;

    this.gamesSummary.delete(gameId);
    this.emit('change:delete');

    return true;
  }

  toJSON() {
    return this.gamesSummary.toJSON();
  }
}
