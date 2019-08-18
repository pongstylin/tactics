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
      id:        options.id,
      players:   players,
      events:    [],
      createdAt: new Date(),
    };

    let eventId = 1;

    players.forEach(player => {
      player.joinedAt = data.createdAt;

      data.events.push({
        id: eventId++,
        type: 'join',
        player: player,
        createdAt: data.createdAt,
      });
    });

    return new Room(data);
  }

  static load(data) {
    if (typeof data.createdAt === 'string')
      data.createdAt = new Date(data.createdAt);

    data.events.forEach(event => {
      if (typeof event.createdAt === 'string')
        data.createdAt = new Date(event.createdAt);
    });

    return new Room(data);
  }

  pushMessage(message) {
    if (!message.player)
      throw new Error('Required player');
    if (!message.content)
      throw new Error('Required content');

    let events = this.events;

    events.push(Object.assign(message, {
      id: ++events.last.id,
      type: 'message',
      createdAt: new Date(),
    }));
  }

  toJSON() {
    return Object.assign({}, this);
  }
}
