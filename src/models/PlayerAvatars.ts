import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';
import unitData from '#tactics/unitData.js';
import { colorFilterMap } from '#tactics/colorMap.js';
import ServerError from '#server/Error.js';

export default class PlayerAvatars extends ActiveModel {
  protected data: {
    playerId: string
    unitType: string
    colorId: string
    avatars: any[]
    createdAt: Date
    updatedAt: Date
  }

  constructor(data) {
    super();
    this.data = data;
  }

  static create(playerId) {
    const unitTypes:any = [ ...unitData ].filter(([k,d]) => d.tier === 1).map(([k,d]) => k);
    const colorIds:any = [ ...colorFilterMap.keys() ];

    return new PlayerAvatars({
      playerId,
      unitType: unitTypes.random(),
      colorId: colorIds.random(),
      avatars: [],
      createdAt: new Date(),
      updatedAt: null,
    });
  }

  get playerId() {
    return this.data.playerId;
  }
  get avatar() {
    return {
      unitType: this.data.unitType,
      colorId: this.data.colorId,
    };
  }
  set avatar(avatar) {
    if (avatar.unitType === this.data.unitType && avatar.colorId === this.data.colorId)
      return;

    if (!unitData.has(avatar.unitType))
      throw new ServerError(400, 'Unrecognized unit type');
    if (!this.list.includes(avatar.unitType))
      throw new ServerError(403, 'Disallowed unit type');
    if (!colorFilterMap.has(avatar.colorId))
      throw new ServerError(400, 'Unrecognized color id');

    this.data.unitType = avatar.unitType;
    this.data.colorId = avatar.colorId;
    this.data.updatedAt = new Date();

    this.emit('change:avatar');
  }
  get list() {
    const tier = Math.min(4, 1 + Math.floor((Date.now() - this.data.createdAt.getTime()) / 1000 / 60 / 60 / 24 / 7));
    const unitTypes = [ ...unitData ].filter(([k,d]) => d.tier <= tier).sort((a,b) => a[1].tier - b[1].tier).map(([k,d]) => k);

    return unitTypes.concat(this.data.avatars);
  }
};

serializer.addType({
  name: 'PlayerAvatars',
  constructor: PlayerAvatars,
  schema: {
    type: 'object',
    required: [ 'playerId', 'unitType', 'colorId', 'avatars', 'createdAt', 'updatedAt' ],
    properties: {
      playerId: { type:'string', format:'uuid' },
      unitType: { type:'string' },
      colorId: { type:'string' },
      avatars: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      updatedAt: { type:[ 'string', 'null' ], subType:'Date' },
      createdAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
