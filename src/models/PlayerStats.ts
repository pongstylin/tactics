import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';

const DEFAULT_RATING = 750.0;

export default class PlayerStats extends ActiveModel {
  protected data: {
    playerId: string
    stats: Map<string, any>
  }

  constructor(data) {
    super();
    this.data = data;
  }

  static create(playerId) {
    return new PlayerStats({
      playerId,
      stats: new Map(),
    });
  }

  /*
   * Updates the ratings of all players involved in a game.
   * This method is static because it acts on the rating of more than one player
   */
  static updateRatings(game, playersStatsMap) {
    // Only update ratings for rated games.
    if (!game.state.rated)
      return false;

    const teamsMeta = game.state.teams.map(t => {
      const stats = playersStatsMap.get(t.playerId);
      const ratingInfo = stats._getRatingInfo(game.state.type);

      return { id:t.id, stats, ...ratingInfo };
    });

    teamsMeta.sort((a,b) => game.state.winnerId === a.id ? -1 : game.state.winnerId === b.id ? 1 : 0);

    const isDraw = game.state.winnerId === 'draw';
    const k = computeMaxRatingChange(...teamsMeta.map(t => t.gameCount) as [ number, number ]);
    const ratings = teamsMeta.map(t => t.rating) as [ number, number ];

    for (const [ t, teamMeta ] of teamsMeta.entries()) {
      const team = game.state.teams[teamMeta.id];
      const stats = teamMeta.stats;
      const oldForte = stats.calcForteRating();
      const oldRating = teamMeta.rating;

      stats.setRating(
        game.state.type,
        Math.max(100, _computeElo(...ratings, k[t], isDraw)[t]),
      );

      const newForte = stats.calcForteRating();
      const newRating = stats._getRatingInfo(game.state.type).rating;

      if (newForte)
        team.setRating('FORTE', oldForte, newForte);
      team.setRating(game.state.type, teamMeta.rating, newRating);
    }

    return true;
  }

  get playerId() {
    return this.data.playerId;
  }
  get completed() {
    return this._getMyStats().completed ?? [ 0, 0 ];
  }
  get ratings() {
    const ratingsInfo = this._getRatingsInfo();
    const ratings = new Map([ ...ratingsInfo ].map(([ gtId, ri ]) => [ gtId, {
      rating: Math.round(ri.rating),
      gameCount: ri.gameCount,
    } ]));

    return ratings;
  }

  get(playerId) {
    const stats = this.data.stats.get(playerId) ?? {};
    if (playerId === this.data.playerId && !stats.ratings)
      stats.ratings = new Map();

    return stats;
  }
  getRating(gameTypeId) {
    return Math.round(this._getRatingInfo(gameTypeId).rating);
  }
  setRating(gameTypeId, rating) {
    const ratingInfo = this._getRatingInfo(gameTypeId, true);
    ratingInfo.gameCount++;
    ratingInfo.updatedAt = new Date();
    ratingInfo.rating = rating;

    this.emit('change:setRating');
  }

  calcForteRating() {
    const ratingsInfo = [ ...this._getRatingsInfo().values() ].sort((a,b) => b.rating - a.rating);

    let weight = 1.0;
    let rating = 0;
    for (const ratingInfo of ratingsInfo) {
      if (ratingInfo.gameCount > 9) {
        weight /= 2;
        rating += Math.round(ratingInfo.rating * weight);
      }
    }

    return rating;
  }

  recordGameStart(game) {
    if (!game.state.startedAt)
      throw new Error('Game has not started yet');
    if (game.state.endedAt)
      throw new Error('Game already ended');

    const myTeams = game.state.teams.filter(t => t.playerId === this.data.playerId);
    if (myTeams.length === 0)
      throw new Error(`Game was not played by ${this.data.playerId}`);

    // No stats for practice games.
    if (myTeams.length === game.state.teams.length)
      return;

    const now = Date.now();

    for (const team of game.state.teams) {
      if (!this.data.stats.has(team.playerId)) {
        if (team.playerId === this.data.playerId)
          // Global stats
          this.data.stats.set(team.playerId, {
            // Played X games and abandoned Y games.
            completed: [0, 0],
            ratings: new Map(),
          });
        else
          // Individual stats
          this.data.stats.set(team.playerId, {
            name: team.name,
            aliases: new Map(),
            all: {
              startedAt: now,
              win: [0, 0],
              lose: [0, 0],
              draw: [0, 0],
            },
            style: new Map(),
          });
      }

      if (team.playerId !== this.data.playerId) {
        const stats = this.data.stats.get(team.playerId);

        if (stats.aliases.has(team.name.toLowerCase())) {
          const alias = stats.aliases.get(team.name.toLowerCase());
          alias.name = team.name;
          alias.count++;
          alias.lastSeenAt = now;
        } else {
          stats.aliases.set(team.name.toLowerCase(), {
            name: team.name,
            count: 1,
            lastSeenAt: now,
          });
        }

        if (!stats.style.has(game.state.type)) {
          stats.style.set(game.state.type, {
            startedAt: now,
            win: [0, 0],
            lose: [0, 0],
            draw: [0, 0],
          });
        }
      }
    }

    this.emit('change:recordGameStart');
  }
  recordGameEnd(game) {
    if (!game.state.startedAt)
      throw new Error('Game has not started yet');
    if (!game.state.endedAt)
      throw new Error('Game has not ended');
    // Skip WLD stats for practice games.
    if (game.state.isPracticeMode)
      return;

    const myTeams = game.state.teams.filter(t => t.playerId === this.data.playerId);
    if (myTeams.length === 0)
      throw new Error(`Game was not played by ${this.data.playerId}`);

    /*
     * Determine which players played a turn.
     */
    const playedBy = new Set();
    for (const team of game.state.teams) {
      if (game.state.teamHasPlayed(team))
        playedBy.add(team.playerId);
    }

    for (const [ teamId, team ] of game.state.teams.entries()) {
      if (!this.data.stats.has(team.playerId))
        throw new Error('Game start not recorded');

      const stats = this.data.stats.get(team.playerId);
      /*
       * Collect completed/abandoned game counts for the current player.
       */
      if (team.playerId === this.data.playerId) {
        if (playedBy.has(this.data.playerId)) {
          // I didn't really complete a game if every other player abandoned it.
          if (playedBy.size === 1)
            continue;

          stats.completed[0]++;
        } else {
          stats.completed[1]++;
        }
      /*
       * Collect WLD stats against the opponent.
       */
      } else {
        // If either I or this player abandoned the game, do not collect WLD stats.
        if (!playedBy.has(this.data.playerId) || !playedBy.has(team.playerId))
          continue;

        const myAdvantage = myTeams[0].usedUndo || myTeams[0].usedSim;
        const vsAdvantage = team.usedUndo || team.usedSim;

        if (game.state.winnerId === myTeams[0].id) {
          // If I won with advantage, but they didn't use advantage, win is with advantage.
          const wldIndex = myAdvantage && !vsAdvantage ? 1 : 0;
          stats.all.win[wldIndex]++;
          stats.style.get(game.state.type).win[wldIndex]++;
        } else if (game.state.winnerId === teamId) {
          // If I lost without advantage, but they used advantage, the loss is at disadvantage.
          const wldIndex = vsAdvantage && !myAdvantage ? 1 : 0;
          stats.all.lose[wldIndex]++;
          stats.style.get(game.state.type).lose[wldIndex]++;
        } else if (game.state.winnerId === 'draw') {
          // If I drew with advantage, but they didn't use advantage, draw is with advantage.
          // Note: If we both lost in a 4-player game, we drew with each other.
          const wldIndex = myAdvantage && !vsAdvantage ? 1 : 0;
          stats.all.draw[wldIndex]++;
          stats.style.get(game.state.type).draw[wldIndex]++;
        }
      }
    }

    this.emit('change:recordGameEnd');
  }

