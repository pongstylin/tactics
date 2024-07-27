/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
import serializer from '#utils/serializer.js';

export default class GameSummary {
  protected data: any

  constructor(data) {
    this.data = data;
  }

  static create(gameType, game) {
    const createdAt = game.createdAt;
    const turnStartedAt = game.state.turnStartedAt;
    const endedAt = game.state.endedAt;
    const teams = game.state.teams;
    const actions = game.state.actions;
    const turns = game.state.turns;

    let updatedAt;
    if (endedAt)
      updatedAt = endedAt;
    else if (actions?.length)
      updatedAt = actions.last.createdAt;
    else
      updatedAt = turnStartedAt || createdAt;

    const data:any = {
      id: game.id,
      type: gameType.id,
      collection: game.collection,
      typeName: gameType.name,
      createdBy: game.createdBy,
      createdAt,
      updatedAt,
      startedAt: game.state.startedAt,
      endedAt,
      randomFirstTurn: game.state.randomFirstTurn,
      randomHitChance: game.state.randomHitChance,
      turnStartedAt,
      // This value is only non-null for 5 seconds after a rated game turn ends
      turnEndedAt: game.state.turnEndedAt,
      timeLimitName: game.timeLimitName,
      currentTurnId: game.state.currentTurnId,
      currentTurnTimeLimit: game.state.currentTurnTimeLimit,
      isFork: game.isFork,
      rated: game.state.rated,
      ranked: game.state.ranked,
      teams: teams.map(t => t && {
        createdAt: t.createdAt,
        joinedAt: t.joinedAt,
        playerId: t.playerId,
        name: t.name,
        ratings: t.ratings,
      }),
      tags: { ...game.tags },
    };

    if (endedAt)
      data.winnerId = game.state.winnerId;
    else if (turnStartedAt)
      data.currentTeamId = game.state.currentTeamId;

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
  get isFork() {
    return this.data.isFork;
  }
  get rated() {
    return this.data.rated;
  }
  get ranked() {
    return this.data.ranked;
  }
  get teams() {
    return this.data.teams;
  }
  get currentTeamId() {
    return this.data.currentTeamId;
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
  get winner() {
    const winnerId = this.data.winnerId;
    return typeof winnerId === 'number' ? this.teams[winnerId] : null;
  }
  get losers() {
    const winner = this.winner;
    return this.teams.filter(t => t !== winner);
  }

  /*
   * Properties assigned outside the class.
   */
  get creatorACL() {
    return this.data.creatorACL;
  }
  set creatorACL(creatorACL) {
    this.data.creatorACL = creatorACL;
  }

  get rank() {
    return this.data.rank;
  }
  set rank(rank) {
    this.data.rank = rank;
  }

  getTurnTimeRemaining(now = Date.now()) {
    if (!this.data.startedAt || this.data.endedAt)
      return false;
    if (!this.data.timeLimitName)
      return Infinity;

    const turnTimeLimit = this.data.currentTurnTimeLimit;
    const turnTimeout = (+this.data.turnStartedAt + turnTimeLimit*1000) - now;
    const actionTimeLimit = 10000;
    const actionTimeout = (+this.data.updatedAt + actionTimeLimit) - now;

    return Math.max(0, turnTimeout, actionTimeout);
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
      'id', 'type', 'typeName', 'isFork', 'rated', 'ranked',
      'randomFirstTurn', 'randomHitChance', 'timeLimitName', 'startedAt',
      'turnStartedAt', 'endedAt', 'teams', 'createdBy', 'createdAt', 'updatedAt',
    ],
    properties: {
      id: { type:'string', format:'uuid' },
      type: { type:'string' },
      typeName: { type:'string' },
      collection: { type:'string' },
      isFork: { type:'boolean' },
      rated: { type:'boolean' },
      ranked: { type:'boolean' },
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
