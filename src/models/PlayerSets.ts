import ActiveModel from 'models/ActiveModel.js';
import serializer from 'utils/serializer.js';

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

  hasDefault(gameTypeId, setName) {
    return this.data.sets.findIndex(s => s.type === gameTypeId && s.name === setName) > -1;
  }
  getDefault(gameType, setName) {
    const set = this.data.sets.find(s => s.type === gameType.id && s.name === setName);
    if (set) return gameType.applySetUnitState(set);

    return gameType.getDefaultSet();
  }
  setDefault(gameType, setName, set) {
    gameType.validateSet(set);

    set.type = gameType.id;
    set.name = set.name ?? setName;
    set.createdAt = new Date();

    const index = this.data.sets.findIndex(s => s.type === gameType.id && s.name === setName);
    if (index === -1)
      this.data.sets.push(set);
    else
      this.data.sets[index] = set;

    this.emit('change:setDefault');
    return set;
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
