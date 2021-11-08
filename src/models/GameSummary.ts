/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
import serializer from 'utils/serializer.js';

export default class GameSummary {
  constructor(props) {
    Object.assign(this, props);
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

    const props:any = {
      id: game.id,
      type: gameType.id,
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
      isPublic: game.isPublic,
      isFork: !!game.forkOf,
      teams: teams.map(t => t && {
        createdAt: t.createdAt,
        joinedAt: t.joinedAt,
        playerId: t.playerId,
        name: t.name,
      }),
    };

    if (endedAt)
      props.winnerId = game.state.winnerId;
    else if (startedAt)
      props.currentTeamId = game.state.currentTeamId;

    return new GameSummary(props);
  }

  toJSON() {
    return { ...this };
  }
};

serializer.addType({
  name: 'GameSummary',
  constructor: GameSummary,
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema',
    $id: 'GameSummary',
    type: 'object',
    required: [
      'id', 'type', 'typeName', 'isPublic', 'isFork', 'randomFirstTurn',
      'randomHitChance', 'turnTimeLimit', 'startedAt', 'turnStartedAt',
      'endedAt', 'teams', 'createdBy', 'createdAt', 'updatedAt',
    ],
    properties: {
      id: { type:'string', format:'uuid' },
      type: { type:'string' },
      typeName: { type:'string' },
      isPublic: { type:'boolean' },
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
      createdBy: { type:'string', format:'uuid' },
      createdAt: { type:'string', subType:'Date' },
      updatedAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
