import { ReParse } from 'reparse';
import TeamSet from '#models/TeamSet.js';
import type TeamSetCardinality from '#models/TeamSetCardinality.js';
import { Index } from '#models/TeamSetCardinality.js';
import { defaultStats } from '#models/TeamSetStats.js';
import emitter from '#utils/emitter.js';

type GrammarValue = (
  { type:'token',       count?:number, tokens:string[] } |
  { type:'quotedToken', count?:number, token:string    } |
  { type:'groups',      groups:string[][]              }
);

type TeamSetIndexPage = { truncated:boolean, completed:boolean, teamSets:TeamSet[] };

const aliasMap = new Map<string, GrammarValue>([
  [ 'warded', { type:'groups', groups:[ [ 'lw' ], [ 'bw' ] ] } ],
  [ 'double\\s+warded', { type:'groups', groups:[ [ 'lw', 'bw' ] ] } ],
]);

export const grammar = {
  values() {
    const values = this.many(grammar.value) as GrammarValue[];

    // Combine consecutive tokens into a single token list so they can be evaluated together
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value.type !== 'token' || (value.tokens as any).last.endsWith('less')) continue;
      for (let j = i + 1; j < values.length; j) {
        const nextValue = values[j];
        if (nextValue.type !== 'token' || nextValue.count !== undefined) break;
        value.tokens.push(...nextValue.tokens);
        values.splice(j, 1);
      }
    }

    // Split value list into groups by the or operator
    const valueOrGroups:GrammarValue[][] = [];
    while (values.length) {
      const indexOfOr = values.findIndex(v => v['operator'] === 'or');
      if (indexOfOr === -1) {
        valueOrGroups.push(values);
        break;
      }
      valueOrGroups.push(values.splice(0, indexOfOr));
      values.shift();
    }

    // Transform to a list of search groups
    const groups = valueOrGroups.map(values => values.filter(v => v['operator'] !== 'and').reduce<string[][]>((ss, value) => {
      switch (value.type) {
        case 'token':
          if (ss.length === 0) ss.push([]);
          // Add this token to all groups
          return ss.map(s => s.concat((value.count === undefined ? value.tokens : [ value.count.toString(), ...value.tokens ]).join(' ')));
        case 'quotedToken':
          if (ss.length === 0) ss.push([]);
          // Add this token to all groups
          return ss.map(s => s.concat((value.count === undefined ? [ value.token ] : [ value.count.toString(), value.token ]).join(' ')));
        case 'groups':
          // No groups yet?  These group will kick us off.
          if (ss.length === 0) return value.groups;

          // A sub search must generate a delta with every search
          return ss.map(s1 => value.groups.map(s2 => s1.concat(s2) )).flat();
      }
    }, [])).flat();

    return groups;
  },
  value() {
    return this.choice(grammar.aliasToken, grammar.count, grammar.operator, grammar.token, grammar.quotedToken, grammar.parenthetical);
  },
  count() {
    const choice = this.choice(/^triple/, /^double/, /^single/, /^no/, /^\d+/);
    const count = choice === 'no' ? 0 : choice === 'single' ? 1 : choice === 'double' ? 2 : choice === 'triple' ? 3 : parseInt(choice);
    this.match(/^\s*/);
    const token = this.choice(grammar.token, grammar.quotedToken);
    return Object.assign(token, { count });
  },
  operator() {
    return { type:'operator', operator:this.match(/^(?:or|and)/i).toLowerCase() };
  },
  token() {
    return { type:'token', tokens:[ this.match(/^\w+/) ] };
  },
  aliasToken() {
    for (const [ alias, value ] of aliasMap)
      if (this.option(new RegExp(`^${alias}`), null))
        return value;
    this.fail();
  },
  quotedToken() {
    return { type:'quotedToken', token:[ this.match(/^"([^"]+)"/).split(/\s+/).join(' ') ] };
  },
  parenthetical() {
    return { type:'groups', groups:this.between(/^\(/, /^\)/, grammar.values) };
  },
};
const filterCache = new Map<string, WeakMap<object, Set<string>>>();

