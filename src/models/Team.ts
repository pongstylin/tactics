/*
 * Team Lifecycle
 *
 * An OPEN team is null or lacks a playerId.
 * A RESERVED team has a playerId, but a null joinedAt date.
 * A JOINED team has a non-null joinedAt date.
 *
 * A team is joined once these conditions are met:
 *   The team has a playerId.
 *   The team has a name.
 *   The team has a set (even if null / default).
 *   The player explicitly elected to join the team.
 *
 * Game Scenarios
 *
 * A game is started once all teams are JOINED.
 * A pending game typically has one JOINED and one null OPEN team.
 * A pending fork game has one JOINED and one non-null OPEN team.
 * A pending practice game has one JOINED and one RESERVED team.
 * A challenge game may be created with one JOINED and one RESERVED team.
 * A tournament game may be created with 2 RESERVED teams.
 */
import seedrandom from 'seedrandom';

import ActiveModel from '#models/ActiveModel.js';
import ServerError from '#server/Error.js';
import serializer from '#utils/serializer.js';

class Random {
  protected data: {
    count: number
    initial: any
    current: any
  }

  constructor(data) {
    this.data = data;
  }

  static create() {
    const rng = seedrandom(null, { state:true });

    return new Random({
      count: 0,
      initial: rng.state(),
      current: rng,
    });
  }
  static fromJSON(data) {
    return new Random(Object.assign(data, {
      current: seedrandom("", { state:data.current }),
    }));
  }

  generate() {
    return {
      id: ++this.data.count,
      number: this.data.current() * 100,
    };
  }

  toJSON() {
    const json = { ...this.data };
    json.current = json.current.state();

    return json;
  }
};

export default class Team extends ActiveModel {
  protected data: {
    id: number
    slot: number
    createdAt: Date
    joinedAt: Date | null
    checkinAt: Date | null
    checkoutAt: Date | null
    lastActiveAt: Date | null
    playerId: string
    name: string
    position: string
    colorId: any
    useRandom: boolean
    randomState: Random
    set: any[] | string | boolean
    randomSide: boolean
    bot: any
    usedUndo: boolean
    usedSim: boolean
    forkOf: any
    ratings: Map<string, [ number, number ]>
  }
  public isCurrent: boolean = false
  public units: any[][] | null = null;

  constructor(data, props?:ConstructorParameters<typeof ActiveModel>[0]) {
    super(props);
    this.data = Object.assign({
      // The position of the team in the teams array post game start
      id: null,

      // The position of the team in the teams array pre game start
      slot: null,

      // The date the team was created
      createdAt: null,

      // The date the player joined the team
      joinedAt: null,

      // The date the player last opened the game
      checkinAt: null,

      // The date the player last closed the game.
      checkoutAt: null,

      // The date the player last actively viewed the game.
      lastActiveAt: null,

      // The account ID associated with the team, if any
      playerId: undefined,

      // The display name for the team
      name: null,

      // The color for the team.  Usually colors are defined client-side.
      colorId: undefined,

      // The position of the team on the board
      position: null,

      // Whether chance-to-hit should use random numbers
      useRandom: true,

      // The random number generator to see if a unit in the team will hit
      // Not applicable to games that don't use random numbers.
      randomState: undefined,

      // The set the team used at start of game.
      set: undefined,

      // Whether to randomize the side the set is placed on at game start
      randomSide: false,

      // The bot, if any, controlling the team
      bot: undefined,

      // Flags for determining if the team had an advantage
      usedUndo: undefined,
      usedSim: undefined,

      // If applicable, before and after views of the player's ratings.
      ratings: null,
    }, data);

    if (this.data.useRandom && !this.data.randomState)
      this.data.randomState = Random.create();
  }

  static validateSet(data, game, gameType) {
    if (typeof data.set === 'object') {
      if (!gameType.isCustomizable)
        throw new ServerError(403, 'May not define a custom set in this game type');

      if (data.set.units)
        data.set = gameType.applySetUnitState(gameType.validateSet(data.set));
      else
        throw new ServerError(400, 'Required set units');
    } else if (typeof data.set === 'string') {
      const firstTeam = game.state.teams.filter(t => !!t?.joinedAt).sort((a,b) => a.joinedAt - b.joinedAt)[0];

      if (data.set === 'same') {
        if (game.state.rated)
          throw new ServerError(403, `May not use same set for rated games.`);
        if (game.state.teams.length !== 2)
          throw new ServerError(403, `May only use the 'same' set option for 2-player games`);
        if (!firstTeam || firstTeam.slot === data.slot)
          throw new ServerError(403, `May not use the 'same' set option on the first team to join the game`);

        if (!gameType.isCustomizable)
          data.set = null;
      } else if (data.set === 'mirror') {
        if (game.state.rated)
          throw new ServerError(403, `May not use mirror set for rated games.`);
        if (game.state.teams.length !== 2)
          throw new ServerError(403, `May only use the 'mirror' set option for 2-player games`);
        if (!firstTeam || firstTeam.slot === data.slot)
          throw new ServerError(403, `May not use the 'mirror' set option on the first team to join the game`);
        if (gameType.hasFixedPositions)
          throw new ServerError(403, `May not use the 'mirror' set option for opp-side game styles`);
        if (!gameType.isCustomizable)
          throw new ServerError(403, `May not use the 'mirror' set option for fixed set styles`);
      } else if (!gameType.isCustomizable) {
        if (data.set !== 'random' && data.set !== 'default')
          throw new ServerError(403, `Must use the 'default' set for fixed set styles`);
        data.set = null;
      }
    }

    if (data.randomSide && gameType.hasFixedPositions)
      throw new ServerError(403, 'May not randomize side in this game type');

    return data.set;
  }

