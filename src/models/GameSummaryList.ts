import ActiveModel from 'models/ActiveModel';
import GameSummary from 'models/GameSummary';

export default class GameSummaryList extends ActiveModel {
  gamesSummary: Map<any, any>
  constructor(playerId, gamesSummary) {
    console.log("Games Summary:", gamesSummary)
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
    // @ts-ignore
    return this.gamesSummary.toJSON();
  }
}
