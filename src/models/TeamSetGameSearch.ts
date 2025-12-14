import type GameSummary from '#models/GameSummary.js';
import type GameType from '#tactics/GameType.js';

type TeamSetGameSearchParams = {
  setId:string;
  vsSetId:string | null;
  result:'W' | 'L' | null;
};

const defaultParams = {
  vsSetId: null,
  result: null,
};

export default class TeamSetGameSearch implements Iterable<GameSummary> {
  public gameType:GameType;
  private _params:TeamSetGameSearchParams;
  private _cursor?:object;
  private _complete:boolean = false;
  private _gamesSummary:GameSummary[] = [];

  constructor(params:PickOptional<TeamSetGameSearchParams, 'setId', 'vsSetId' | 'result'>) {
    if (!params.setId) throw new Error(`Required setId`);

    this._params = Object.assign({}, defaultParams, params);
    this._cursor = undefined;
    this._gamesSummary = [];
  }

  get id() {
    return [ this.gameType.id, this._params.setId, this._params.vsSetId, this._params.result ].filter(p => p !== null).join(':');
  }
  get setId() {
    return this._params.setId;
  }
  get vsSetId() {
    return this._params.vsSetId;
  }
  get result() {
    return this._params.result;
  }
  get cursor() {
    return this._cursor;
  }
  get length() {
    return this._gamesSummary.length;
  }
  get isComplete() {
    return this._complete;
  }

  sortInIfIncluded(gameSummary:GameSummary) {
    if (!gameSummary.rating) return;
    if (!this.includes(gameSummary)) return;
    if (this._gamesSummary.someSorted(gs => gameSummary.rating! - gs.rating || gameSummary.id.localeCompare(gs.id))) return;
    if (!this._complete && this._gamesSummary.length === 0) return;
    if (!this._complete && this._gamesSummary.last!.rating! <= gameSummary.rating) return;

    this._gamesSummary.sortIn((a:GameSummary, b:GameSummary) => b.rating! - a.rating!, gameSummary);
  }
  includes(gameSummary:GameSummary) {
    const setIds = new Set(gameSummary.teams.map(t => t.set.id));
    if (!setIds.has(this._params.setId)) return false;

    if (this._params.vsSetId) {
      if (this._params.vsSetId === this._params.setId) {
        if (setIds.size !== 1) return false;
      } else {
        if (!setIds.has(this._params.vsSetId)) return false;

        if (this._params.result) {
          const team = gameSummary.teams.find(t => t.set.id === this._params.setId);
          const winnerId = this._params.result === 'W' ? team.id : (team.id + 1) % 2;
          if (gameSummary.winnerId !== winnerId)
            return false;
        }
      }
    }

    return true;
  }
  slice(...args:Parameters<Array<GameSummary>['slice']>) {
    return this._gamesSummary.slice(...args);
  }

  append(gamesSummary:GameSummary[], cursor?:object) {
    this._cursor = cursor;
    this._complete = !cursor;
    return this._gamesSummary.push(...gamesSummary);
  }

  // This method makes the class iterable
  *[Symbol.iterator](): IterableIterator<GameSummary> {
    for (const gameSummary of this._gamesSummary)
      yield gameSummary;
  }
};
