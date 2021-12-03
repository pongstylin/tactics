import uuid from 'uuid/v4';

import ActiveModel from 'models/ActiveModel.js';
import serializer from 'utils/serializer.js';

export default class Room extends ActiveModel {
  protected data: {
    id: string
    players: any[]
    events: any
    createdAt: Date
  }

  constructor(data) {
    super();
    this.data = data;
  }

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

  get id() {
    return this.data.id;
  }
  get players() {
    return this.data.players;
  }
  get events() {
    return this.data.events;
  }

  pushMessage(message) {
    if (!message.player)
      throw new Error('Required player');
    if (!message.content)
      throw new Error('Required content');

    const events = this.data.events;

    events.push(Object.assign(message, {
      id: events.last.id + 1,
      type: 'message',
      createdAt: new Date(),
    }));

    this.emit('change:pushMessage');

    this.seenEvent(message.player.id, events.last.id);
  }
  seenEvent(playerId, eventId) {
    const player = this.data.players.find(p => p.id === playerId);
    if (!player)
      throw new Error('The player ID does not exist in this room');

    if (eventId > this.data.events.last.id)
      eventId = this.data.events.last.id;
    if (eventId === player.lastSeenEventId)
      return;

    player.lastSeenEventId = eventId;

    this.emit('change:seenEvent');
  }
};

serializer.addType({
  name: 'Room',
  constructor: Room,
  schema: {
    type: 'object',
    required: [ 'id', 'players', 'events', 'createdAt' ],
    properties: {
      id: { type:'string', format:'uuid' },
      players: {
        type: 'array',
        items: { $ref:'#/definitions/player' },
      },
      events: {
        type: 'array',
        items: {
          type: 'object',
          required: [ 'id', 'type', 'player', 'createdAt' ],
          properties: {
            id: { type:'number', minimum:0 },
            type: { type:'string', enum:[ 'join', 'message' ] },
            player: { $ref:'#/definitions/player' },
            createdAt: { type:'string', subType:'Date' },
          },
          additionalProperties: false,
        },
      },
      createdAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
    definitions: {
      player: {
        type: 'object',
        required: [ 'id', 'name', 'joinedAt', 'lastSeenEventId' ],
        properties: {
          id: { type:'string' },
          name: { type:'string' },
          joinedAt: { type:'string', subType:'Date' },
          lastSeenEventId: { type:'number', minimum:0 },
        },
        additionalProperties: false,
      },
    },
  },
});
