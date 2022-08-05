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

import ServerError from 'server/Error.js';
import serializer from 'utils/serializer.js';

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

export default class Team {
  protected data: {
    id: number
    slot: number
    createdAt: Date
    joinedAt: Date | null
    checkoutAt: Date | null
    playerId: string
    name: string
    position: string
    colorId: any
    useRandom: boolean
    randomState: Random
    turnTimeBuffer: number
    set: any[] | string | boolean
    randomSide: boolean
    bot: any
    usedUndo: boolean
    usedSim: boolean
    forkOf: any
  }
  units: any[][]

  constructor(data) {
    this.data = Object.assign({
      // The position of the team in the teams array post game start
      id: null,

      // The position of the team in the teams array pre game start
      slot: null,

      // The date the team was created
      createdAt: null,

      // The date the player joined the team
      joinedAt: null,

      // The date the player last viewed the game.
      checkoutAt: null,

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

      // The number of seconds accumulated in the turn time limit buffer.
      turnTimeBuffer: 0,

      // The set the team used at start of game.
      set: undefined,

      // Whether to randomize the side the set is placed on at game start
      randomSide: false,

      // The current state of units for the team
      units: null,

      // The bot, if any, controlling the team
      bot: undefined,

      // Flags for determining if the team had an advantage
      usedUndo: undefined,
      usedSim: undefined,
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
        if (game.state.teams.length !== 2)
          throw new ServerError(403, `May only use the 'same' set option for 2-player games`);
        if (!firstTeam || firstTeam.slot === data.slot)
          throw new ServerError(403, `May not use the 'same' set option on the first team to join the game`);

        if (!gameType.isCustomizable)
          data.set = null;
      } else if (data.set === 'mirror') {
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

    return new Team(data);
  }
  static createReserve(data, clientPara) {
    if (!data.playerId)
      data.playerId = clientPara.playerId;

    if (data.name !== undefined)
      throw new ServerError(403, 'May not assign a name to a reserved team');
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
    this.data.id = id;
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
    this.data.set = set;
  }
  get randomSide() {
    return this.data.randomSide;
  }
  get position() {
    return this.data.position;
  }
  set position(position) {
    this.data.position = position;
  }
  get colorId() {
    return this.data.colorId;
  }
  set colorId(colorId) {
    this.data.colorId = colorId;
  }
  get useRandom() {
    return this.data.useRandom;
  }
  set useRandom(useRandom) {
    this.data.useRandom = useRandom;
  }
  get turnTimeBuffer() {
    return this.data.turnTimeBuffer;
  }
  set turnTimeBuffer(turnTimeBuffer) {
    this.data.turnTimeBuffer = turnTimeBuffer;
  }
  get forkOf() {
    return this.data.forkOf;
  }
  get bot() {
    return this.data.bot;
  }
  /*
   * Used to set bot to 'false' in the Chaos hallenge
   */
  set bot(bot) {
    this.data.bot = bot;
  }
  get usedUndo() {
    return this.data.usedUndo === true;
  }
  get usedSim() {
    return this.data.usedSim === true;
  }
  get createdAt() {
    return this.data.createdAt;
  }
  get joinedAt() {
    return this.data.joinedAt;
  }
  get checkoutAt() {
    return this.data.checkoutAt;
  }
  set checkoutAt(checkoutAt) {
    this.data.checkoutAt = checkoutAt;
  }

  setUsedUndo() {
    this.data.usedUndo = true;
  }
  setUsedSim() {
    this.data.usedSim = true;
  }

  fork() {
    return new Team({
      createdAt: new Date(),
      id: this.data.id,
      slot: this.data.slot,
      position: this.data.position,
      forkOf: { playerId:this.data.playerId, name:this.data.name },
      useRandom: this.data.useRandom,
      set: this.data.set,
    });
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

  /*
   * This method is used to send data from the server to the client.
   */
  getData(withSet = false) {
    const json = { ...this.data };

    // Only indicate presence or absence of a set, not the set itself
    if (!withSet)
      json.set = !!json.set;

    delete json.checkoutAt;
    delete json.randomState;
    delete json.turnTimeBuffer;
    delete json.randomSide;

    return json;
  }

  /*
   * This method is used to persist the team for storage.
   */
  toJSON() {
    const json = { ...this.data };

    if (json.useRandom === true)
      delete json.useRandom;
    if (json.turnTimeBuffer === 0)
      delete json.turnTimeBuffer;
    if (json.randomSide === false)
      delete json.randomSide;

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
    required: [ 'id', 'slot', 'name', 'position', 'joinedAt', 'checkoutAt', 'createdAt' ],
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
      joinedAt: { type:[ 'string', 'null' ], subType:'Date' },
      checkoutAt: { type:[ 'string', 'null' ], subType:'Date' },
      createdAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
