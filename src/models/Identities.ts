import ActiveModel from '#models/ActiveModel.js';
import Identity from '#models/Identity.js';
import serializer from '#utils/serializer.js';
import decancer from '#utils/decancer.js';

import type { Rank } from '#models/Identity.ts';
import type Player from '#models/Player.ts';

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
  deleteId(identityId:string) {
    this.data.delete(identityId);
    this.emit({
      type: 'change:deleteId',
      data: { identityId },
    });
  }
  setValues(identities:Identity[]) {
    this.identities = new Set(identities);
  }
  addValue(identity:Identity) {
    this.identities.add(identity);
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
   *   All else being equal, prefer matches on nicknames before names before aliases.
   */
  queryRated(query, myPlayer:Player) {
    type Match = {
      identityId: string;
      playerId: string;
      relationship: {
        type: string;
        name: string;
      },
      name: string;
      type?: 'exact' | 'fuzzy' | 'partial' | 'none';
      text?: string;
      textType?: 'nickname' | 'name' | 'alias';
    };

    const myIdentity = myPlayer.identity;
    const relationships = this.getRelationships(myPlayer.id);
    const curedQuery = decancer(query);
    const typeSeq = [ 'exact', 'fuzzy', 'start', 'partial' ];
    const lengthSeq = m => m.alias === undefined ? m.name.length : m.alias.length;
    const textMatchSeq = [ 'nickname', 'name', 'alias' ];
    const applyMatchType = (text:string, match:Match) => {
      const cured = decancer(text);

      return Object.assign({
        type: (
          text === query ? 'exact' :
          cured === curedQuery ? 'fuzzy' :
          cured.startsWith(curedQuery) ? 'start' :
          cured.includes(curedQuery) ? 'partial' :
          'none'
        ),
        text,
      }, match);
    };
    const matches:Required<Match>[] = [];

    for (const identity of this.identities) {
      // Ignore guest accounts since they don't have (unique) names.
      if (identity.name === null) continue;

      const playerId = identity.ratedPlayerId;
      if (!playerId) continue;

      const reverseType = myIdentity.getRelationship(playerId)?.type;
      const match = {
        identityId: identity.id,
        playerId,
        relationship: Object.assign({ reverseType }, identity === myIdentity ? { type:'self' } : relationships.get(identity.id)),
        name: identity.name,
      };

      const identityMatches:Required<Match>[] = [];
      if (match.relationship?.name !== undefined) {
        const nickMatch = Object.assign({ textType:'nickname' as const }, applyMatchType(match.relationship.name, match));
        if (nickMatch.type === 'exact') {
          matches.push(nickMatch);
          continue;
        } else if (nickMatch.type !== 'none')
          identityMatches.push(nickMatch);
      }

      const nameMatch = Object.assign({ textType:'name' as const }, applyMatchType(identity.name, match));
      if (nameMatch.type === 'exact') {
        matches.push(nameMatch);
        continue;
      } else if (nameMatch.type !== 'none')
        identityMatches.push(nameMatch);

      for (const alias of identity.aliases.keys()) {
        const aliasMatch = Object.assign({ textType:'alias' as const }, applyMatchType(alias, match));
        if (aliasMatch.type === 'exact') {
          matches.push(aliasMatch);
          continue;
        } else if (aliasMatch.type !== 'none')
          identityMatches.push(aliasMatch);
      }

      // Use only the best match for a given identity
      if (identityMatches.length === 1)
        matches.push(identityMatches[0]);
      else if (identityMatches.length > 1)
        matches.push(identityMatches.sort((a,b) => (
          typeSeq.indexOf(a.type) - typeSeq.indexOf(b.type) ||
          lengthSeq(a) - lengthSeq(b) ||
          textMatchSeq.indexOf(a.textType) - textMatchSeq.indexOf(b.textType)
        ))[0]);
    }

    return matches.sort((a,b) => (
      typeSeq.indexOf(a.type) - typeSeq.indexOf(b.type) ||
      lengthSeq(a) - lengthSeq(b) ||
      textMatchSeq.indexOf(a.textType) - textMatchSeq.indexOf(b.textType)
    )).slice(0, 5);
  }
  getRated(playerIds, myPlayer) {
    const myIdentity = myPlayer.identity;
    const relationships = this.getRelationships(myPlayer.id);
    const ratedPlayers = new Map();
    const playerIdSet = new Set(playerIds);

    for (const identity of this.identities) {
      // Ignore guest accounts since they don't have (unique) names.
      if (identity.name === null) continue;

      const ratedPlayerId = identity.ratedPlayerId;
      if (!ratedPlayerId)
        continue;

      for (const playerId of identity.playerIds) {
        if (!playerIdSet.has(playerId))
          continue;

        const reverseType = myIdentity.getRelationship(playerId)?.type;

        playerIdSet.delete(playerId);
        ratedPlayers.set(playerId, {
          identityId: identity.id,
          playerId: ratedPlayerId,
          relationship: Object.assign({ reverseType }, identity === myIdentity ? { type:'self' } : relationships.get(identity.id)),
          name: identity.name,
        });
        break;
      }

      if (playerIdSet.size === 0)
        break;
    }

    return ratedPlayers;
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
  getRanks(rankingIds:string[] = []) {
    const identities = this.identities;
    const ranksByRankingId = new Map(rankingIds.map(rId => [ rId, [] as Rank[] ]));

    for (const identity of identities)
      for (const rank of identity.getRanks(rankingIds))
        if (ranksByRankingId.has(rank.rankingId))
          ranksByRankingId.get(rank.rankingId)!.push(rank);
        else
          ranksByRankingId.set(rank.rankingId, [ rank ]);

    for (const [ rankingId, ranks ] of ranksByRankingId.entries())
      ranksByRankingId.set(
        rankingId,
        ranks.sort((a,b) => b.rating - a.rating).map((r,i) => ({ num:i+1, ...r })),
      );

    return ranksByRankingId;
  }
  getPlayerRanks(playerIds:string[], rankingIds:string[]) {
    const ranksByPlayerId = new Map();
    const ranks = Array.from(this.getRanks(rankingIds).values()).flat();

    for (const playerId of playerIds) {
      const identity = this.findByPlayerId(playerId);
      // Inactive check
      if (!identity) {
        ranksByPlayerId.set(playerId, null);
        continue;
      }
      // Unrated check
      if (!identity.ratedPlayerId) {
        ranksByPlayerId.set(playerId, false);
        continue;
      }

      const playerIdSet = new Set(identity.playerIds);

      ranksByPlayerId.set(playerId, ranks
        .filter(r => playerIdSet.has(r.playerId))
        .sort((a,b) => a.rankingId === 'FORTE' ? -1 : b.rankingId === 'FORTE' ? 1 : b.rating - a.rating)
      );
    }

    return ranksByPlayerId;
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
