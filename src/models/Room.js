import uuid from 'uuid/v4';

export default class Room {
  constructor(data) {
    Object.assign(this, data);
  }

  static create(players, options) {
    if (players.length < 0)
      throw new Error('Requires at least one player');

    options = Object.assign({
      id: uuid(),
    }, options);

    let data = {
      id:       options.id,
      players:  players,
      messages: [],
      created:  new Date(),
    };

    return new Room(data);
  }

  pushMessage(message) {
    this.messages.push(message);
  }

  toJSON() {
    return Object.assign({}, this);
  }
}