  static create(data) {
    if (typeof data.slot !== 'number')
      throw new TypeError('Required slot');

    data.createdAt = new Date();

    return new Team(data, { isClean:false, isPersisted:false });
  }
  static createReserve(data, clientPara) {
    if (data.set)
      throw new ServerError(403, 'May not assign a set to a reserved team');

    return Team.create(data);
  }
  static createJoin(data, clientPara, game, gameType) {
    return Team.create({ slot:data.slot }).join(data, clientPara, game, gameType);
  }

  get id() {
    return this.data.id;
  }
  set id(id) {
    if (this.data.id === id)
      return;

    this.data.id = id;
    this.emit('change:id');
  }
  get slot() {
    return this.data.slot;
  }
  get playerId() {
    return this.data.playerId;
  }
  get name() {
    return this.data.name;
  }
  get set() {
    return this.data.set;
  }
  set set(set) {
    if (this.data.set === set)
      return;

    this.data.set = set;
    this.emit('change:set');
  }
  get randomSide() {
    return this.data.randomSide;
  }
  get position() {
    return this.data.position;
  }
  set position(position) {
    if (this.data.position === position)
      return;

    this.data.position = position;
    this.emit('change:position');
  }
  get colorId() {
    return this.data.colorId;
  }
  set colorId(colorId) {
    if (this.data.colorId === colorId)
      return;

    this.data.colorId = colorId;
    this.emit('change:colorId');
  }
  get useRandom() {
    return this.data.useRandom;
  }
  set useRandom(useRandom) {
    if (this.data.useRandom === useRandom)
      return;

    this.data.useRandom = useRandom;
    this.emit('change:useRandom');
  }
  get forkOf() {
    return this.data.forkOf;
  }
  get bot() {
    return this.data.bot;
  }
  /*
   * Used to set bot to 'false' in the Chaos challenge
   */
  set bot(bot) {
    if (this.data.bot === bot)
      return;

    this.data.bot = bot;
    this.emit('change:bot');
  }
  get usedUndo() {
    return this.data.usedUndo === true;
  }
  get usedSim() {
    return this.data.usedSim === true;
  }
  get ratings() {
    return this.data.ratings;
  }
  get createdAt() {
    return this.data.createdAt;
  }
  get joinedAt() {
    return this.data.joinedAt;
  }
  get checkinAt() {
    return this.data.checkinAt;
  }
  set checkinAt(checkinAt) {
    if (this.data.checkinAt?.getTime() === checkinAt?.getTime())
      return;

    this.data.checkinAt = checkinAt;
    this.emit('change:checkinAt');
  }
  get checkoutAt() {
    return this.data.checkoutAt;
  }
  set checkoutAt(checkoutAt) {
    if (this.data.checkoutAt?.getTime() === checkoutAt?.getTime())
      return;

    this.data.checkoutAt = checkoutAt;
    this.emit('change:checkoutAt');
  }
  get lastActiveAt() {
    return this.data.lastActiveAt;
  }
  set lastActiveAt(lastActiveAt) {
    if (this.data.lastActiveAt?.getTime() === lastActiveAt?.getTime())
      return;

    this.data.lastActiveAt = lastActiveAt;
    this.emit('change:lastActiveAt');
  }

  /*
   * Determine if a team has checked in since a given dateStart.
   * Optionally, we can set a cut-off dateEnd instead of current date.
   */
  seen(dateStart:Date | number, dateEnd?:Date | number) {
    if (!dateStart)
      return false;

    if (dateStart instanceof Date)
      dateStart = dateStart.getTime();
    if (dateEnd instanceof Date)
      dateEnd = dateEnd.getTime();

    if (this.checkinAt === null)
      return false;

    return (Number as any).rangeOverlaps(
      this.checkinAt.getTime(),
      this.checkoutAt?.getTime() ?? Date.now(),
      dateStart,
      dateEnd ?? Date.now(),
    );
  }

