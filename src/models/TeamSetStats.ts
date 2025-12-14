/*
 * A huge design factor for this class was based on the fact that stats are shared between multiple TeamSet objects.
 * But those TeamSet objects can have different units since flipping sides does not affect the team set ID.
 * So, TeamSet objects are first class citizens and TeamSetStats are dumb mutable objects.
 * They have to be dumb because if they have event listeners that hold a reference to TeamSet objects then that would
 * prevent us from detecting when no TeamSets remain in memory so that we can close the TeamSetStats cache.
 */
import ActiveModel from '#models/ActiveModel.js';
import type TeamSet from '#models/TeamSet.js';
import serializer from '#utils/serializer.js';

type TeamSetStatsData = {
  rating: number;
  gameCount: number;
  playerCount: number;
  updatedAt: Date | null;
  createdBy: string | null;
};

export const defaultStats = {
  rating: 750,
  gameCount: 0,
  playerCount: 0,
  updatedAt: null,
  createdBy: null,
};

export default class TeamSetStats extends ActiveModel {
  // Keep track of players that have used this teamSet.
  // A Date value is the date the player first used this teamSet.
  // A null value means they have not previously used this teamSet.
  // A value of undefined means we haven't loaded the data.  Oops.
  public playerIds: Map<string, { createdAt:Date, updatedAt:Date, gameCount:number } | null>;
  public id:string;

  protected data: TeamSetStatsData;

  constructor(data:Partial<TeamSetStatsData>, props?:ConstructorParameters<typeof ActiveModel>[0]) {
    super(props);

    Object.assign(this, {
      data: Object.assign({}, defaultStats, data),
      playerIds: new Map(),
    });
  }

  static create() {
    return new TeamSetStats({}, { isClean:false, isPersisted:false });
  }

  get rating() {
    return this.data.rating;
  }
  set rating(rating) {
    this.data.rating = rating;
  }
  get gameCount() {
    return this.data.gameCount;
  }
  set gameCount(gameCount:number) {
    this.data.gameCount = gameCount;
  }
  get playerCount() {
    return this.data.playerCount;
  }
  set playerCount(playerCount:number) {
    this.data.playerCount = playerCount;
  }
  get updatedAt() {
    return this.data.updatedAt;
  }
  set updatedAt(updatedAt:Date | null) {
    this.data.updatedAt = updatedAt;
  }
  get createdBy() {
    return this.data.createdBy;
  }
  set createdBy(createdBy:string | null) {
    this.data.createdBy = createdBy;
  }
  get mostPlayedBy() {
    if (this.playerIds.size === 0)
      return null;

    return Array.from(this.playerIds).sort((a,b) => (b[1]?.gameCount ?? 0) - (a[1]?.gameCount ?? 0))[0][0];
  }

  toData(topTeamSets:TeamSet[]) {
    const rank = topTeamSets.findIndex(ts => ts.id === this.id);

    return {
      rank: rank === -1 ? null : rank + 1,
      rating: Math.round(this.rating),
      gameCount: this.gameCount,
      playerCount: this.playerCount,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      mostPlayedBy: this.mostPlayedBy,
    };
  }
  toJSON() {
    const json = super.toJSON();
    for (const [ prop, value ] of Object.entries(defaultStats))
      if (json[prop] === value)
        delete json[prop];

    return json;
  }
};

serializer.addType({
  name: 'TeamSetStats',
  constructor: TeamSetStats,
  schema: {
    type: 'object',
    required: [ 'id' ],
    properties: {
      id: { type:'string' },
      rating: { type:'number' },
      gameCount: { type:'integer' },
      playerCount: { type:'integer' },
      updatedAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