export default class TeamSetSearch {
  private _cardinality:TeamSetCardinality;
  private _metricName:string;
  private _query:string[];
  private _filters:string[];
  private _index:Index;
  private _teamSets:TeamSet[] | null = null;
  private _truncated:boolean = false;
  private _completed:boolean = false;
  private _numUnfiltered:number = 0;

  constructor(cardinality:TeamSetCardinality, metricName:string, query:string[]) {
    this._cardinality = cardinality;
    this._metricName = metricName;
    this._query = query;
    this._filters = Array.from(new Set(this._cardinality.getFiltersFromQuery(query)));
    this._index = this._cardinality.selectIndex(this._filters);
    this._filters = this._filters.filter(f => f !== this._index.path);
  }

  static parseText(text:string) {
    const groups = new ReParse(text, true).start(grammar.values);
    if (groups.length === 0) return [[]];

    for (const group of groups)
      Array.from(new Set(group)).sort();
    groups.sort((a,b) => a.join(' ').localeCompare(b.join(' ')));
    return groups;
  }

  get id() {
    return `${this._cardinality.gameType.id}/${this._metricName}/${JSON.stringify(this._query)}`;
  }
  get indexPath() {
    return this._index.path;
  }
  get truncated() {
    return this._truncated;
  }
  get completed() {
    return this._completed;
  }
  get count() {
    if (this._completed && this._index.count !== this._numUnfiltered) {
      console.warn(`Warning: compensating for inaccurate index count: ${this._index.count} !== ${this._numUnfiltered} (${this._cardinality.gameType!.id}${this._index.path})`);
      return this.numFiltered;
    }
    // Fuzzy counts exclude discarded team sets from the index count
    return this._index.count - this._numUnfiltered + this.numFiltered;
  }
  get numFiltered() {
    return this._teamSets?.length ?? 0;
  }

  async getResults(offset:number = 0, limit:number = 20) {
    if (!this._truncated && !this._completed && (offset + limit) > this.numFiltered)
      await this.getTeamSet(offset + limit);

    return this._teamSets!.slice(offset, offset + limit);
  }
  getTotal(offset:number = 0, limit:number = 20) {
    return {
      truncated: this._truncated && (offset + limit) > this.numFiltered,
      fuzzy: !this._completed && this._filters.length,
      count: this.count,
    };
  }
  // Only expected to be called when this search is complete
  getAllTeamSets(offset:number = 0) {
    return this._teamSets?.slice(offset) ?? [];
  }
  async getTeamSet(offset:number) {
    if (this._teamSets === null) {
      const page = await new Promise<TeamSetIndexPage>((resolve, reject) => {
        (this as any)._emit({ type:'getTeamSetIndexCurrentPage', indexPath:this._index.path, resolve, reject });
      });
      this._teamSets = [];
      this._applyTeamSetIndexPage(page);
    }

    while (!this._completed && !this._truncated && offset >= this.numFiltered) {
      const page = await new Promise<TeamSetIndexPage>((resolve, reject) => {
        (this as any)._emit({ type:'getTeamSetIndexNextPage', indexPath:this._index.path, resolve, reject });
      });
      this._applyTeamSetIndexPage(page);
    }

    return this._teamSets![offset] ?? null;
  }