  clearWLDStats(playerId, gameTypeId = null) {
    const stats = this.data.stats.get(playerId);

    let wldStats;
    if (gameTypeId) {
      if (!stats.style.has(gameTypeId))
        return;

      wldStats = stats.style.get(gameTypeId);
    } else
      wldStats = stats.all;

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

    this.emit('change:clearWLDStats');
  }

  _getMyStats(persist = false) {
    const stats = this.data.stats.get(this.data.playerId) ?? {
      completed: [ 0, 0 ],
      ratings: new Map(),
    };
    if (persist)
      this.data.stats.set(this.data.playerId, stats);

    return stats;
  }
  _getRatingsInfo(persist = false) {
    const myStats = this._getMyStats(persist);
    const ratingsInfo = myStats.ratings ?? new Map();
    if (persist)
      myStats.ratings = ratingsInfo;

    return ratingsInfo;
  }
  _getRatingInfo(rankingId, persist = false) {
    const ratingsInfo = this._getRatingsInfo(persist);
    const ratingInfo = ratingsInfo.get(rankingId) ?? {
      rating: rankingId === 'FORTE' ? 0 : DEFAULT_RATING,
      gameCount: 0,
      updatedAt: new Date(),
    };
    if (persist)
      ratingsInfo.set(rankingId, ratingInfo);

    return ratingInfo;
  }
};

/*
 * `ranks` is expected to be presorted
 */
export function addForteRank(ranks) {
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
function _probability(rating1, rating2) {
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
function _computeElo(ratingWinner, ratingLoser, K, isDraw) {
  let pWinner = _probability(ratingLoser, ratingWinner);
  let pLoser = _probability(ratingWinner, ratingLoser);

  let ratings = [];
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
function computeMaxRatingChange(gameCount1, gameCount2) {

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
    required: ['playerId', 'stats', 'ratings'],
    properties: {
      playerId: { type: 'string', format: 'uuid' },
      stats: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type: 'string', format: 'uuid' },
            {
              type: 'object',
              oneOf: [
                {
                  required: ['ratings'],
                  properties: {
                    ratings: {
                      type: 'array',
                      subType: 'Map',
                      items: {
                        type: 'array',
                        items: [
                          { type: 'string' },
                          {
                            type: 'string',
                            oneOf: [
                              {
                                required: ['rating'],
                                properties: {
                                  rating: { $ref: '#/definitions/rating' },
                                },
                              },
                            ],
                            additionalProperties: false,
                          },
                        ],
                      },
                    },
                  },
                },
                {
                  required: ['completed'],
                  properties: {
                    completed: { $ref: '#/definitions/statTuple' },
                  },
                },
                {
                  required: ['name', 'aliases', 'all', 'style'],
                  properties: {
                    name: { type: 'string' },
                    aliases: {
                      type: 'array',
                      subType: 'Map',
                      items: {
                        type: 'array',
                        items: [
                          { type: 'string', },
                          {
                            type: 'object',
                            required: ['name', 'count', 'lastSeenAt'],
                            properties: {
                              name: { type: 'string' },
                              count: { type: 'number' },
                              lastSeenAt: { type: 'string', subType: 'Date' },
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
                },
              ],
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
      rating: {
        type: 'object',
        required: ['rating', 'gameCount', 'updatedAt'],
        properties: {
          rating: { type: 'number' },
          gameCount: { type: 'number' },
          updatedAt: { type: 'string', subType: 'Date' },
        },
        additionalProperties: false,
      },
    },
  },
});
