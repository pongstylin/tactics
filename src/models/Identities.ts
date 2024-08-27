import ActiveModel from '#models/ActiveModel.js';
import Identity from '#models/Identity.js';
import serializer from '#utils/serializer.js';
import decancer from '#utils/decancer.js';

export default class Identities extends ActiveModel {
  protected data: Set<string>
  protected identities: Set<Identity>

  constructor(data) {
    super();
    this.data = data;
    this.identities = new Set();
  }

  static create() {
    return new Identities(new Set());
  }
  static fromJSON(data) {
    return new Identities(new Set(data));
  }

  findByPlayerId(playerId) {
    for (const identity of this.identities)
      if (identity.playerIds.includes(playerId))
        return identity;

    return null;
  }

  getIds() {
    return [ ...this.data ];
  }
  setValues(identities) {
    this.identities = new Set(identities);
  }

  values() {
    return this.identities.values();
  }

  has(identity) {
    return this.data.has(identity.id);
  }
  add(identity) {
    if (this.data.has(identity.id))
      return false;
    if (!identity.needsIndex)
      return false;

    this.data.add(identity.id);
    this.identities.add(identity);
    this.emit({
      type: 'change:add',
      data: { identity },
    });

    return true;
  }
  merge(identity1, identity2, players) {
    identity1.merge(identity2);
    for (const player of players) {
      player.identityId = identity1.id;
      player.identity = identity1;
    }

    this.add(identity1);
    this.data.delete(identity2.id);
    this.identities.delete(identity2);
    this.emit({
      type: 'change:merge',
      data: { identity:identity2 },
    });
  }
  archive(identity) {
    if (!this.identities.has(identity))
      return false;

    this.data.delete(identity.id);
    this.identities.delete(identity);
    this.emit({
      type: 'change:archive',
      data: { identity:identity },
    });

    return true;
  }

  getRelationships(playerId) {
    const relationships = new Map();

    for (const identity of this.identities) {
      const relationship = identity.getRelationship(playerId);
      if (relationship)
        relationships.set(identity.id, {
          type: relationship.type,
          name: relationship.nickname,
        });
    }

    return relationships;
  }
  sharesName(name, forIdentity) {
    const curedName = decancer(name);

    for (const identity of this.identities) {
      if (identity !== forIdentity && decancer(identity.name) === curedName)
        return true;

      for (const alias of identity.aliases.keys())
        if (identity !== forIdentity && decancer(alias) === curedName)
          return true;
    }

    return false;
  }

  getRankings() {
    const ranks = this.getRanks();

    return Array.from(ranks.entries()).map(([ rId, rs ]) => ({
      id: rId,
      numPlayers: rs.length,
    }));
  }
  getRanks(rankingId = null) {
    const identities = this.identities;
    const ranksByRankingId = new Map();

    for (const identity of identities)
      for (const rank of identity.getRanks(rankingId))
        if (!ranksByRankingId.has(rank.id))
          ranksByRankingId.set(rank.id, [ rank ]);
        else
          ranksByRankingId.get(rank.id).push(rank);

    for (const [ rankingId, ranks ] of ranksByRankingId.entries())
      ranksByRankingId.set(
        rankingId,
        ranks.sort((a,b) => b.rating - a.rating).map((r,i) => ({ num:i+1, ...r })),
      );

    return ranksByRankingId;
  }
  getPlayerRanks(playerId, rankingId = null) {
    const ranks = Array.from(this.getRanks().values()).flat();

    return (
      rankingId === null ? ranks.filter(r => r.playerId === playerId) :
      rankingId === 'FORTE' ? ranks.filter(r => r.playerId === playerId && (r.id === rankingId || r.gameCount > 9)) :
      ranks.filter(r => r.playerId === playerId && r.id === rankingId)
    ).sort((a,b) => a.id === 'FORTE' ? -1 : b.id === 'FORTE' ? 1 : b.rating - a.rating);
  }
};

serializer.addType({
  name: 'Identities',
  constructor: Identities,
  schema: {
    type: 'array',
    subType: 'Set',
    items: { type:'string', format:'uuid' },
  },
});
