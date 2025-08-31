import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';

import type Game from '#models/Game.ts';
import type Player from '#models/Player.ts';
import type Team from '#models/Team.ts';

const DEFAULT_RATING = 750.0;

type RatingStats = {
  rating: number;
  gameCount: number;
  updatedAt: Date;
}
type WLDStats = {
  startedAt: Date;
  win: [ number, number ];
  lose: [ number, number ];
  draw: [ number, number ];
};
type VSStats = {
  name: string;
  aliases: Map<string, { name:string, count:number, lastSeenAt:Date }>;
  all: WLDStats;
  style: Map<string, WLDStats>;
};

export default class PlayerStats extends ActiveModel {
  protected data: {
    playerId: string
    numCompleted: number
    numAbandoned: number
    ratings: Map<string, RatingStats>
  }
  public player: Player | null = null;
  public vs: Map<string, VSStats>;

  constructor(data:any) {
    super();
    this.data = Object.assign({
      numCompleted: 0,
      numAbandoned: 0,
      ratings: new Map(),
    }, data);
    this.vs = new Map();
  }

  static create(playerId:string) {
    return new PlayerStats({ playerId });
  }

  /*
   * Updates the ratings of all players involved in a game.
   * This method is static because it acts on the rating of more than one player
   */
  static updateRatings(game:Game, playersStatsMap:Map<string, PlayerStats>, slowMode:boolean = false) {
    // Only update ratings for rated games.
    if (!game.state.rated)
      return false;

    const teamsMeta = game.state.teams.map((t:Team) => {
      const stats = playersStatsMap.get(t.playerId)!;
      const ratingStats = stats._getRatingStats(game.state.type);

      return { id:t.id, stats, ...ratingStats };
    });
    teamsMeta.sort((a,b) => game.state.winnerId === a.id ? -1 : game.state.winnerId === b.id ? 1 : 0);

    const isDraw = game.state.winnerId === 'draw';
    const k = slowMode ? teamsMeta.map(() => 5) : computeMaxRatingChange(...teamsMeta.map(t => t.gameCount) as [ number, number ]);
    const ratings = teamsMeta.map(t => t.rating) as [ number, number ];

    for (const [ t, teamMeta ] of teamsMeta.entries()) {
      const team = game.state.teams[teamMeta.id]!;
      const stats = teamMeta.stats;
      const oldForte = stats.calcForteRating();
      const oldRating = teamMeta.rating;

      stats._setRating(
        game.state.type,
        Math.max(100, _computeElo(...ratings, k[t], isDraw)[t]),
      );

      const newForte = stats.calcForteRating();
      const newRating = stats._getRatingStats(game.state.type).rating;

      if (newForte)
        team.setRating('FORTE', oldForte, newForte);
      team.setRating(game.state.type, Math.round(oldRating), Math.round(newRating));
    }

    return true;
  }

  get playerId() {
    return this.data.playerId;
  }
  get numCompleted() {
    return this.data.numCompleted;
  }
  get numAbandoned() {
    return this.data.numAbandoned;
  }
  get ratings() {
    const ratings = this.data.ratings;
    const publicRatings = new Map([ ...ratings ].map(([ gtId, ri ]) => [ gtId, {
      rating: Math.round(ri.rating),
      gameCount: ri.gameCount,
    } ]));

    return publicRatings;
  }

  get ttl() {
    if (this.player)
      return this.player.ttl;
    else
      console.log(`Warning: PlayerStats (${this.playerId}) has no player reference`);

    // Delete the object after 12 months of inactivity (worst case)
    const days = 12 * 30;

    return Math.round(Date.now() / 1000) + days * 86400;
  }

  getRating(gameTypeId:string) {
    return Math.round(this._getRatingStats(gameTypeId).rating);
  }
  _setRating(gameTypeId:string, rating:number) {
    const ratingStats = this._getRatingStats(gameTypeId);
    ratingStats.gameCount++;
    ratingStats.updatedAt = new Date();
    ratingStats.rating = rating;
    this.data.ratings.set(gameTypeId, ratingStats);

    this.emit('change:setRating');
  }

