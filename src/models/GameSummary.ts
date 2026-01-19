/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
import serializer from '#utils/serializer.js';
import type Player from '#models/Player.js';

export default class GameSummary {
  protected data: any
  protected _rating?: number | null

  constructor(data) {
    this.data = data;
  }

  static create(game) {
    const data:any = {
      id: game.id,
      type: game.state.type,
      collection: game.collection,
      typeName: game.state.gameType.name,
      createdBy: game.createdBy,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      randomFirstTurn: game.state.randomFirstTurn,
      randomHitChance: game.state.randomHitChance,
      turnStartedAt: game.state.turnStartedAt,
      // This value is only non-null for 5 seconds after a rated game turn ends
      turnEndedAt: game.state.turnEndedAt,
      timeLimitName: game.timeLimitName,
      currentTurnId: game.state.currentTurnId,
      currentTurnTimeLimit: game.state.currentTurnTimeLimit,
      mode: game.isFork ? 'fork' : game.state.isPracticeMode ? 'practice' : game.state.isTournamentMode ? 'tournament' : null,
      rated: game.state.rated,
      teams: game.state.teams.map(t => t && {
        createdAt: t.createdAt,
        joinedAt: t.joinedAt,
        playerId: t.playerId,
        name: t.name,
        ratings: t.ratings,
        set: t.set && { id:t.set.id, name:t.set.name },
      }),
      tags: { ...game.tags },
    };

    if (data.endedAt)
      data.winnerId = game.state.winnerId;
    else if (data.turnStartedAt)
      data.currentTeamId = game.state.currentTeamId;

    return new GameSummary(data);
  }
  static fromJSON(data) {
    data.teams = data.teams.map((t,tId) => t && { ...t, id:tId });
    return new GameSummary(data);
  }

  get id() {
    return this.data.id;
  }
  get type() {
    return this.data.type;
  }
  get collection() {
    return this.data.collection;
  }
  get typeName() {
    return this.data.typeName;
  }
  get randomFirstTurn() {
    return this.data.randomFirstTurn;
  }
  get randomHitChance() {
    return this.data.randomHitChance;
  }
  get turnEndedAt() {
    return this.data.turnEndedAt;
  }
  get timeLimitName() {
    return this.data.timeLimitName;
  }
  get currentTurnId() {
    return this.data.currentTurnId;
  }
  get currentTurnTimeLimit() {
    return this.data.currentTurnTimeLimit;
  }
  get mode() {
    return this.data.mode;
  }
  get rated() {
    return this.data.rated;
  }
  get teams() {
    return this.data.teams;
  }
  get currentTeamId() {
    return this.data.currentTeamId;
  }
  get currentTeam() {
    return this.data.teams[this.data.currentTeamId];
  }
  get tags() {
    return this.data.tags;
  }
  get createdBy() {
    return this.data.createdBy;
  }
  get createdAt() {
    return this.data.createdAt;
  }
  get updatedAt() {
    return this.data.updatedAt;
  }
  get startedAt() {
    return this.data.startedAt;
  }
  get endedAt() {
    return this.data.endedAt;
  }
  get winnerId() {
    return this.data.winnerId;
  }
  get creator() {
    return this.data.teams.filter(t => t?.playerId === this.data.createdBy).sort((a,b) => (
      (a.joinedAt ?? 0) - (b.joinedAt ?? 0)
    ))[0] ?? null;
  }
  get winner() {
    const winnerId = this.data.winnerId;
    return typeof winnerId === 'number' ? this.teams[winnerId] : null;
  }
  get losers() {
    const winner = this.winner;
    return this.teams.filter(t => t !== winner);
  }

