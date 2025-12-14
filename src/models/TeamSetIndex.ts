import TeamSet from '#models/TeamSet.js';
import type TeamSetCardinality from '#models/TeamSetCardinality.js';
import type TeamSetSearch from '#models/TeamSetSearch.js';

export default class TeamSetIndex implements Iterable<TeamSet> {
  public cardinality:TeamSetCardinality;
  public teamSetSearches:WeakSet<TeamSetSearch>;
  private _metricName:string;
  private _indexPath:string;
  private _cursor?:object;
  private _complete:boolean = false;
  private _teamSets:TeamSet[];

  constructor(metricName:string, indexPath:string) {
    this.teamSetSearches = new WeakSet();
    this._metricName = metricName;
    this._indexPath = indexPath;
    this._cursor = undefined;
    this._teamSets = [];
  }

  get id() {
    return `${this.cardinality.gameType.id}/${this._metricName}${this._indexPath}`;
  }
  get gameTypeId() {
    return this.cardinality.gameType.id;
  }
  get metricName() {
    return this._metricName;
  }
  get path() {
    return this._indexPath;
  }
  get cursor() {
    return this._cursor;
  }
  get length() {
    return this._teamSets.length;
  }
  get isComplete() {
    return this._complete;
  }

  slice(...args:Parameters<Array<TeamSet>['slice']>) {
    return this._teamSets.slice(...args);
  }

  sortIn(teamSet:TeamSet) {
    const oldIndex = this._teamSets.findIndex(ts => ts.id === teamSet.id);
    if (oldIndex > -1)
      this._teamSets.splice(oldIndex, 1);

    const sortValue = teamSet[this._metricName];
    const newIndex = this._teamSets.findSortIndex(ts => sortValue - ts[this._metricName]);
    if (newIndex < this._teamSets.length || this._teamSets.length < 1000)
      this._teamSets.splice(newIndex, 0, teamSet);
  }

  append(teamSets:TeamSet[], cursor?:object) {
    this._cursor = cursor;
    this._complete = !cursor;
    return this._teamSets.push(...teamSets);
  }

  // This method makes the class iterable
  *[Symbol.iterator](): IterableIterator<TeamSet> {
    for (const teamSet of this._teamSets)
      yield teamSet;
  }
};
