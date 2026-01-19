import objectHash from 'object-hash';

import ActiveModel from '#models/ActiveModel.js';
import type Game from '#models/Game.js';
import type Team from '#models/Team.js';
import type TeamSetCardinality from '#models/TeamSetCardinality.js';
import type TeamSetStats from '#models/TeamSetStats.js';
import type GameType from '#tactics/GameType.js';
import unitDataMap, { unitTypeByCode } from '#tactics/unitData.js';
import { computeElo } from '#utils/elo.js';
import serializer from '#utils/serializer.js';

export type TeamSetUnit = {
  type: string;
  assignment: [ number, number ];
  direction?: 'N' | 'E' | 'S' | 'W';
};
export type TeamSetData = {
  units: TeamSetUnit[];
  // TeamSets built from index data will load one of these values in absence of the full stats.
  rating?: number;
  gameCount?: number;
  playerCount?: number;
};

export default class TeamSet extends ActiveModel {
  private _id: string;
  private _name: ReturnType<TeamSet['_generateName']> | null = null;
  private _tags: ReturnType<GameType['getTeamSetTags']> | null = null;
  private _indexPaths: Set<ReturnType<TeamSetCardinality['getIndexPaths']>[number]> | null = null;
  private _stats: TeamSetStats | null = null;
  // cardinality and gameType is assumed to never be null because they should be set immediately after an object is created.
  public cardinality: TeamSetCardinality;

  protected data: TeamSetData;

  constructor({ id, ...data }:TeamSetData & { id:string }, props?:ConstructorParameters<typeof ActiveModel>[0]) {
    super(props);

    this._id = id;
    this.data = data;
  }