  calcForteRating() {
    const ratings = this.data.ratings ?? new Map();
    const ratingsStats = [ ...ratings.values() ].sort((a,b) => b.rating - a.rating);

    let weight = 1.0;
    let rating = 0;
    for (const ratingStats of ratingsStats) {
      if (ratingStats.gameCount > 9) {
        weight /= 2;
        rating += Math.round(ratingStats.rating * weight);
      }
    }

    return rating;
  }

  recordGameStart(game) {
    if (!game.state.startedAt)
      throw new Error('Game has not started yet');
    if (game.state.endedAt)
      throw new Error('Game already ended');
    if (!game.state.getTeamForPlayer(this.data.playerId))
      throw new Error(`Game was not played by ${this.data.playerId}`);

    // No stats for single player games.
    if (game.state.isSinglePlayer)
      return;

    for (const team of game.state.teams)
      if (team.playerId !== this.playerId)
        this._syncVS(team, game);
  }
  recordGameEnd(game) {
    if (!game.state.startedAt)
      throw new Error('Game has not started yet');
    if (!game.state.endedAt)
      throw new Error('Game has not ended');
    const myTeam = game.state.getTeamForPlayer(this.data.playerId);
    if (!myTeam)
      throw new Error(`Game was not played by ${this.data.playerId}`);

    // Skip WLD stats for practice games.
    if (game.state.isPracticeMode)
      return;

    /*
     * Determine which players played a turn.
     */
    const hasPlayed = new Set();
    for (const team of game.state.teams)
      if (game.state.teamHasPlayed(team))
        hasPlayed.add(team);

    for (const [ teamId, team ] of game.state.teams.entries()) {
      if (team.playerId === this.playerId) {
        if (hasPlayed.has(team)) {
          // I didn't really complete a game if every other player abandoned it.
          if (hasPlayed.size < game.state.teams.length)
            continue;

          this.data.numCompleted = (this.data.numCompleted ?? 0) + 1;
          this.emit('change:numCompleted');
        } else {
          this.data.numAbandoned = (this.data.numAbandoned ?? 0) + 1;
          this.emit('change:numAbandoned');
        }
        continue;
      }

      const vsStats = this._syncVS(team, game);

      // If either I or this player abandoned the game, do not collect WLD stats.
      if (hasPlayed.size < game.state.teams.length)
        continue;

      /*
       * Collect WLD stats against the opponent.
       */
      const myAdvantage = myTeam.usedUndo || myTeam.usedSim;
      const vsAdvantage = team.usedUndo || team.usedSim;

      if (game.state.winnerId === myTeam.id) {
        // If I won with advantage, but they didn't use advantage, win is with advantage.
        const wldIndex = myAdvantage && !vsAdvantage ? 1 : 0;
        vsStats.all.win[wldIndex]++;
        vsStats.style.get(game.state.type)!.win[wldIndex]++;
      } else if (game.state.winnerId === teamId) {
        // If I lost without advantage, but they used advantage, the loss is at disadvantage.
        const wldIndex = vsAdvantage && !myAdvantage ? 1 : 0;
        vsStats.all.lose[wldIndex]++;
        vsStats.style.get(game.state.type)!.lose[wldIndex]++;
      } else if (game.state.winnerId === 'draw') {
        // If I drew with advantage, but they didn't use advantage, draw is with advantage.
        // Note: If we both lost in a 4-player game, we drew with each other.
        const wldIndex = myAdvantage && !vsAdvantage ? 1 : 0;
        vsStats.all.draw[wldIndex]++;
        vsStats.style.get(game.state.type)!.draw[wldIndex]++;
      }
    }
  }

  clearRatings(rankingId:string | null = null) {
    if (rankingId)
      this.data.ratings.delete(rankingId);
    else
      this.data.ratings.clear();
  }
  clearWLDStats(playerId:string, gameTypeId:string | null = null) {
    const vsStats = this.vs.get(playerId);
    if (!vsStats)
      return;
    if (gameTypeId && !vsStats.style.has(gameTypeId))
      return;

    const wldStats = gameTypeId ? vsStats.style.get(gameTypeId)! : vsStats.all;
    const count = (
      wldStats.win[0]  + wldStats.win[1] +
      wldStats.lose[0] + wldStats.lose[1] +
      wldStats.draw[0] + wldStats.draw[1]
    );
    if (count === 0)
      return;

    Object.assign(wldStats, {
      startedAt: Date.now(),
      win: [0, 0],
      lose: [0, 0],
      draw: [0, 0],
    });

    this.emit({
      type: 'vs:change:clearWLDStats',
      data: {
        playerId: this.playerId,
        vsPlayerId: playerId,
        vsStats,
      },
    });
  }

