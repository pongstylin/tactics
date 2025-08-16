import ActiveModel from '#models/ActiveModel.js';
import type Player from '#models/Player.js';
import serializer from '#utils/serializer.js';

import setsById from '#config/sets.js';
import ServerError from '#server/Error.js';

import type GameType from '#tactics/GameType.js';
import type { Set } from '#tactics/GameType.js';

type PlayerSet = {
  type: string; // GameTypeId
  id: string; // SetId, e.g. default, alt1, alt2, alt3
  createdAt: Date;
} & Set;

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
      return [ gameType.getDefaultSet() ];

    const list:Set[] = [];
    for (const setId of setsById.keys()) {
      const set = this.get(gameType, setId);
      if (set)
        list.push(set);
    }

    return list;
  }
  get(gameType:GameType, setId:string) {
    if (!setsById.has(setId))
      throw new ServerError(400, 'Unrecognized or missing set id');
    if (!gameType.isCustomizable) {
      if (setId !== 'default')
        throw new ServerError(400, 'Only the default set is available for this game type.');
      return gameType.getDefaultSet();
    }

    const set = this.data.sets.find(s => s.type === gameType.id && s.id === setId);
    if (set) return gameType.applySetUnitState(set);

    if (setId === 'default')
      return this.set(gameType, gameType.getDefaultSet());
    return null;
  }
  set(gameType:GameType, inSet:PickOptional<PlayerSet, 'units', 'id' | 'name'>) {
    if (inSet.id && !setsById.has(inSet.id))
      throw new ServerError(400, 'Unrecognized set id');
    if (!gameType.isCustomizable)
      throw new ServerError(400, 'May not create sets for this game type.');

    gameType.validateSet(inSet);

    const set = Object.assign({
      id: inSet.id ?? 'default',
      type: gameType.id,
      name: inSet.name ?? setsById.get(inSet.id ?? 'default'),
      createdAt: new Date(),
    }, inSet);

    const index = this.data.sets.findIndex(s => s.type === gameType.id && s.id === set.id);
    if (index === -1)
      this.data.sets.push(set);
    else
      this.data.sets[index] = set;

    this.emit('change:set');

    return set;
  }
  unset(gameType, setId) {
    const index = this.data.sets.findIndex(s => s.type === gameType.id && s.id === setId);
    if (index > -1) {
      this.data.sets.splice(index, 1);
      this.emit('change:unset');
    }

    return this.get(gameType, setId);
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