  setUsedUndo() {
    if (this.data.usedUndo)
      return;

    this.data.usedUndo = true;
    this.emit('change:usedUndo');
  }
  setUsedSim() {
    if (this.data.usedSim)
      return;

    this.data.usedSim = true;
    this.emit('change:usedSim');
  }
  setRating(rankingId, oldRating, newRating) {
    if (
      this.data.ratings?.has(rankingId) &&
      this.data.ratings.get(rankingId)![0] === oldRating &&
      this.data.ratings.get(rankingId)![1] === newRating
    ) return;

    if (!this.data.ratings)
      this.data.ratings = new Map();
    this.data.ratings.set(rankingId, [ oldRating, newRating ]);
    this.emit('change:setRating');
  }

  fork(props) {
    return Team.create(Object.assign({
      slot: this.data.slot,
      forkOf: { playerId:this.data.playerId, name:this.data.name },
      useRandom: this.data.useRandom,
      set: this.data.set,
    }, props));
  }

  reserve(data) {
    this.data.playerId = data.playerId;
    this.data.name = data.name ?? null;
  }
  join(data, clientPara, game = null, gameType = null) {
    if (this.data.joinedAt)
      throw new ServerError(409, 'This team has already been joined');
    if (this.data.playerId && this.data.playerId !== clientPara.playerId)
      throw new ServerError(403, 'This team is reserved');

    if (data.set) {
      if (this.data.forkOf)
        throw new ServerError(403, 'May not assign a set to a forked team');
      data.set = Team.validateSet(data, game, gameType);
    }

    this.data.joinedAt = new Date();
    this.data.playerId = clientPara.playerId;
    this.data.name = data.name ?? clientPara.name;
    this.data.set = data.set ?? this.data.set ?? null;
    this.data.randomSide = data.randomSide ?? this.data.randomSide;

    return this;
  }

  random() {
    if (!this.data.useRandom)
      throw new TypeError('May not use random');

    if (!this.data.randomState)
      return { number:Math.random() * 100 };

    return this.data.randomState.generate();
  }

  clone() {
    return new Team(this.data);
  }
  merge(teamData) {
    // @ts-ignore
    this.data.merge(teamData);
    return this;
  }

  /*
   * This method is used to send data from the server to the client.
   */
  getData(withSet = false) {
    const json = { ...this.data } as any;

    // Only indicate presence or absence of a set, not the set itself
    if (!withSet)
      json.set = !!json.set;

    delete json.lastActiveAt;
    delete json.randomState;

    return json;
  }

  /*
   * This method is used to persist the team for storage.
   */
  toJSON() {
    const json = { ...this.data } as any;

    if (json.useRandom === true)
      delete json.useRandom;
    if (json.randomSide === false)
      delete json.randomSide;
    if (json.ratings === null)
      delete json.ratings;

    if (json.checkinAt === null)
      delete json.checkinAt;
    if (json.checkoutAt === null)
      delete json.checkoutAt;
    if (json.lastActiveAt === null)
      delete json.lastActiveAt;

    return json;
  }
}

serializer.addType({
  name: 'Random',
  constructor: Random,
  schema: {
    type: 'object',
    properties: {
      count: { type:'number', minimum:0 },
      initial: { $ref:'#/definitions/randomState' },
      current: { $ref:'#/definitions/randomState' },
    },
    required: [ 'count', 'initial', 'current' ],
    definitions: {
      randomState: { type:'object' },
    },
  },
});
serializer.addType({
  name: 'Team',
  constructor: Team,
  schema: {
    type: 'object',
    required: [ 'id', 'slot', 'name', 'position', 'joinedAt', 'createdAt' ],
    properties: {
      id: { type:'number' },
      slot: { type:'number' },
      playerId: { type:'string', format:'uuid' },
      name: { type:[ 'string', 'null' ] },
      set: {
        type:'object',
        properties: {
          units: {
            oneOf: [
              // Server-side
              { type:'object' },
              // Client-side, sometimes
              { type:'boolean' },
            ],
          },
        },
        required: [ 'units' ],
        additionalProperties: false,
      },
      randomSide: { type:'boolean' },
      bot: { type:'boolean' },
      colorId: { type:'number' },
      position: { type:[ 'string', 'null' ], enum:['N','S','E','W','C'] },
      useRandom: { type:'boolean' },
      randomState: { $ref:'Random' },
      usedUndo: { type:'boolean', const:true },
      usedSim: { type:'boolean', const:true },
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
      checkinAt: { type:[ 'string', 'null' ], subType:'Date' },
      checkoutAt: { type:[ 'string', 'null' ], subType:'Date' },
      lastActiveAt: { type:[ 'string', 'null' ], subType:'Date' },
      createdAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