  get isOpen() {
    return !this.data.startedAt && this.data.teams.some(t => t === null);
  }
  get isChallenge() {
    return !this.data.startedAt && !this.data.teams.some(t => !t?.playerId);
  }
  get isSimulation() {
    return new Set(this.teams.map(t => t?.playerId)).size === 1;
  }
  /*
   * The game rating is based on the ratings of the two players.  If either
   * player is unrated, then the game is unrated.  If both players are
   * rated, then the game is rated.  The game rating is higher if both
   * players have a higher rating.  The game rating is higher if the two
   * players have roughly the same rating.
   */
  get rating() {
    if (this._rating !== undefined) return this._rating;

    return this._rating = (() => {
      if (!this.data.endedAt || !this.data.rated) return null;
      const [ t1, t2 ] = this.data.teams;
      const r1 = t1.ratings?.get(this.data.type)[0] ?? null;
      if (r1 === null) return null;
      const r2 = t2.ratings?.get(this.data.type)[0] ?? null;
      if (r2 === null) return null;
      const ratio = Math.min(r1, r2) / Math.max(r1, r2);
      return (r1 + r2) / 2 * ratio;
    })();
  }
  get meta() {
    return this.data.meta ?? {};
  }

  getTurnTimeRemaining(now = Date.now()) {
    if (!this.data.startedAt || this.data.endedAt)
      return false;
    if (!this.data.timeLimitName)
      return Infinity;

    const turnTimeLimit = this.data.currentTurnTimeLimit;
    const turnTimeout = this.data.turnStartedAt.getTime() + turnTimeLimit*1000 - Date.now();

    return Math.max(0, turnTimeout);
  }

  equals(gs) {
    if (!(gs instanceof GameSummary))
      return false;

    return JSON.stringify(this) === JSON.stringify(gs);
  }
  cloneWithMeta(meta, player:Player | null = null) {
    const data = this.data.clone();
    if (!this.startedAt)
      for (const team of data.teams)
        if (team && team.set && team.playerId !== player?.id)
          delete team.set;

    return new GameSummary({ ...this.data, meta });
  }

  toJSON() {
    return { ...this.data };
  }
};

serializer.addType({
  name: 'GameSummary',
  constructor: GameSummary,
  schema: {
    type: 'object',
    required: [
      'id', 'type', 'typeName', 'mode', 'rated',
      'randomFirstTurn', 'randomHitChance', 'timeLimitName', 'startedAt',
      'turnStartedAt', 'endedAt', 'teams', 'createdBy', 'createdAt', 'updatedAt',
    ],
    properties: {
      id: { type:'string', format:'uuid' },
      type: { type:'string' },
      typeName: { type:'string' },
      collection: { type:'string' },
      mode: { type:'string', enum:[ 'Fork', 'Practice', 'Tournament' ] },
      rated: { type:[ 'boolean', 'null' ] },
      randomFirstTurn: { type:'boolean' },
      randomHitChance: { type:'boolean' },
      timeLimitName: { type:[ 'string', 'null' ] },
      currentTeamId: { type:'number' },
      startedAt: { type:[ 'string', 'null' ], subType:'Date' },
      turnStartedAt: { type:[ 'string', 'null' ], subType:'Date' },
      endedAt: { type:[ 'string', 'null' ], subType:'Date' },
      winnerId: {
        type: 'string',
        oneOf: [
          { format:'uuid' },
          { enum:[ 'draw', 'truce' ] },
        ],
      },
      teams: {
        type: 'array',
        minItems: 2,
        items: {
          oneOf: [
            { type:'null' },
            {
              type: 'object',
              required: [ 'name', 'joinedAt', 'createdAt' ],
              properties: {
                playerId: { type:'string', format:'uuid' },
                name: { type:'string' },
                ratings: {
                  type: 'array',
                  subType: 'Map',
                  items: {
                    type: 'array',
                    items: [
                      { type:'string' },
                      {
                        type: 'array',
                        items: [
                          { type:'number' },
                          { type:'number' },
                        ],
                        additionalItems: false,
                      },
                    ],
                  },
                },
                joinedAt: { type:[ 'string', 'null' ], subType:'Date' },
                createdAt: { type:'string', subType:'Date' },
              },
              additionalProperties: false,
            },
          ],
        },
      },
      tags: {
        type: 'object',
        additionalProperties: {
          type: [ 'string', 'number', 'boolean' ],
        },
      },
      createdBy: { type:'string', format:'uuid' },
      createdAt: { type:'string', subType:'Date' },
      updatedAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
