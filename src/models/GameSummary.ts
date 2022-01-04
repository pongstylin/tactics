/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
import serializer from 'utils/serializer.js';

export default class GameSummary {
  protected data: any

  constructor(data) {
    this.data = data;
  }

  static create(gameType, game) {
    const createdAt = game.createdAt;
    const startedAt = game.state.startedAt;
    const endedAt   = game.state.endedAt;
    const teams   = game.state.teams;
    const actions = game.state.actions;
    const turns   = game.state.turns;

    let updatedAt;
    if (endedAt)
      updatedAt = endedAt;
    else if (actions.length)
      updatedAt = actions.last.createdAt;
    else if (turns.length)
      updatedAt = turns.last.actions.last.createdAt;
    else
      updatedAt = startedAt || createdAt;

    const data:any = {
      id: game.id,
      type: gameType.id,
      collection: game.collection,
      typeName: gameType.name,
      createdBy: game.createdBy,
      createdAt,
      updatedAt,
      startedAt,
      endedAt,
      randomFirstTurn: game.state.randomFirstTurn,
      randomHitChance: game.state.randomHitChance,
      turnStartedAt: game.state.turnStartedAt,
      turnTimeLimit: game.state.turnTimeLimit,
      isFork: game.isFork,
      teams: teams.map(t => t && {
        createdAt: t.createdAt,
        joinedAt: t.joinedAt,
        playerId: t.playerId,
        name: t.name,
      }),
      tags: { ...game.tags },
    };

    if (endedAt)
      data.winnerId = game.state.winnerId;
    else if (startedAt)
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
  get turnTimeLimit() {
    return this.data.turnTimeLimit;
  }
  get isFork() {
    return this.data.isFork;
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
  get turnStartedAt() {
    return this.data.turnStartedAt;
  }
  get endedAt() {
    return this.data.endedAt;
  }
  get winnerId() {
    return this.data.winnerId;
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
      'id', 'type', 'typeName', 'isFork', 'randomFirstTurn',
      'randomHitChance', 'turnTimeLimit', 'startedAt', 'turnStartedAt',
      'endedAt', 'teams', 'createdBy', 'createdAt', 'updatedAt',
    ],
    properties: {
      id: { type:'string', format:'uuid' },
      type: { type:'string' },
      typeName: { type:'string' },
      collection: { type:'string' },
      isFork: { type:'boolean' },
      randomFirstTurn: { type:'boolean' },
      randomHitChance: { type:'boolean' },
      turnTimeLimit: { type:[ 'number', 'null' ] },
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
