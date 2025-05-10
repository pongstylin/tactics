import ActiveModel from '#models/ActiveModel.js';
import type Player from '#models/Player.js';
import serializer from '#utils/serializer.js';
import unitData from '#tactics/unitData.js';
import { colorFilterMap } from '#tactics/colorMap.js';
import ServerError from '#server/Error.js';

export default class PlayerAvatars extends ActiveModel {
  protected data: {
    playerId: string
    unitType: string
    colorId: string
    avatars: string[]
    createdAt: Date
    updatedAt: Date
  }
  public player: Player | null = null;

  constructor(data) {
    super();
    this.data = data;
  }

  static create(playerId) {
    const unitTypes:any = [ ...unitData ].filter(([k,d]) => d.tier === 1).map(([k,d]) => k);
    const colorIds:any = [ ...colorFilterMap.keys() ];

    const playerAvatars = new PlayerAvatars({
      playerId,
      unitType: unitTypes.random(),
      colorId: colorIds.random(),
      avatars: [],
      createdAt: new Date(),
      updatedAt: null,
    });
    // Creating a new instance of PlayerAvatars is not idempotent
    // so we flag it as dirty to make sure it gets saved
    playerAvatars.isClean = false;

    return playerAvatars;
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

  get ttl() {
    if (this.player)
      return this.player.ttl;
    else
      console.log(`Warning: PlayerAvatars (${this.playerId}) has no player reference`);

    // Delete the object after 12 months of inactivity (worst case)
    const days = 12 * 30;

    return Math.round(Date.now() / 1000) + days * 86400;
  }

  grant(unitType:string) {
    if (this.data.avatars.includes(unitType))
      return;

    if (!unitData.has(unitType))
      throw new ServerError(400, 'Unrecognized unit type');
    if (this.list.includes(unitType))
      throw new ServerError(403, 'Already granted unit type');

    this.data.avatars.push(unitType);
    this.emit('change:grant');
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
