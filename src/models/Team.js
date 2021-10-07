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

function createRandom() {
  let rng = seedrandom(null, { state:true });
  let rngState = rng.state();

  return {
    // Number of times random() has been called.
    count: 0,

    // The initial rng state used for manual validation purposes.
    initial: rngState,

    current: seedrandom("", { state:rngState }),
  };
};

export default class Team {
  constructor(data) {
    Object.assign(this, {
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

      // The set the team used at start of game.
      set: undefined,

      // The current state of units for the team
      units: null,

      // The bot, if any, controlling the team
      bot: undefined,
    }, data);

    if (this.useRandom && !this.randomState)
      this.randomState = createRandom();
  }

  static validateSet(data, game, gameType) {
    if (typeof data.set === 'object') {
      if (data.set.units) {
        if (!gameType.isCustomizable)
          throw new ServerError(403, 'May not define a set in this game type');

        data.set = gameType.applySetUnitState(gameType.validateSet(data.set));
      } else if (data.set.name) {
        if (!gameType.isCustomizable && data.set.name !== 'default')
          throw new ServerError(403, `Must use the 'default' set for fixed set styles`);

        data.set = { name:data.set.name };
      } else
        throw new ServerError(400, 'Unrecognized set option value');
    } else if (typeof data.set === 'string') {
      let firstTeam = game.state.teams.filter(t => !!t?.joinedAt).sort((a,b) => a.joinedAt - b.joinedAt)[0];

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
      } else
        throw new ServerError(400, 'Unrecognized set option value');
    }

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

    if (data.name !== undefined && data.name !== null)
      throw new ServerError(403, 'May not assign a name to a reserved team');
    if (data.set)
      throw new ServerError(403, 'May not assign a set to a reserved team');

    return Team.create(data);
  }
  static createJoin(data, clientPara, game, gameType) {
    return Team.create({ slot:data.slot }).join(data, clientPara, game, gameType);
  }

  static load(data) {
    if (typeof data.createdAt === 'string')
      data.createdAt = new Date(data.createdAt);
    if (typeof data.joinedAt === 'string')
      data.joinedAt = new Date(data.joinedAt);
    if (typeof data.checkoutAt === 'string')
      data.checkoutAt = new Date(data.checkoutAt);
    if (data.randomState)
      data.randomState.current = seedrandom("", { state:data.randomState.current });

    return new Team(data);
  }

  fork() {
    return new Team({
      createdAt: new Date(),
      id: this.id,
      slot: this.slot,
      position: this.position,
      forkOf: { playerId:this.playerId, name:this.name },
      useRandom: this.useRandom,
    });
  }

  join(data, clientPara, game = null, gameType = null) {
    if (this.joinedAt)
      throw new ServerError(409, 'This team has already been joined');
    if (this.playerId && this.playerId !== clientPara.playerId)
      throw new ServerError(403, 'This team is reserved');

    if (data.set) {
      if (this.forkOf)
        throw new ServerError(403, 'May not assign a set to a forked team');
      data.set = Team.validateSet(data, game, gameType);
    }
    else
      data.set = null;

    this.joinedAt = new Date();
    this.playerId = clientPara.playerId;
    this.name = data.name ?? clientPara.name;
    this.set = data.set;

    return this;
  }

  random() {
    if (!this.useRandom)
      throw new TypeError('May not use random');

    if (!this.randomState)
      return { number:Math.random() * 100 };

    return {
      id: ++this.randomState.count,
      number: this.randomState.current() * 100,
    };
  }

  /*
   * This method is used to send data from the server to the client.
   */
  getData() {
    let json = {...this};

    // Only indicate presence or absence of a set, not the set itself
    json.set = !!json.set;

    delete json.checkoutAt;
    delete json.randomState;
    delete json.units;

    return json;
  }

  /*
   * This method is used to persist the team for storage.
   */
  toJSON() {
    let json = {...this};

    if (json.randomState) {
      json.randomState = {...json.randomState};
      json.randomState.current = json.randomState.current.state();
    }

    delete json.units;

    return json;
  }
}
