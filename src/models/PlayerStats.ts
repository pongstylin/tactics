import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';

const DEFAULT_RATING = 750.0;

export default class PlayerStats extends ActiveModel {
  protected data: {
    playerId: string
    stats: Map<string, any>
    ratings: Map<string, any>
  }

  constructor(data) {
    super();
    this.data = data;
  }

  static create(playerId) {
    return new PlayerStats({
      playerId,
      stats: new Map(),
      ratings: new Map(),
    });
  }

  get playerId() {
    return this.data.playerId;
  }

  get(playerId) {
    return this.data.stats.get(playerId);
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

    const ratings = this.data.ratings;

    // If the rating for this game type does not exist, set it to the default.
    if (!ratings.has(game.state.type)) {
      ratings.set(game.state.type, {
        rating: DEFAULT_RATING,
        lastUpdated: now,
      });
    }

    // If an overall rating does not exist, set it to the default.
    if (!ratings.has("overall")) {
      ratings.set("overall", {
        rating: DEFAULT_RATING,
        lastUpdated: now,
      });
    }

    this.emit('change:recordGameStart');
  }
  recordGameEnd(game) {
    if (!game.state.startedAt)
      throw new Error('Game has not started yet');
    if (!game.state.endedAt)
      throw new Error('Game has not ended');
    // WLD stats are only for rated games.
    if (!game.state.rated)
      return;

    const myTeams = game.state.teams.filter(t => t.playerId === this.data.playerId);
    if (myTeams.length === 0)
      throw new Error(`Game was not played by ${this.data.playerId}`);

    /*
     * Determine which players played a turn.
     */
    // The number of turns excludes the game end turn.
    const currentTurnId = game.state.currentTurnId;
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
};

serializer.addType({
  name: 'PlayerStats',
  constructor: PlayerStats,
  schema: {
    type: 'object',
    required: [ 'playerId', 'stats', 'ratings' ],
    properties: {
      playerId: { type:'string', format:'uuid' },
      ratings: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string' },
            {
              type:'string',
              oneOf: [
                {
                  required: ['rating'],
                  properties: {
                    rating: { type:'number' },
                    lastUpdated: { type:'string', subType:'Date' },
                  },
                },
              ],
              additionalProperties: false,
            },
          ],
        },
      },
      stats: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string', format:'uuid' },
            {
              type: 'object',
              oneOf: [
                {
                  required: [ 'completed' ],
                  properties: {
                    completed: { $ref:'#/definitions/statTuple' },
                  },
                },
                {
                  required: [ 'name', 'aliases', 'all', 'style' ],
                  properties: {
                    name: { type:'string' },
                    aliases: {
                      type: 'array',
                      subType: 'Map',
                      items: {
                        type: 'array',
                        items: [
                          { type:'string', },
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
        items: [ { type:'number' }, { type:'number' } ],
        additionalItems: false,
      },
    },
  },
});