  _syncVS(team:Team, game:Game) {
    if (!this.vs.has(team.playerId)) {
      if (game.state.endedAt)
        console.log(`Warning: Game start not recorded: ${team.playerId} (${this.data.playerId})`);

      this.vs.set(team.playerId, {
        name: team.name,
        aliases: new Map(),
        all: {
          startedAt: team.joinedAt!,
          win: [0, 0],
          lose: [0, 0],
          draw: [0, 0],
        },
        style: new Map(),
      });
    }

    const vsStats = this.vs.get(team.playerId)!;

    if (vsStats.aliases.has(team.name.toLowerCase())) {
      const alias = vsStats.aliases.get(team.name.toLowerCase())!;
      alias.name = team.name;
      // Avoid double counting
      if (!game.state.endedAt)
        alias.count++;
      alias.lastSeenAt = team.joinedAt!;
    } else {
      vsStats.aliases.set(team.name.toLowerCase(), {
        name: team.name,
        count: 1,
        lastSeenAt: team.joinedAt!,
      });
    }

    if (!vsStats.style.has(game.state.type)) {
      vsStats.style.set(game.state.type, {
        startedAt: team.joinedAt!,
        win: [0, 0],
        lose: [0, 0],
        draw: [0, 0],
      });
    }

    this.emit({
      type: 'vs:change:sync',
      data: {
        playerId: this.playerId,
        vsPlayerId: team.playerId,
        vsStats,
      },
    });
    return vsStats;
  }
  _getRatingStats(rankingId:string) {
    return this.data.ratings.get(rankingId) ?? {
      rating: rankingId === 'FORTE' ? 0 : DEFAULT_RATING,
      gameCount: 0,
      updatedAt: new Date(),
    };
  }

  toJSON() {
    const data = super.toJSON();
    if (data.numCompleted === 0)
      delete data.numCompleted;
    if (data.numAbandoned === 0)
      delete data.numAbandoned;
    if (data.ratings.size === 0)
      delete data.ratings;

    return data;
  }
};

/*
 * `ranks` is expected to be presorted
 */
export function addForteRank(ranks:{ rankingId:string, playerId:string, name:string, rating:number, gameCount:number }[]) {
  if (ranks.length === 0)
    return ranks;

  let weight = 1.0;
  let rating = 0;
  let gameCount = 0;

  for (const rank of ranks) {
    if (rank.gameCount > 9) {
      weight /= 2;
      rating += Math.round(rank.rating * weight);
    }
    gameCount += rank.gameCount;
  }

  if (rating)
    ranks.unshift({
      rankingId: 'FORTE',
      playerId: ranks[0].playerId,
      name: ranks[0].name,
      rating,
      gameCount,
    });

  return ranks;
}

// Inspired by: https://www.geeksforgeeks.org/elo-rating-algorithm/
function _probability(rating1:number, rating2:number) {
  return (
    (1.0 * 1.0) / (1 + 1.0 * Math.pow(10, (1.0 * (rating1 - rating2)) / 400))
  );
}

/**
 * Computes the updated Elo Ratings for two players. Returns an array of size 2, in which the first and second elements
 * are the updated ratings of the winner and loser respectively.
 * @param ratingWinner
 * @param ratingLoser
 * @param K
 */
function _computeElo(ratingWinner:number, ratingLoser:number, K:number, isDraw:boolean) {
  const pWinner = _probability(ratingLoser, ratingWinner);
  const pLoser = _probability(ratingWinner, ratingLoser);
  const ratings = [] as number[];

  if (isDraw) {
    ratings.push(ratingWinner + K * (0.5 - pWinner));
    ratings.push(ratingLoser + K * (0.5 - pLoser));
  } else {
    ratings.push(ratingWinner + K * (1 - pWinner));
    ratings.push(ratingLoser + K * (0 - pLoser));
  }

  return ratings;
}

