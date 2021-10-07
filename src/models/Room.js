import uuid from 'uuid/v4';

import ActiveModel from 'models/ActiveModel.js';

export default class Room extends ActiveModel {
  static create(players, options) {
    if (players.length < 0)
      throw new Error('Requires at least one player');

    options = Object.assign({
      id: uuid(),
    }, options);

    const data = {
      id:        options.id,
      players:   players,
      events:    [],
      createdAt: new Date(),
    };

    let eventId = 1;

    players.forEach(player => {
      player.joinedAt = data.createdAt;
      player.lastSeenEventId = 0;

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

    const events = this.events;

    events.push(Object.assign(message, {
      id: events.last.id + 1,
      type: 'message',
      createdAt: new Date(),
    }));

    this.emit('change:pushMessage');

    this.seenEvent(message.player.id, events.last.id);
  }
  seenEvent(playerId, eventId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player)
      throw new Error('The player ID does not exist in this room');

    if (eventId > this.events.last.id)
      eventId = this.events.last.id;
    if (eventId === player.lastSeenEventId)
      return;

    player.lastSeenEventId = eventId;

    this.emit('change:seenEvent');
  }
}
