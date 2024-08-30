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
  /*
   * Return the 5 best identity matches for the query.
   *   Exact matches are the best.
   *   Fuzzy matches are 2nd best.
   *   Partial matches are 3rd best.
   *   Among partial matches, the smaller the name/alias the better the match.
   *   All else being equal, name matches are better than alias matches.
   */
  queryRanked(query) {
    const curedQuery = decancer(query);
    const typeSeq = [ 'exact', 'fuzzy', 'start', 'partial' ];
    const lengthSeq = m => m.alias === undefined ? m.name.length : m.alias.length;
    const aliasSeq = m => m === undefined ? 0 : 1;
    const matches = [];

    for (const identity of this.identities) {
      const playerId = identity.rankedPlayerId;
      if (!playerId) continue;

      const curedName = decancer(identity.name);
      const identityMatches = [];
      const match = {
        type: null,
        identityId: identity.id,
        playerId,
        name: identity.name,
      };

      if (identity.name === query)
        match.type = 'exact';
      else if (curedName === curedQuery)
        match.type = 'fuzzy';
      else if (curedName.startsWith(curedQuery))
        match.type = 'start';
      else if (curedName.includes(curedQuery))
        match.type = 'partial';

      if (match.type === 'exact') {
        matches.push(match);
        continue;
      } else if (match.type)
        identityMatches.push(match);

      for (const alias of identity.aliases.keys()) {
        const curedAlias = decancer(alias);
        const aliasMatch = Object.assign({ alias }, match);

        if (alias === query)
          aliasMatch.type = 'exact';
        else if (curedAlias === curedQuery)
          aliasMatch.type = 'fuzzy';
        else if (curedAlias.startsWith(curedQuery))
          aliasMatch.type = 'start';
        else if (curedAlias.includes(curedQuery))
          aliasMatch.type = 'partial';
        if (aliasMatch.type)
          identityMatches.push(aliasMatch);
      }

      // Use only the best match for a given identity
      if (identityMatches.length === 1)
        matches.push(identityMatches[0]);
      else if (identityMatches.length > 1)
        matches.push(identityMatches.sort((a,b) => (
          typeSeq.indexOf(a.type) - typeSeq.indexOf(b.type) ||
          lengthSeq(a) - lengthSeq(b) ||
          aliasSeq(a) - aliasSeq(b)
        ))[0]);
    }

    return matches.sort((a,b) => (
      typeSeq.indexOf(a.type) - typeSeq.indexOf(b.type) ||
      lengthSeq(a) - lengthSeq(b) ||
      aliasSeq(a) - aliasSeq(b)
    )).slice(0, 5);
  }
  getRanked(playerIds) {
    const rankedPlayers = new Map();
    const playerIdSet = new Set(playerIds);

    for (const identity of this.identities) {
      const rankedPlayerId = identity.rankedPlayerId;
      if (!rankedPlayerId)
        continue;

      for (const playerId of identity.playerIds) {
        if (!playerIdSet.has(playerId))
          continue;

        playerIdSet.delete(playerId);
        rankedPlayers.set(playerId, {
          identityId: identity.id,
          playerId: rankedPlayerId,
          name: identity.name,
        });
        break;
      }

      if (playerIdSet.size === 0)
        break;
    }

    return rankedPlayers;
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
        if (!ranksByRankingId.has(rank.rankingId))
          ranksByRankingId.set(rank.rankingId, [ rank ]);
        else
          ranksByRankingId.get(rank.rankingId).push(rank);

    for (const [ rankingId, ranks ] of ranksByRankingId.entries())
      ranksByRankingId.set(
        rankingId,
        ranks.sort((a,b) => b.rating - a.rating).map((r,i) => ({ num:i+1, ...r })),
      );

    return ranksByRankingId;
  }
  getPlayerRanks(playerId, rankingId = null) {
    const identity = this.findByPlayerId(playerId);
    if (!identity)
      return [];

    const ranks = Array.from(this.getRanks().values()).flat();

    return (
      rankingId === null ? ranks
        .filter(r => identity.playerIds.includes(r.playerId)) :
      rankingId === 'FORTE' ? ranks
        .filter(r => identity.playerIds.includes(r.playerId) && (r.rankingId === rankingId || r.gameCount > 9)) :
      ranks
        .filter(r => identity.playerIds.includes(r.playerId) && r.rankingId === rankingId)
    ).sort((a,b) => a.rankingId === 'FORTE' ? -1 : b.rankingId === 'FORTE' ? 1 : b.rating - a.rating);
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
