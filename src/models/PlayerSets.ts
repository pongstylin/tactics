import ActiveModel from 'models/ActiveModel.js';
import serializer from 'utils/serializer.js';

import setsById from 'config/sets.js';
import ServerError from 'server/Error.js';

export default class PlayerSets extends ActiveModel {
  protected data: {
    playerId: string
    sets: any[]
  }

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

  list(gameType) {
    if (!gameType.isCustomizable)
      return [ gameType.getDefaultSet() ];

    const list = [];
    for (const setId of setsById.keys()) {
      const set = this.get(gameType, setId);
      if (set)
        list.push(set);
    }

    return list;
  }
  get(gameType, setId) {
    const set = this.data.sets.find(s => s.type === gameType.id && s.id === setId);
    if (set) return gameType.applySetUnitState(set);

    if (setId === 'default')
      return gameType.getDefaultSet();
    return null;
  }
  set(gameType, set) {
    if (!setsById.has(set.id))
      throw new ServerError(400, 'Unrecognized or missing set id');

    gameType.validateSet(set);

    set.type = gameType.id;
    set.name = set.name ?? setsById.get(set.id);
    set.createdAt = new Date();

    const index = this.data.sets.findIndex(s => s.type === gameType.id && s.id === set.id);
    if (index === -1)
      this.data.sets.push(set);
    else
      this.data.sets[index] = set;

    this.emit('change:set');
  }
  unset(gameType, setId) {
    const index = this.data.sets.findIndex(s => s.type === gameType.id && s.id === setId);
    if (index > -1) {
      this.data.sets.splice(index, 1);
      this.emit('change:unset');
    }

    if (setId === 'default')
      return gameType.getDefaultSet();
    return null;
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