// This function computes the optimal values for "K" which is the maximum change that can occur to a player's rating in a single game.
// In general, a new player should have a large value for K, and an experienced player should have a smaller value for K.
function computeMaxRatingChange(gameCount1:number, gameCount2:number) {

  // Note that the original game had 32, which was a bit high.
  // Suggested reading: https://en.wikipedia.org/wiki/Elo_rating_system#Most_accurate_K-factor
  const DEFAULT_K_FACTOR = 20;

  // Players who have played this many games or more are no longer considered "new".
  const EXPERIENCE_THRESHOLD = 10;

  // High confidence - both sides played a sufficient number of games. Return standard value.
  // In the long-term, this should be the most common case.
  if (gameCount1 >= EXPERIENCE_THRESHOLD && gameCount2 >= EXPERIENCE_THRESHOLD)
    return [DEFAULT_K_FACTOR, DEFAULT_K_FACTOR];

  // In this case, at least one player is "new", meaning we do not have confidence that their rating is representative of their skill.
  // As such, K is doubled for the new player, so they can reach their "true rating" faster.
  // And K is halved for their opponent when their opponent is experienced (to protect against new accounts used as stat killers)
  const k1 = gameCount1 < EXPERIENCE_THRESHOLD ? DEFAULT_K_FACTOR * 2 : DEFAULT_K_FACTOR / 2;
  const k2 = gameCount2 < EXPERIENCE_THRESHOLD ? DEFAULT_K_FACTOR * 2 : DEFAULT_K_FACTOR / 2;

  return [k1, k2];
}

serializer.addType({
  name: 'PlayerStats',
  constructor: PlayerStats,
  schema: {
    type: 'object',
    required: [ 'playerId' ],
    properties: {
      playerId: { type: 'string', format: 'uuid' },
      numCompleted: { type:'number' },
      numAbandoned: { type:'number' },
      ratings: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type: 'string' },
            {
              type: 'object',
              required: [ 'rating', 'gameCount', 'updatedAt' ],
              properties: {
                rating: { type:'number' },
                gameCount: { type:'number' },
                updatedAt: { type:'string', subType:'Date' },
              },
              additionalProperties: false,
            },
          ],
        },
      },
      // Not expected to be present when pulling a PlayerStats item.
      vs: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type: 'string', format: 'uuid' },
            {
              type: 'object',
              required: [ 'name', 'aliases', 'all', 'style' ],
              properties: {
                name: { type: 'string' },
                aliases: {
                  type: 'array',
                  subType: 'Map',
                  items: {
                    type: 'array',
                    items: [
                      { type:'string' },
                      {
                        type: 'object',
                        required: [ 'name', 'count', 'lastSeenAt' ],
                        properties: {
                          name: { type:'string' },
                          count: { type:'number' },
                          lastSeenAt: { type:'string', subType:'Date' },
                        },
                        additionalProperties: false,
                      },
                    ],
                    additionalItems: false,
                  },
                },
                all: { $ref:'#/definitions/wld' },
                style: {
                  type: 'array',
                  subType: 'Map',
                  items: {
                    type: 'array',
                    items: [
                      { type:'string' },
                      { $ref:'#/definitions/wld' },
                    ],
                    additionalItems: false,
                  },
                },
              },
              additionalProperties: false,
            },
          ],
        },
      },
    },
    additionalProperties: false,
    definitions: {
      wld: {
        type: 'object',
        required: [ 'startedAt', 'win', 'lose', 'draw' ],
        properties: {
          startedAt: { type:'string', subType:'Date' },
          win: { $ref:'#/definitions/statTuple' },
          lose: { $ref:'#/definitions/statTuple' },
          draw: { $ref:'#/definitions/statTuple' },
        },
        additionalProperties: false,
      },
      statTuple: {
        type: 'array',
        items: [ { type: 'number' }, { type: 'number' } ],
        additionalItems: false,
      },
    },
  },
});
