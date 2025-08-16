import ActiveModel from '#models/ActiveModel.js';
import GameType from '#tactics/GameType.js';
import { addForteRank } from '#models/PlayerStats.js';
import serializer from '#utils/serializer.js';

interface Relationship {
  type: string | null
  nickname: string | null
  createdAt: Date
}
export type Rank = {
  rankingId: string;
  playerId: string;
  name: string;
  rating: number;
  gameCount: number;
};

export default class Identity extends ActiveModel {
  protected data: {
    id: string;
    name: string | null;
    aliases: Map<string,Date>;
    ranks: {
      playerId:string;
      ratings:Rank[];
    } | null;
    muted: boolean;
    admin: boolean;
    lastSeenAt: Date;

    // Relationships are created by other players to this identity.
    // This allows other players to forget this identity when it is archived or deleted.
    // Relationship keys are player IDs, not identity IDs.  (Avoids new accounts inheriting relationships from old ones)
    // Potentially need to prune these as player accounts are deleted.
    relationships: Map<string, Relationship>

    // Used to sync player.identityId when identities are merged.
    playerIds: Set<string>
  }
  protected gameTypes: Map<string,GameType>

  constructor(data) {
    super();

    this.data = Object.assign({
      name: null,
      aliases: new Map(),
      relationships: new Map(),
      ranks: null,
      muted: false,
      admin: false,
    }, data);

    if (data.ranks)
      data.ranks.ratings = addForteRank(data.ranks.ratings.map(r => ({
        rankingId: r.rankingId,
        playerId: data.ranks.playerId,
        name: this.name,
        rating: r.rating,
        gameCount: r.gameCount,
      })));
  }

  static create(player) {
    return new Identity({
      id: player.id,
      lastSeenAt: player.lastSeenAt,
      playerIds: new Set([ player.id ]),
    });
  }

  get id() {
    return this.data.id;
  }

  /*
   * Only available to verified players
   */
  get name() {
    return this.data.name;
  }
  set name(name:string | null) {
    if (this.data.name === name)
      return;

    if (this.data.name !== null) {
      this.data.aliases.delete(this.data.name);
      this.data.aliases.set(this.data.name, new Date());

      if (this.data.aliases.size > 3) {
        const oldestAlias = Array.from(this.data.aliases).sort((a,b) => a[1].getTime() - b[1].getTime())[0][0];
        this.data.aliases.delete(oldestAlias);
      }
    }

    this.data.name = name;
    this.emit('change:name');
  }
  get aliases() {
    const oneMonthAgo = Date.now() - 30 * 86400 * 1000;

    return new Map(Array.from(this.data.aliases).filter((a) => a[1].getTime() > oneMonthAgo));
  }

  get admin() {
    return this.data.admin ?? false;
  }
  set admin(admin) {
    if (this.admin === admin)
      return;
    this.data.admin = admin;
    this.emit('change:admin');
  }
  get muted() {
    return this.data.muted ?? false;
  }
  set muted(muted) {
    if (this.muted === muted)
      return;
    this.data.muted = muted;
    this.emit('change:muted');
  }
  get lastSeenAt() {
    return this.data.lastSeenAt;
  }
  set lastSeenAt(lastSeenAt) {
    if (+lastSeenAt <= +this.data.lastSeenAt)
      return;

    this.data.lastSeenAt = lastSeenAt;
    this.emit('change:lastSeenAt');
  }
  get relationships() {
    return new Map([ ...this.data.relationships ]);
  }
  get playerIds() {
    return [ ...this.data.playerIds ];
  }

  get ttl() {
    // Delete the object after 3 or 12 months of inactivity depending on verification status.
    const days = (this.data.name === null ? 3 : 12) * 30;

    return Math.round(this.data.lastSeenAt.getTime() / 1000) + days * 86400;
  }
  get expireAt() {
    const days = this.data.name === null ? 7 : 30;

    return new Date(this.data.lastSeenAt.getTime() + days * 86400 * 1000);
  }

  get needsIndex() {
    if (this.expireAt.getTime() <= Date.now())
      return false;

    return true;
  }
  get ratedPlayerId() {
    // Only verified players are rated
    if (this.name === null)
      return null;

    if (this.data.ranks)
      return this.data.ranks.playerId;

    return ([ ...this.data.playerIds ] as any).last;
  }

