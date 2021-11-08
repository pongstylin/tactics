import ActiveModel from 'models/ActiveModel.js';
import serializer from 'utils/serializer.js';

export default class PlayerSets extends ActiveModel {
  playerId: string
  sets: any[]

  constructor(data) {
    super(data);
  }

  static create(playerId) {
    return new PlayerSets({
      playerId,
      sets: [],
    });
  }

  values() {
    return this.sets.values();
  }

  hasDefault(gameTypeId, setName) {
    return this.sets.findIndex(s => s.type === gameTypeId && s.name === setName) > -1;
  }
  getDefault(gameType, setName) {
    const set = this.sets.find(s => s.type === gameType.id && s.name === setName);
    if (set) return gameType.applySetUnitState(set);

    return gameType.getDefaultSet();
  }
  setDefault(gameType, setName, set) {
    gameType.validateSet(set);

    set.type = gameType.id;
    set.name = set.name ?? setName;
    set.createdAt = new Date();

    const index = this.sets.findIndex(s => s.type === gameType.id && s.name === setName);
    if (index === -1)
      this.sets.push(set);
    else
      this.sets[index] = set;

    this.emit('change:setDefault');
    return set;
  }
};

serializer.addType({
  name: 'PlayerSets',
  constructor: PlayerSets,
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema',
    $id: 'PlayerSets',
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
