import ActiveModel from '#models/ActiveModel.js';
import type Player from '#models/Player.js';
import TeamSet from '#models/TeamSet.js';
import serializer from '#utils/serializer.js';

import setsBySlot, { type Slot } from '#config/sets.js';
import ServerError from '#server/Error.js';

import GameType from '#tactics/GameType.js';

type PlayerSet = {
  id: string; // Unique identifier for the set
  name: string;
  units: {
    type: string;
    assignment: [number, number];
    direction?: 'N' | 'E' | 'S' | 'W';
  }[];
  gameTypeId: string; // GameTypeId
  slot: Slot;
  createdAt: Date;
};

export default class PlayerSets extends ActiveModel {
  protected data: {
    playerId: string;
    sets: PlayerSet[];
  };
  public player: Player | null = null;

  constructor(data) {
    super();
    this.data = data;
  }

  static create(playerId) {
    return new PlayerSets({
      playerId,
      sets: [],
    });
  }

  get playerId() {
    return this.data.playerId;
  }

  values() {
    return this.data.sets.values();
  }

  list(gameType:GameType) {
    if (!gameType.isCustomizable)
      return [];

    const list:PlayerSet[] = [];
    for (const slot of setsBySlot.keys()) {
      const set = this.get(gameType, slot);
      if (set)
        list.push(set);
    }

    return list;
  }
  get(gameType:GameType, slot:Slot) {
    if (!setsBySlot.has(slot))
      throw new ServerError(400, 'Unrecognized or missing set slot');
    if (!gameType.isCustomizable)
      return null;

    return this.data.sets.find(s => s.gameTypeId === gameType.id && s.slot === slot) ?? null;
  }
  set(gameType:GameType, inSet:PickOptional<PlayerSet, 'units', 'id' | 'slot' | 'name'>) {
    if (inSet.slot && !setsBySlot.has(inSet.slot))
      throw new ServerError(400, 'Unrecognized set slot');
    if (!gameType.isCustomizable)
      throw new ServerError(400, 'May not create sets for this game type.');

    gameType.validateSet(inSet);

    const set = Object.assign({
      id: inSet.id ?? TeamSet.createId(inSet),
      slot: 'default' as const,
      name: setsBySlot.get(inSet.slot ?? 'default')!,
      gameTypeId: gameType.id,
      createdAt: new Date(),
    }, inSet);

    const index = this.data.sets.findIndex(s => s.gameTypeId === gameType.id && s.slot === set.slot);
    if (index === -1)
      this.data.sets.push(set);
    else
      this.data.sets[index] = set;

    this.emit('change:set');

    return set;
  }
  unset(gameType, slot) {
    const index = this.data.sets.findIndex(s => s.gameTypeId === gameType.id && s.slot === slot);
    if (index > -1) {
      this.data.sets.splice(index, 1);
      this.emit('change:unset');
    }

    return this.get(gameType, slot);
  }

  get ttl() {
    if (this.player)
      return this.player.ttl;
    else
      console.log(`Warning: PlayerSets (${this.playerId}) has no player reference`);

    // Delete the object after 12 months of inactivity (worst case)
    const days = 12 * 30;

    return Math.round(Date.now() / 1000) + days * 86400;
  }
};

serializer.addType({
  name: 'PlayerSets',
  constructor: PlayerSets,
  schema: {
    type: 'object',
    required: [ 'playerId', 'sets' ],
    properties: {
      playerId: { type:'string', format:'uuid' },
      sets: {
        type: 'array',
        items: {
          type: 'object',
          required: [ 'type', 'name', 'units', 'createdAt' ],
          properties: {
            type: { type:'string' },
            name: { type:'string' },
            units: {
              type:'array',
              items: { type:'object' },
            },
            createdAt: { type:'string', subType:'Date' },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
});
