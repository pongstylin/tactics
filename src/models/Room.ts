import { v4 as uuid } from 'uuid';

import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';

type Player = {
  id: string;
  name: string;
  joinedAt?: Date;
  lastSeenEventId?: number;
};
type Event = {
  id: number
  type: 'join' | 'message'
  player: Player
  createdAt: Date
};

export default class Room extends ActiveModel {
  protected data: {
    id: string;
    applyRules: boolean;
    players: Player[];
    events: Event[];
    createdAt: Date;
  };

  constructor(data) {
    super();
    this.data = {
      applyRules: true,

      ...data,
    };
  }

  static create(players:Pick<Player, 'id' | 'name'>[], options:Partial<{ id:string, applyRules:boolean }>) {
    if (players.length < 0)
      throw new Error('Requires at least one player');

    options = Object.assign({
      id: uuid(),
      applyRules: true,
    }, options);

    const data = {
      id: options.id,
      applyRules: options.applyRules,
      players: players,
      events: [] as Event[],
      createdAt: new Date(),
    };

    let eventId = 1;

    data.players = players.map(player => Object.assign({
      joinedAt: data.createdAt,
      lastSeenEventId: 0,
    }, player));

    for (const player of data.players)
      data.events.push({
        id: eventId++,
        type: 'join',
        player: player,
        createdAt: data.createdAt,
      });

    return new Room(data);
  }

  get id() {
    return this.data.id;
  }
  get applyRules() {
    return this.data.applyRules;
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
      id: (events as any).last.id + 1,
      type: 'message',
      createdAt: new Date(),
    }));

    this.emit('change:pushMessage');

    this.seenEvent(message.player.id, (events as any).last.id);
  }
  seenEvent(playerId, eventId) {
    const player = this.data.players.find(p => p.id === playerId);
    if (!player)
      throw new Error('The player ID does not exist in this room');

    if (eventId > (this.data.events as any).last.id)
      eventId = (this.data.events as any).last.id;
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
    required: [ 'id', 'applyRules', 'players', 'events', 'createdAt' ],
    properties: {
      id: { type:'string', format:'uuid' },
      applyRules: { type:'boolean' },
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