  getRanks(rankingIds:string[] = []) {
    const ranks = this.data.ranks;
    if (!ranks)
      return [];
    else if (rankingIds.length === 0)
      return ranks.ratings.slice();

    return ranks.ratings.filter(r => rankingIds.includes(r.rankingId));
  }
  setRanks(playerId:string, ratingsMap:Map<string, { rating:number, gameCount:number }>) {
    const ratings = addForteRank(Array.from(ratingsMap.entries())
      .sort((a,b) => b[1].rating - a[1].rating)
      .map(([ rId, r ]) => ({
        rankingId: rId,
        playerId,
        name: this.name!,
        rating: r.rating,
        gameCount: r.gameCount,
      })));

    this.data.ranks = { playerId, ratings };
    this.pruneRanks();
    this.emit('change:setRanks');
  }
  pruneRanks(gameTypes:Map<string, GameType> | null = null) {
    gameTypes = gameTypes ? this.gameTypes = gameTypes : this.gameTypes;

    const ranks = this.data.ranks;
    if (!gameTypes || !ranks)
      return;

    const ratings = ranks.ratings.filter(r => (
      r.rankingId === 'FORTE' || (gameTypes.has(r.rankingId) && !gameTypes.get(r.rankingId)!.config.archived)
    ));

    if (ratings.length === ranks.ratings.length)
      return;

    ranks.ratings = ratings;
    this.emit('change:pruneRanks');
  }

  merge(identity:Identity) {
    const aliasMap = new Map([ ...this.aliases, ...identity.aliases ]) satisfies typeof this.data.aliases;
    if (identity.name !== null && identity.name !== this.data.name) {
      aliasMap.delete(identity.name);
      if (this.data.name !== null)
        aliasMap.set(this.data.name, this.data.lastSeenAt);
      this.data.name = identity.name;
    }
    const aliases = Array.from(aliasMap).sort((a,b) => b[1].getTime() - a[1].getTime());

    this.data.aliases = new Map(aliases.slice(0, 3));
    this.data.ranks = identity.data.ranks;

    if (identity.lastSeenAt > this.data.lastSeenAt)
      this.lastSeenAt = identity.lastSeenAt;

    for (const [ playerId, relationship ] of identity.relationships) {
      if (this.data.playerIds.has(playerId))
        continue;

      const myRelationship = this.data.relationships.get(playerId);
      if (myRelationship && myRelationship.createdAt > relationship.createdAt)
        continue;
      this.data.relationships.set(playerId, relationship);
    }

    this.data.playerIds = new Set([ ...this.data.playerIds, ...identity.data.playerIds ]);
    this.emit('change:merge');
  }

  deletePlayerId(playerId) {
    if (!this.data.playerIds.has(playerId))
      return false;

    this.data.playerIds.delete(playerId);
    this.emit('change:deletePlayerId');

    return true;
  }

  /*
   * Relationship Management
   */
  hasRelationship(playerId) {
    return this.data.relationships.has(playerId);
  }
  getRelationship(playerId) {
    return this.data.relationships.get(playerId);
  }
  setRelationship(playerId, relationship) {
    relationship.createdAt ??= new Date();

    this.data.relationships.set(playerId, relationship);
    this.emit('change:relationship');
  }
  deleteRelationship(playerId) {
    this.data.relationships.delete(playerId);
    this.emit('change:relationship');
  }

  toJSON() {
    const json = super.toJSON();

    if (json.aliases.size)
      json.aliases = [ ...json.aliases ];
    else
      delete json.aliases;
    if (json.relationships.size)
      json.relationships = [ ...json.relationships ];
    else
      delete json.relationships;
    json.playerIds = [ ...json.playerIds ];

    if (json.ranks)
      json.ranks = {
        playerId: json.ranks.playerId,
        ratings: json.ranks.ratings
          .filter(r => r.rankingId !== 'FORTE')
          .map(({ rankingId, rating, gameCount }) => ({ rankingId, rating, gameCount })),
      };
    if (json.admin === false)
      delete json.admin;
    if (json.muted === false)
      delete json.muted;

    return json;
  }
};

serializer.addType({
  name: 'Identity',
  constructor: Identity,
  schema: {
    type: 'object',
    required: [ 'id', 'lastSeenAt', 'playerIds' ],
    properties: {
      id: { type:'string', format:'uuid' },
      name: { type:'string' },
      aliases: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string' },
            { type:'string', subType:'Date' },
          ],
        },
      },
      ranks: {
        type: 'object',
        required: [ 'playerId', 'ratings' ],
        properties: {
          playerId: { type:'string', format:'uuid' },
          ratings: {
            type: 'array',
            items: {
              type: 'object',
              required: [ 'rankingId', 'rating', 'gameCount' ],
              properties: {
                rankingId: { type:'string' },
                rating: { type:'number' },
                gameCount: { type:'number' },
              },
            },
          },
        },
        additionalProperties: false,
      },
      muted: { type:'boolean' },
      lastSeenAt: { type:'string', subType:'Date' },
      relationships: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string', format:'uuid' },
            {
              type: 'object',
              required: [ 'createdAt' ],
              properties: {
                type: { type:'string', enum:[ 'friended', 'muted', 'blocked' ] },
                nickname: { type:'string' },
                createdAt: { type:'string', subType:'Date' },
              },
              additionalProperties: false,
            },
          ],
        },
      },
      playerIds: {
        type: 'array',
        subType: 'Set',
        items: { type:'string', format:'uuid' },
      },
    },
    additionalProperties: false,
  },
});
