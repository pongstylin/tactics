import ActiveModel from '#models/ActiveModel.js';
import type TeamSet from '#models/TeamSet.js';
import ServerError from '#server/Error.js';
import GameType from '#tactics/GameType.js';
import serializer from '#utils/serializer.js';

export type Index = { path:string, count:number, disabled:boolean };

export default class TeamSetCardinality extends ActiveModel {
  public indexes: Map<string, Index>;

  private _gameType:GameType;

  protected data: {
    id: string;
    indexes: Index[];
  };

  constructor(data, props?:ConstructorParameters<typeof ActiveModel>[0]) {
    super(props);

    data.indexes ??= [{ path:'/', count:0, disabled:false }];
    for (const index of data.indexes) {
      index.count ??= 0;
      index.disabled ??= false;
    }

    Object.assign(this, {
      data,
      indexes: new Map(data.indexes.map(i => [ i.path, i ])),
    });
  }

  static create(gameTypeId:string) {
    return new TeamSetCardinality({
      id: gameTypeId,
    }, { isClean:false, isPersisted:false });
  }

  get id() {
    return this.data.id;
  }
  get gameType() {
    return this._gameType;
  }
  set gameType(value:GameType) {
    if (this._gameType)
      throw new Error(`Game type was set more than once.`);
    this._gameType = value;
  }

  /*
   * All terms in the search text must match a tag keyword.
   *
   * Matching is case insensitive and half space-insensitive.
   * Example:
   *   'text=offcenter' will match 'keyword=off center'
   *   'text=off center' will not match 'keyword=offcenter'
   */
  getFiltersFromQuery(query:string[]) {
    if (!this._gameType)
      throw new Error(`Game type is required`);

    const filters:string[] = [];
    const tagByKeyword = this._gameType.tagByKeyword;

    for (const q of query) {
      const terms = q.split(/\s+/);

      for (let i = 0; i < terms.length; i++) {
        const predicate = {} as { term:string, count?:number };
        const termIsCount = /^\d+$/.test(terms[i]);
        if (termIsCount) {
          predicate.count = Number(terms[i]);
          i++;
        }

        const parts = terms[i].toLowerCase().split(/(?<=\d)(?=\D)|(?=less\b)/);
        if (parts.length === 1)
          predicate.term = terms[i];
        else if (parts.length === 2) {
          if (parts[1] === 'less') {
            if ('count' in predicate)
              throw new ServerError(412, `Unrecognized term "${terms[i - 1]} ${terms[i]}"`);
            predicate.term = parts[0];
            predicate.count = 0;
          } else if (Number.isInteger(Number(parts[0]))) {
            if ('count' in predicate)
              throw new ServerError(412, `Unrecognized term "${terms[i - 1]} ${terms[i]}"`);
            predicate.count = Number(parts[0]);
            predicate.term = parts[1];
          } else
            throw new ServerError(412, `Unrecognized term "${terms[i]}"`);
        } else
          throw new ServerError(412, `Unrecognized term "${terms[i]}"`);

        let indexPath = null as string | null;

        for (let j = terms.length; j >= i; j--) {
          const keyword = [ predicate.term, ...terms.slice(i + 1, j) ].join(' ');
          if (tagByKeyword.has(keyword)) {
            i = j - 1;
            const tag = tagByKeyword.get(keyword)!;
            indexPath = `/${tag.type}/${tag.name}` + (tag.type !== 'unit' || predicate.count === undefined ? '' : `/${predicate.count}`);
            break;
          }
        }

        if (indexPath === null)
          throw new ServerError(412, `Unrecognized term "${predicate.term}"`);

        filters.push(indexPath);
      }
    }

    return Array.from(new Set(filters));
  }
  /*
   * Get all the indexes associated with a set's stats.
   * This is used to increment cardinality counts and index set stats.
   */
  getIndexPaths(teamSet:TeamSet, includeDisabled = false) {
    if (!this.gameType)
      throw new Error(`Game type is required`);

    const tags = teamSet.tags;
    const allIndexPaths:string[] = [ '/' ];

    for (const tag of tags) {
      const indexPaths:string[] = [];
      if (tag.type !== 'unit' || tag.count === undefined || tag.count > 0)
        indexPaths.push(`/${tag.type}/${tag.name}`);
      if (tag.count !== undefined)
        indexPaths.push(`/${tag.type}/${tag.name}/${tag.count}`);

      for (const indexPath of indexPaths) {
        // Disable new indexes automatically since a parent index might be sufficient.
        if (!this.indexes.has(indexPath))
          this.indexes.set(indexPath, { path:indexPath, count:0, disabled:true });
        if (includeDisabled || !this.indexes.get(indexPath)!.disabled)
          allIndexPaths.push(indexPath);
      }
    }

    return allIndexPaths;
  }

  applySet(teamSet:TeamSet) {
    for (const indexPath of this.getIndexPaths(teamSet, true))
      this.indexes.get(indexPath)!.count++;
    this.emit('change:applySet');
  }
  /*
   * This is not triggered automatically because using it requires a reindex.
   */
  optimize() {
    const rootIndex = this.indexes.get('/')!;

    // Optimize parents before children
    const indexes = Array.from(this.indexes.values()).sort((a,b) => a.path.length - b.path.length);
    for (const index of indexes) {
      if (index === rootIndex) continue;

      // Might be grandparent if parent is disabled.
      const parentIndex = this._getIndexesInPath(index.path).slice(1).filter(i => !i.disabled)[0] ?? rootIndex;
      index.disabled = index.count > (parentIndex.count * 2/3);
    }

    this.emit('change:optimize');
  }

  selectIndex(filters:string[]) {
    if (!this._gameType)
      throw new Error(`Game type is required`);
    if (filters.length === 0)
      return this.indexes.get('/')!;

    const localTagByPath = this._gameType.localTagByPath;
    const localIndexes = filters.filter(f => localTagByPath.has(f)).map(f => ({
      path: f,
      count: localTagByPath.get(f)!.sets.length,
      disabled: false,
      sets: localTagByPath.get(f)!.sets,
    })).sort((a,b) => a.count - b.count);
    if (localIndexes.length)
      return localIndexes[0];

    return filters.map(f => this._getIndexesInPath(f).filter(i => !i.disabled)).flat().sort((a,b) => a.count - b.count)[0];
  }

  _getIndexesInPath(path:string) {
    // Avoid duplicated index
    if (path === '/')
      return [ this.indexes.get('/')! ];

    const parts = path.split(/\//g);
    const indexes:Index[] = [];
    for (let i = parts.length; i > 0; i--) {
      const path = parts.slice(0, i).join('/') || '/';
      if (this.indexes.has(path))
        indexes.push(this.indexes.get(path)!);
      // Zero unit indexes don't have parent indexes.
      if (parts[1] === 'unit' && parts[3] === '0')
        break;
    }

    return indexes;
  }

  toJSON() {
    const json = super.toJSON();
    // Just in case any indexes were added.
    json.indexes = Array.from(this.indexes.values());

    return json;
  }
};

serializer.addType({
  name: 'TeamSetCardinality',
  constructor: TeamSetCardinality,
  schema: {
    type: 'object',
    required: [ 'id' ],
    properties: {
      id: { type:'string' },
    },
    additionalProperties: false,
  },
});