  static cleanUnits(units:TeamSetUnit[]) {
    for (const unitState of units) {
      const unitData = unitDataMap.get(unitState.type)!;

      /*
       * The client may dictate unit type, assignment, and sometimes direction.
       * Other state properties will be computed by the server.
       */
      for (const propName of Object.keys(unitState)) {
        if (propName === 'type' || propName === 'assignment')
          continue;
        else if (propName === 'direction' && unitState[propName] !== 'S' && unitData.directional !== false)
          continue;

        delete unitState[propName];
      }
    }

    return units;
  }
  static createId({ units }:{ units:TeamSetUnit[] }, clean:boolean = true) {
    const teamSetsUnits:TeamSetUnit[][] = [];

    if (clean) TeamSet.cleanUnits(units);
    units.sort((a,b) => a.assignment[0] - b.assignment[0] || a.assignment[1] - b.assignment[1]);
    teamSetsUnits.push(units);

    const setFlippedUnits = JSON.parse(JSON.stringify(units)) as TeamSetUnit[];
    for (const unit of setFlippedUnits) {
      unit.assignment[0] = 10 - unit.assignment[0];
      if (unit.direction === 'W')
        unit.direction = 'E';
      else if (unit.direction === 'E')
        unit.direction = 'W';
    }
    setFlippedUnits.sort((a,b) => a.assignment[0] - b.assignment[0] || a.assignment[1] - b.assignment[1]);
    teamSetsUnits.push(setFlippedUnits);

    teamSetsUnits.sort((a,b) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i].assignment[0] !== b[i].assignment[0])
          return a[i].assignment[0] - b[i].assignment[0];
        if (a[i].assignment[1] !== b[i].assignment[1])
          return a[i].assignment[1] - b[i].assignment[1];
        if (a[i].direction !== b[i].direction)
          return (a[i].direction ?? 'S').localeCompare(b[i].direction ?? 'S');
        if (a[i].type !== b[i].type)
          return a[i].type.localeCompare(b[i].type);
      }
      return 0;
    });

    return objectHash(teamSetsUnits[0], { encoding:'base64' }).replace(/=+$/, '');
  }
  static create(teamSetData:TeamSetData, id?:string) {
    if (!id) {
      teamSetData.units = TeamSet.cleanUnits(teamSetData.units.clone());
      id = TeamSet.createId(teamSetData, false);
    }

    return new TeamSet({ id:id!, ...teamSetData }, { isClean:false, isPersisted:false });
  }
  /*
   * Update rating, gameCount, and playerCount for all sets in the game.
   * This method is static because it acts on the rating of more than one teamSet
   */
  static applyGame(game:Game) {
    // Reject games that haven't ended
    if (!game.state.endedAt)
      throw new Error(`Game hasn't ended: ${game.id}`);
    // Ignore practice games
    if (game.state.isPracticeMode) return;
    // Ignore games that use incomplete sets.
    if (!game.state.teams.every(t => t!.set!.isFull)) return;
    // Reject games that have already been processed.
    if (game.state.teams.some(t => (t!.set!.updatedAt ?? new Date(0)) >= game.state.endedAt!))
      throw new Error(`Already applied game: ${game.id}`);

    const teamsMeta = game.state.teams.map((t:Team) => ({
      id: t.id,
      playerId: t.playerId!,
      set: t.set!,
      // This can be null for unrated games
      rating: t.ratings && t.ratings.get(game.state.type)![0],
    }));
    teamsMeta.sort((a,b) => game.state.winnerId === a.id ? -1 : game.state.winnerId === b.id ? 1 : 0);

    // If both players used the same teamSet, no rating change and only increment counts once.
    if (teamsMeta[0].set.id === teamsMeta[1].set.id)
      return teamsMeta[0].set.applyGame(game, game.state.playerIds);
    for (const teamMeta of teamsMeta)
      teamMeta.set.applyGame(game, [ teamMeta.playerId ]);

    // Only update ratings for rated games... and make sure ratings exist for them (pre rankings games don't have them)
    if (!game.state.rated || teamsMeta.some(tm => tm.rating === null))
      return false;

    const isDraw = game.state.winnerId === 'draw';
    const ratings = teamsMeta.map(t => t.set.rating) as [ number, number ];

    // Scale k factors based on player ratings
    // Example 1:
    //   Question: Player A (1000) wins with Set A (1000) vs Player B (1000) with Set B (1000)
    //   Answer: No scaling change because both players have the same rating.
    // Example 2:
    //   Question: Player A (2000) wins with Set A (1000) vs Player B (1000) with Set B (1000)
    //   Answer: Set A's rating will increase by 0.5x and Set B's rating will decrease by 0.5x.
    // Example 3:
    //   Question: Player A (2000) loses with Set A (1000) vs Player B (1000) with Set B (1000)
    //   Answer: Set A's rating will decrease 2x and Set B's rating will increase by 2x.
    const scale = teamsMeta[1].rating! / teamsMeta[0].rating!;
    const newRatings = computeElo(...ratings, isDraw, scale);
    for (const [ t, teamMeta ] of teamsMeta.entries())
      teamMeta.set.rating = newRatings[t];

    return true;
  }

  get gameType() {
    return this.cardinality.gameType;
  }
  get config() {
    return this.cardinality.gameType.config.sets.find(s => s.id === this._id);
  }
  get isFull() {
    return this.cardinality.gameType.validateSetIsFull(this.data.units);
  }

  get key() {
    return `${this._id}:${this.cardinality.gameType.id}`;
  }
  get id() {
    return this._id;
  }
  get name() {
    return this._name ??= this.config?.name ?? this._generateName();
  }
  get units() {
    return this.data.units.clone();
  }
  get tags() {
    return this._tags ??= this.cardinality.gameType.getTeamSetTags(this);
  }
  get indexPaths() {
    return this._indexPaths ??= new Set(this.cardinality.getIndexPaths(this));
  }

  get stats() {
    return this._stats;
  }
  set stats(stats) {
    if (this._stats) throw new Error(`Stats already assigned`);

    // stats can be null when cloning a TeamSet that doesn't have stats.
    this._stats = stats;
  }
  get rating() {
    if (this._stats)
      return this._stats.rating;
    else if (this.data.rating !== undefined)
      return this.data.rating;
    throw new Error(`Required stats`);
  }
  set rating(rating) {
    if (!this._stats) throw new Error(`Required stats`);

    this._stats.rating = rating;
    this.emit({ type:'stats:change:rating' });
  }
  get gameCount() {
    if (this._stats)
      return this._stats.gameCount;
    else if (this.data.gameCount !== undefined)
      return this.data.gameCount;
    throw new Error(`Required stats`);
  }
  set gameCount(gameCount) {
    if (!this._stats) throw new Error(`Required stats`);

    this._stats.gameCount = gameCount;
    this.emit({ type:'stats:change:gameCount' });
  }
  get playerCount() {
    if (this._stats)
      return this._stats.playerCount;
    else if (this.data.playerCount !== undefined)
      return this.data.playerCount;
    throw new Error(`Required stats`);
  }
  set playerCount(playerCount) {
    if (!this._stats) throw new Error(`Required stats`);

    this._stats.playerCount = playerCount;
    this.emit({ type:'stats:change:playerCount' });
  }
  get updatedAt() {
    if (!this._stats) throw new Error(`Required stats`);
    return this._stats.updatedAt;
  }
  set updatedAt(updatedAt) {
    if (!this._stats) throw new Error(`Required stats`);

    this._stats.updatedAt = updatedAt;
    this.emit({ type:'stats:change:updatedAt' });
  }
  get createdBy() {
    if (!this._stats) throw new Error(`Required stats`);
    return this._stats.createdBy;
  }
  set createdBy(createdBy) {
    if (!this._stats) throw new Error(`Required stats`);

    this._stats.createdBy = createdBy;
    this.emit({ type:'stats:change:createdBy' });
  }
  get mostPlayedBy() {
    if (!this._stats) throw new Error(`Required stats`);
    return this._stats.mostPlayedBy;
  }

  addPlayerId(playerId:string, addedAt:Date) {
    if (!this._stats) throw new Error(`Required stats`);
    if (!this._stats.playerIds.has(playerId))
      throw new Error('Player not loaded');

    if (this._stats.playerIds.get(playerId) === null) {
      this._stats.playerIds.set(playerId, {
        createdAt: addedAt,
        updatedAt: addedAt,
        gameCount: 0,
      });
      this.playerCount++;
    }

    const playerStats = this._stats.playerIds.get(playerId)!;
    playerStats.updatedAt = addedAt;
    playerStats.gameCount++;

    this.emit({ type:'stats:playerIds:change', data:{ playerId, playerStats } });
  }

  hasAppliedGame(game:Game) {
    if (!this.updatedAt || !game.state.endedAt)
      return false;
    return game.state.endedAt <= this.updatedAt;
  }
  applyGame(game:Game, playerIds:string[] = []) {
    if (!game.state.endedAt) throw new Error(`Game must be ended`);
    if (!this._stats) throw new Error(`Required stats`);
    if (this.hasAppliedGame(game))
      throw new Error(`Already applied game: ${game.id}`);

    this.gameCount++;

    for (const playerId of playerIds) {
      const team = game.state.getTeamForPlayer(playerId);
      if (([ 'default', 'alt1', 'alt2', 'alt3' ] as (string | null)[]).includes(team!.setVia))
        this.addPlayerId(playerId, game.state.endedAt);
    }

    if (this._stats.updatedAt === null) {
      if (!this.config)
        this.createdBy = playerIds.length === 1 ? playerIds[0] : game.createdBy;
      this.cardinality.applySet(this);
      // Make sure all indexes are saved for a new TeamSet
      this.emit({ type:'stats:change:rating' });
      this.emit({ type:'stats:change:gameCount' });
      this.emit({ type:'stats:change:playerCount' });
    }

    this.updatedAt = game.state.endedAt;

    return true;
  }
  clone(side = 'same') {
    const teamSet = TeamSet.create({
      units: this.data.units.map(u => {
        const unit = { ...u };
        unit.assignment = [ ...unit.assignment ];
        if (side === 'mirror') {
          unit.assignment[0] = 10 - unit.assignment[0];
          if (unit.direction === 'W')
            unit.direction = 'E';
          else if (unit.direction === 'E')
            unit.direction = 'W';
        }
        return unit;
      }),
    }, this._id);
    teamSet.cardinality = this.cardinality;
    teamSet.stats = this._stats;
    return teamSet;
  }

  /*
   * This is for delivering TeamSet data to the client.  It includes stats, when available (always).
   */
  toData(topTeamSets:TeamSet[]) {
    return {
      id: this.id,
      name: this.name,
      units: this.units,
      stats: this._stats?.toData(topTeamSets) ?? null,
    };
  }
  /*
   * While TeamSet objects are not actually persisted anywhere, Team uses this method to persist TeamSet data.
   */
  toJSON() {
    return {
      id: this.id,
      units: this.units,
    };
  }

  _generateName() {
    const tags = this.tags;
    const maxRarity = Math.max(...Array.from(unitTypeByCode.values()).filter(u => u.rarity !== undefined).map(u => u.rarity!));
    const nameParts = [
      (() => {
        const units:{ name:string, count:number, rarity:number, tagCount:number, tagIndex:any }[] = [];
        for (const tag of tags) {
          if (tag.type !== 'unit') continue;
          if ([ 'sg', 'lw' ].includes(tag.name) && tag.count === undefined && tags.some(t => t.type === 'type' && t.name === 'turtle')) continue;
          if (this.cardinality.gameType.id === 'freestyle' && tag.name === 'kn' && tag.count === 3) continue;
          const tagIndex = `/${tag.type}/${tag.name}` + (tag.count === undefined ? '' : `/${tag.count}`);
          const rarity = unitTypeByCode.get(tag.name)!.rarity!;
          units.push({
            name: ((tag.count ?? 1) > 1 ? `${tag.count} ` : '') + unitTypeByCode.get(tag.name)!.shortName + (tag.count === 0 ? 'less' : ''),
            count: this.cardinality.indexes.get(tagIndex)?.count ?? 0,
            rarity: tag.count === 0 ? maxRarity - rarity : rarity,
            tagCount: tag.count ?? 1,
            tagIndex,
          });
        }
        if (units.length === 0) return null;
        const unit = units.sort((a,b) => a.count - b.count || b.rarity - a.rarity || b.tagCount - a.tagCount)[0];
        if (
          unit.name === 'LWless' && units.some(u => u.name === 'BWless') ||
          unit.name === 'BWless' && units.some(u => u.name === 'LWless')
        ) return 'wardless';
        return unit.name;
      })(),
      tags.find(t => t.type === 'position')?.name ?? null,
      tags.find(t => t.type === 'type')?.name ?? null,
    ].filter(np => !!np);

    if (nameParts.length === 0) return;
    return nameParts.map(np => (np as any).toUpperCase('first')).join(' ');
  }
};

serializer.addType({
  name: 'TeamSet',
  constructor: TeamSet,
  schema: {
    type: 'object',
    required: [ 'units' ],
    properties: {
      id: { type:'string', format:'uuid' },
      units: {
        type: 'array',
        items: {
          type: 'object',
          required: [ 'type', 'assignment' ],
          properties: {
            type: { type:'string' },
            assignment: { type:'array', minItems:2, maxItems:2 },
            direction: { type:'string', enum:[ 'N', 'S', 'E', 'W' ] },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
});
