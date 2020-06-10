import seedrandom from 'seedrandom';

export default class Team {
  constructor(data) {
    Object.assign(this, {
      // The position of the team in the teams array post game start
      id: null,

      // The position of the team in the teams array pre game start
      slot: null,

      // The date the team joined the game
      createdAt: null,

      // The account ID associated with the team, if any
      playerId: undefined,

      // The display name for the team
      name: null,

      // The color for the team.  Usually colors are defined client-side.
      colorId: undefined,

      // The position of the team on the board
      position: null,

      // The random number generator to see if a unit in the team will hit
      // Not applicable to games that don't use random numbers.
      randomState: undefined,

      // The set the team used at start of game.
      set: null,

      // The current state of units for the team
      units: null,

      // The bot, if any, controlling the team
      bot: undefined,
    }, data);
  }

  static create(data) {
    data.createdAt = new Date();

    return new Team(data);
  }

  static load(data) {
    if (typeof data.createdAt === 'string')
      data.createdAt = new Date(data.createdAt);
    if (data.randomState)
      data.randomState.current = seedrandom("", { state:data.randomState.current });

    return new Team(data);
  }

  random() {
    if (!this.randomState)
      return { number:Math.random() * 100 };

    return {
      id: ++this.randomState.count,
      number: this.randomState.current() * 100,
    };
  }

  createRandom() {
    if (this.randomState)
      throw new TypeError('Already created RNG');

    let rng = seedrandom(null, { state:true });
    let rngState = rng.state();

    this.randomState = {
      // Number of times random() has been called.
      count: 0,

      // The initial rng state used for manual validation purposes.
      initial: rngState,

      current: seedrandom("", { state:rngState }),
    };
  }

  /*
   * This method is used to send data from the server to the client.
   */
  getData() {
    let json = {...this};

    // Only indicate presence or absence of a set, not the set itself
    json.set = !!json.set;

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
