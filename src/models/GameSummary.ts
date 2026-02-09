/*
 * This model is used to generate JSON with a summary of a game.
 * The summary can be used to render a game in a list.
 */
// @ts-ignore
import serializer from '#utils/serializer.js';
import type Game from '#models/Game.js';
import type GameState from '#tactics/GameState.js';
import type GameType from '#tactics/GameType.js';
import type Player from '#models/Player.js';
import type Team from '#models/Team.js';
import type TeamSet from '#models/TeamSet.js';

export default class GameSummary {
  protected data: {
    id: Game['id'],
    type: NonNullable<GameState['type']>,
    collection: Game['collection'],
    typeName: GameType['name'],
    createdBy: Game['createdBy'],
    createdAt: Game['createdAt'],
    updatedAt: Game['updatedAt'],
    startedAt: Game['startedAt'],
    endedAt: Game['endedAt'],
    randomFirstTurn: GameState['randomFirstTurn'],
    randomHitChance: GameState['randomHitChance'],
    turnStartedAt: GameState['turnStartedAt'],
    turnEndedAt: GameState['turnEndedAt'],
    timeLimitName: Game['timeLimitName'],
    currentTurnId: GameState['currentTurnId'],
    currentTurnTimeLimit: GameState['currentTurnTimeLimit'],
    mode: 'fork' | 'practice' | 'tournament' | null,
    rated: GameState['rated'],
    teams: {
      id: number,
      createdAt: Team['createdAt'],
      joinedAt: Team['joinedAt'],
      playerId: Team['playerId'],
      name: Team['name'],
      ratings: Team['ratings'],
      set?: Pick<TeamSet, 'id' | 'name'>,
      setVia: Team['setVia'],
    }[],
    tags: Game['tags'],

    winnerId?: GameState['winnerId'],
    currentTeamId?: GameState['currentTeamId'],
    meta?: object;
  };
  protected _rating?: number | null

  constructor(data:GameSummary['data']) {
    this.data = data;
  }

  static create(game:Game) {
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
        id: t.id,
        createdAt: t.createdAt,
        joinedAt: t.joinedAt,
        playerId: t.playerId,
        name: t.name,
        ratings: t.ratings,
        // t.set can be null if it is being hidden
        // t.set.id can be null for fork games
        set: t.set?.id ? { id:t.set.id, name:t.set.name } : undefined,
        setVia: t.setVia,
      }),
      tags: { ...game.tags },
    };

    if (data.endedAt)
      data.winnerId = game.state.winnerId;
    else if (data.turnStartedAt)
      data.currentTeamId = game.state.currentTeamId;

    return new GameSummary(data);
  }
  static fromJSON(data:GameSummary['data']) {
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
    return this.data.currentTeamId && this.data.teams[this.data.currentTeamId];
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
      (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0)
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
      const r1 = t1.ratings?.get(this.data.type)?.[0] ?? null;
      if (r1 === null) return null;
      const r2 = t2.ratings?.get(this.data.type)?.[0] ?? null;
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
    const turnTimeout = this.data.turnStartedAt!.getTime() + turnTimeLimit!*1000 - now;

    return Math.max(0, turnTimeout);
  }

  equals(gs:GameSummary) {
    if (!(gs instanceof GameSummary))
      return false;

    return JSON.stringify(this) === JSON.stringify(gs);
  }
  cloneWithMeta(meta:object, player:Player | null = null) {
    const data = this.data.clone();
    // Do not reveal your opponent's set until you have played a turn in the game (or it ends).
    if (![ 'fork', 'practice' ].includes(this.data.mode ?? ''))
      if (!this.startedAt || (!this.endedAt && this.data.currentTurnId! < 4))
        for (const team of data.teams)
          if (team && team.set && (team.playerId !== player?.id || team.setVia === 'top'))
            delete team.set;

    return new GameSummary({ ...data, meta });
  }

  toJSON() {
    const data = this.data.clone() as any;
    for (const team of data.teams)
      if (team)
        delete team.id;

    return data;
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
