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
        lastSeenEventId: 0,
        createdAt: data.createdAt,
      });
    });

    return new Room(data);
  }

  static load(data) {
    if (typeof data.createdAt === 'string')
      data.createdAt = new Date(data.createdAt);

    data.events.forEach(evt => {
      if (typeof evt.createdAt === 'string')
        evt.createdAt = new Date(evt.createdAt);
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
      id: events.last.id + 1,
      type: 'message',
      createdAt: new Date(),
    }));

    this.seenEvent(message.player.id, events.last.id);
  }
  seenEvent(playerId, eventId) {
    let player = this.players.find(p => p.id === playerId);
    if (!player)
      throw new Error('The player ID does not exist in this room');

    player.lastSeenEventId = eventId;
  }

  toJSON() {
    return Object.assign({}, this);
  }
}