  _applyTeamSetIndexPage(page:TeamSetIndexPage) {
    // Include unindexed predefined sets
    if (page.completed)
      for (const set of this._cardinality.gameType.config.sets)
        if (!this._teamSets!.concat(page.teamSets).some(ts => ts.id === set.id)) {
          const teamSet = TeamSet.create({ units:set.units, [this._metricName]:defaultStats[this._metricName] }, set.id);
          teamSet.cardinality = this._cardinality;
          page.teamSets.push(teamSet);
        }

    this._completed = page.completed;
    this._truncated = page.truncated;
    this._numUnfiltered += page.teamSets.length;

    const teamSets = this._filters.length === 0 ? page.teamSets : page.teamSets.filter(ts => {
      const teamSetFilters = this._getTeamSetFilters(ts);
      return this._filters.every(f => teamSetFilters.has(f));
    });
    if (teamSets.length)
      this._teamSets!.push(...teamSets);
  }
  _getTeamSetFilters(teamSet:TeamSet) {
    if (!this._cardinality || !this._cardinality.gameType)
      throw new Error(`Required cardinality game type`);

    const cache = filterCache.get(this._cardinality.gameType.id) ?? new WeakMap();
    filterCache.set(this._cardinality.gameType.id, cache);

    if (!cache.has(teamSet))
      cache.set(teamSet, new Set(this._cardinality.getIndexPaths(teamSet, true)));
    return cache.get(teamSet)!;
  }
}

export class TeamSetSearchGroup {
  private _cardinality:TeamSetCardinality;
  private _metricName:'rating' | 'gameCount' | 'playerCount';
  private _query:string[][];
  private _groups:TeamSetSearch[];
  private _groupOffsets:number[];
  private _teamSets:TeamSet[];
  private _truncated:boolean = false;
  private _completed:boolean = false;
  private _numUnfiltered:number = 0;

  constructor(cardinality:TeamSetCardinality, metricName:'rating' | 'gameCount' | 'playerCount', query:string[][], groups:TeamSetSearch[]) {
    this._cardinality = cardinality;
    this._metricName = metricName;
    this._query = query;
    this._groups = groups;
    this._groupOffsets = new Array(groups.length).fill(0);
    this._teamSets = [];

    return this;
  }

  get id() {
    return `${this._cardinality.gameType.id}/${this._metricName}/${JSON.stringify(this._query)}`;
  }
  get count() {
    return this._groups.reduce((sum, g) => sum + g.getTotal(0, 0).count, 0) - this._numUnfiltered + this.numFiltered;
  }
  get numFiltered() {
    return this._teamSets.length;
  }

  async getResults(offset:number = 0, limit:number = 20) {
    if (!this._completed && !this._truncated && (offset + limit) > this.numFiltered)
      await this._getTeamSets(offset + limit);

    return this._teamSets.slice(offset, offset + limit);
  }
  getTotal(offset:number = 0, limit:number = 20) {
    return {
      truncated: this._truncated && (offset + limit) > this.numFiltered,
      fuzzy: !this._completed,
      count: this.count,
    };
  }

  async _getTeamSets(offset:number) {
    while (!this._truncated && !this._completed && offset >= this.numFiltered) {
      const next = (
        await Promise.all(this._groups.map(async (g, gi) => ({ gi, teamSet:await g.getTeamSet(this._groupOffsets[gi]) })))
      ).filter(n => !!n.teamSet).sort((a,b) => b.teamSet[this._metricName] - a.teamSet[this._metricName])[0];
      this._truncated = this._groups.some((g, gi) => g.truncated && g.numFiltered === this._groupOffsets[gi]);
      this._completed = this._groups.every(g => g.completed);

      if (this._completed) {
        // Sort and deduplicate the remaining results so that we have an accurate count
        const teamSets = this._groups.map((g, gi) => g.getAllTeamSets(this._groupOffsets[gi])).flat().sort((a,b) => b[this._metricName] - a[this._metricName]);
        this._numUnfiltered += teamSets.length;
        for (const teamSet of teamSets)
          if (this._teamSets.findIndex(ts => ts.id === teamSet.id) === -1)
            this._teamSets.push(teamSet);
      } else if (!this._truncated) {
        this._numUnfiltered++;
        if (this._teamSets.findIndex(ts => ts.id === next.teamSet.id) === -1)
          this._teamSets.push(next.teamSet);
        this._groupOffsets[next.gi]++;
      }
    }
  }
};

emitter(TeamSetSearch);
emitter(TeamSetSearchGroup);
