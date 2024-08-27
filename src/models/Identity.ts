import ActiveModel from '#models/ActiveModel.js';
import ServerError from '#server/Error.js';
import serializer from '#utils/serializer.js';

const RELATIONSHIP_TYPES = [ 'friend', 'mute', 'block' ];

interface Relationship {
  type: string | null
  nickname: string | null
  createdAt: Date
}

export default class Identity extends ActiveModel {
  protected data: {
    id: string
    name?: string
    aliases?: Map<string,Date>
    ranks?: { playerId:number, ratings:Map<string,{ rating:number, gameCount:number }> }
    muted: boolean
    admin: boolean
    lastSeenAt: Date

    // Relationships are created by other players to this identity.
    // This allows other players to forget this identity when it is archived or deleted.
    // Relationship keys are player IDs, not identity IDs.  (Avoids new accounts inheriting relationships from old ones)
    // Potentially need to prune these as player accounts are deleted.
    relationships: Map<string, Relationship>

    // Used to sync player.identityId when identities are merged.
    playerIds: Set<string>
  }

  constructor(data) {
    super();
    this.data = data;

    if (data.aliases === undefined)
      data.aliases = new Map();
    if (data.relationships === undefined)
      data.relationships = new Map();
  }

  static create(player) {
    return new Identity({
      id: player.id,
      muted: false,
      admin: false,
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
    return this.data.name ?? null;
  }
  set name(name) {
    if (this.data.name === name)
      return;

    if (this.data.name !== undefined) {
      this.data.aliases.delete(name);
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
    const oneMonthAgo = Date.now() - 30 * 86400;

    return new Map(Array.from(this.data.aliases).filter((a) => a[1].getTime() > oneMonthAgo));
  }

  get muted() {
    return this.data.muted;
  }
  set muted(muted) {
    if (this.data.muted === muted)
      return;
    this.data.muted = muted;
    this.emit('change:muted');
  }
  get lastSeenAt() {
    return this.data.lastSeenAt;
  }
  set lastSeenAt(lastSeenAt) {
    if (+lastSeenAt <= +this.lastSeenAt)
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

  get isAdmin() {
    return this.data.admin;
  }
  get ttl() {
    return this.data.lastSeenAt.getTime() + 30 * 86400 * 1000 - Date.now();
  }
  get expireAt() {
    return new Date(this.data.lastSeenAt.getTime() + 30 * 86400 * 1000);
  }

  get needsIndex() {
    if (this.expireAt.getTime() <= Date.now())
      return false;
    if (this.name === null && this.data.relationships.size === 0)
      return false;

    return true;
  }

  getRanks(rankingId = null) {
    const ranks = this.data.ranks;
    if (!ranks)
      return [];

    return Array.from(ranks.ratings.entries())
      .filter(([ rId, r ]) => [ null, rId ].includes(rankingId))
      .sort((a,b) => b[1].rating - a[1].rating)
      .map(([ rId, r ]) => ({
        id: rId,
        playerId: ranks.playerId,
        name: this.name,
        rating: r.rating,
        gameCount: r.gameCount,
      }));
  }
  setRanks(playerId, ratings) {
    this.data.ranks = { playerId, ratings };
    this.emit('change:setRanks');
  }

  merge(identity) {
    const aliasMap = new Map([ ...this.aliases, ...identity.aliases ]) satisfies typeof this.data.aliases;
    if (this.data.name !== identity.name) {
      aliasMap.delete(identity.name);
      aliasMap.set(this.name, this.data.lastSeenAt);
    }
    const aliases = Array.from(aliasMap).sort((a,b) => b[1].getTime() - a[1].getTime());

    this.data.name = identity.name;
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

    return json;
  }
};

serializer.addType({
  name: 'Identity',
  constructor: Identity,
  schema: {
    type: 'object',
    required: [ 'id', 'muted', 'lastSeenAt', 'playerIds' ],
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
            subType: 'Map',
            items: {
              type: 'array',
              items: [
                { type:'string', format:'uuid' },
                { type:'number' },
              ],
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
