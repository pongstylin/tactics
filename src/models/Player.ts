import uuid from 'uuid/v4';
import XRegExp from 'xregexp';
import getTextWidth from 'string-pixel-width';

import ActiveModel from 'models/ActiveModel.js';
import serializer from 'utils/serializer.js';

import IdentityToken from 'server/IdentityToken.js';
import AccessToken from 'server/AccessToken.js';
import config from 'config/server.js';
import ServerError from 'server/Error.js';

/*
 * Player names may have the following characters:
 *   Letter, Number, Punctuation, Symbol, Space
 *
 * Other restrictions are imposed by the validatePlayerName() method.
 */
XRegExp.install('astral');
const rUnicodeLimit = XRegExp('^(\\pL|\\pN|\\pP|\\pS| )+$');

export default class Player extends ActiveModel {
  protected data: {
    id: string
    name: string
    devices: Map<string, any>
    identityToken: IdentityToken | null
    acl: Map<string, any>
    reverseACL: Map<string, any>
    checkoutAt: Date
    createdAt: Date
  }

  constructor(data) {
    super();
    this.data = {
      identityToken: null,
      acl: new Map(),
      reverseACL: new Map(),

      ...data,
    };
  }

  static create(data) {
    if (!data.name)
      throw new Error('Required player name');

    Player.validatePlayerName(data.name);

    data.id = uuid();
    data.createdAt = new Date();
    data.checkoutAt = data.createdAt;
    data.devices = new Map();

    return new Player(data);
  }
  static fromJSON(data) {
    // Map the devices array to a map.
    data.devices = new Map(data.devices.map(d => [ d.id, d ]));

    return new Player(data);
  }

  static validatePlayerName(name) {
    if (!name)
      throw new ServerError(422, 'Player name is required');
    if (name.length > 20)
      throw new ServerError(403, 'Player name length limit is 20 characters');

    const width = getTextWidth(name, { font: 'Arial', size: 12 });
    if (width > 110)
      throw new ServerError(403, 'Player name visual length is too long');

    if (!rUnicodeLimit.test(name))
      throw new ServerError(403, 'Name contains forbidden characters');
    if (name.startsWith(' '))
      throw new ServerError(403, 'Name may not start with a space');
    if (name.endsWith(' '))
      throw new ServerError(403, 'Name may not end with a space');
    if (name.includes('  '))
      throw new ServerError(403, 'Name may not contain consecutive spaces');
    if (name.includes('#'))
      throw new ServerError(403, 'The # symbol is reserved');
    if (/<[a-z].*?>|<\//i.test(name) || /&[#a-z0-9]+;/i.test(name))
      throw new ServerError(403, 'The name may not contain markup');
  }

  get id() {
    return this.data.id;
  }
  get name() {
    return this.data.name;
  }
  get devices() {
    return this.data.devices;
  }
  get acl() {
    return this.data.acl;
  }
  get identityToken() {
    return this.data.identityToken;
  }
  get checkoutAt() {
    return this.data.checkoutAt;
  }
  get createdAt() {
    return this.data.createdAt;
  }

  updateProfile(profile) {
    let hasChanged = false;

    Object.keys(profile).forEach(property => {
      const oldValue = this[property];
      const newValue = profile[property];
      if (oldValue === newValue) return;

      if (property === 'name') {
        Player.validatePlayerName(profile.name);
        this.data.name = profile.name;

        // Create new access token(s) with the new name
        for (let [deviceId, device] of this.data.devices)
          device.nextToken = this.createAccessToken(deviceId);

        hasChanged = true;
      } else
        throw new Error('Invalid profile');
    });

    if (hasChanged) {
      this.emit('change:profile');
      return true;
    }

    return false;
  }
  refreshAccessToken(deviceId) {
    const device = this.data.devices.get(deviceId);
    const token = device.token;
    const nextToken = device.nextToken;

    if (nextToken)
      if (nextToken.age < (nextToken.ttl * 0.1))
        return false;
      else
        device.nextToken = this.createAccessToken(device.id);
    else
      if (token.age < (token.ttl * 0.1))
        return false;
      else
        device.nextToken = this.createAccessToken(device.id);

    this.emit('change:refreshAccessToken');

    return true;
  }
  activateAccessToken(client, token) {
    const now = new Date();
    const device = this.getDevice(token.deviceId);
    if (device.agents.has(client.agent))
      device.agents.get(client.agent).set(client.address, now);
    else
      device.agents.set(client.agent, new Map([[client.address, now]]));

    device.token = token;
    device.nextToken = null;

    this.emit('change:activateAccessToken');

    return true;
  }
  checkout(client) {
    const checkoutAt = new Date(Date.now() - client.session.idle * 1000);
    if (checkoutAt > this.data.checkoutAt) {
      this.data.checkoutAt = checkoutAt;
      this.emit('change:checkout');
    }
  }

  addDevice(client, token = null) {
    if (token) {
      if (!token.equals(this.data.identityToken))
        throw new ServerError(403, 'Identity token was revoked');

      this.clearIdentityToken();
    }

    const now = new Date();
    const deviceId = uuid();
    const device = {
      id: deviceId,
      name: null,
      token: this.createAccessToken(deviceId),
      nextToken: null,
      agents: new Map([[
        client.agent,
        new Map([[client.address, now]]),
      ]]),
    };

    this.data.devices.set(deviceId, device);
    this.emit('change:addDevice');

    return device;
  }
  getDevice(deviceId) {
    return this.data.devices.get(deviceId);
  }
  setDeviceName(deviceId, name) {
    if (name !== null) {
      if (typeof name !== 'string')
        throw new ServerError(400, 'Expected device name');
      if (name.length > 20)
        throw new ServerError(400, 'Device name may not exceed 20 characters');
    }

    const device = this.getDevice(deviceId);
    if (!device)
      throw new ServerError(404, 'No such device');

    device.name = name;
    this.emit('change:setDeviceName');

    return true;
  }
  removeDevice(deviceId) {
    if (!this.data.devices.has(deviceId))
      return false;

    this.data.devices.delete(deviceId);
    this.emit('change:removeDevice');

    return true;
  }

  getPlayerACL(playerId) {
    const playerACL = this.data.acl.get(playerId);
    const reverseType = this.data.reverseACL.get(playerId);
    if (!playerACL && !reverseType)
      return;

    return Object.assign({}, this.data.acl.get(playerId), { reverseType });
  }
  setPlayerACL(player, playerACL) {
    Player.validatePlayerName(playerACL.name);

    const acl = this.data.acl.get(player.id);
    if (acl?.type === playerACL.type && acl.name === playerACL.name)
      return false;

    playerACL.createdAt = new Date();

    this.data.acl.set(player.id, playerACL);
    this.emit({
      type: 'acl:set',
      target: this,
      data: { playerId:player.id, playerACL },
    });
    this.emit('change:setPlayerACL');

    player.setReversePlayerACL(this.data.id, playerACL.type);

    return true;
  }
  mute(player, playerName) {
    return this.setPlayerACL(player, {
      type: 'muted',
      name: playerName,
    });
  }
  clearPlayerACL(player) {
    if (!this.data.acl.has(player.id))
      return false;

    this.data.acl.delete(player.id);
    this.emit({
      type: 'acl:clear',
      target: this,
      data: { playerId:player.id },
    });
    this.emit('change:clearPlayerACL');

    player.clearReversePlayerACL(this.data.id);

    return true;
  }
  hasBlocked(playerId) {
    return this.data.acl.get(playerId)?.type === 'blocked';
  }
  hasMutedOrBlocked(playerIds) {
    const isMutedOrBlocked = /^(?:muted|blocked)$/;

    return playerIds.filter(pId => isMutedOrBlocked.test(this.data.acl.get(pId)?.type));
  }

  setReversePlayerACL(playerId, aclType) {
    this.data.reverseACL.set(playerId, aclType);
    this.emit({
      type: 'acl:setReverse',
      target: this,
      data: { playerId },
    });
  }
  clearReversePlayerACL(playerId) {
    this.data.reverseACL.delete(playerId);
    this.emit({
      type: 'acl:clearReverse',
      target: this,
      data: { playerId },
    });
  }
  listBlockedBy() {
    const playerIds = new Set();
    for (const [ playerId, aclType ] of this.data.reverseACL) {
      if (aclType === 'blocked')
        playerIds.add(playerId);
    }
    return playerIds;
  }
  isBlockedBy(playerId) {
    return this.data.reverseACL.get(playerId) === 'blocked';
  }

  /*
   * An access token allows a device to access resources.
   */
  createAccessToken(deviceId) {
    return AccessToken.create({
      subject: this.data.id,
      expiresIn: config.ACCESS_TOKEN_TTL || '1h',
      name: this.data.name,
      deviceId,
    });
  }
  getAccessToken(deviceId) {
    const device = this.data.devices.get(deviceId);

    return device.nextToken || device.token;
  }
  /*
   * An identity token can be used to create an access token for a new device.
   */
  createIdentityToken() {
    return IdentityToken.create({
      subject: this.data.id,
      expiresIn: config.IDENTITY_TOKEN_TTL || '30d',
      name: this.data.name,
    });
  }
  setIdentityToken(token = this.createIdentityToken()) {
    this.data.identityToken = token;
    this.emit('change:setIdentityToken');
  }
  getIdentityToken() {
    if (this.data.identityToken && this.data.identityToken.isExpired) {
      this.data.identityToken = null;
      this.emit('change:expireIdentityToken');
    }

    return this.data.identityToken;
  }
  clearIdentityToken() {
    this.data.identityToken = null;
    this.emit('change:clearIdentityToken');
  }

  toJSON() {
    const json = super.toJSON();

    // Convert the devices map to an array.
    json.devices = [ ...json.devices.values() ];

    return json;
  }
};

serializer.addType({
  name: 'Player',
  constructor: Player,
  schema: {
    type: 'object',
    required: [ 'id', 'name', 'devices', 'acl', 'reverseACL', 'identityToken', 'createdAt', 'checkoutAt' ],
    properties: {
      id: { type:'string', format:'uuid' },
      name: { type:'string' },
      devices: {
        type: 'array',
        items: {
          type: 'object',
          required: [ 'id', 'name', 'token', 'nextToken', 'agents' ],
          properties: {
            id: { type:'string', format:'uuid' },
            name: { type:[ 'string', 'null' ] },
            token: { $ref:'AccessToken' },
            nextToken: {
              oneOf: [
                { type:'null' },
                { $ref:'AccessToken' },
              ],
            },
            agents: {
              type: 'array',
              subType: 'Map',
              items: {
                type: 'array',
                items: [
                  { type:'string', format:'uuid' },
                  {
                    type: 'array',
                    subType: 'Map',
                    items: {
                      type: 'array',
                      items: [
                        { type:'string' },
                        { type:'string', subType:'Date' },
                      ],
                      additionalItems: false,
                    },
                  },
                ],
                additionalItems: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
      acl: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string', format:'uuid' },
            {
              type: 'object',
              required: [ 'type', 'name', 'createdAt' ],
              properties: {
                type: { $ref:'#/definitions/aclType' },
                name: { type:'string' },
                createdAt: { type:'string', subType:'Date' },
              },
              additionalProperties: false,
            },
          ],
          additionalItems: false,
        },
      },
      reverseACL: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string', format:'uuid' },
            { $ref:'#/definitions/aclType' },
          ],
          additionalItems: false,
        },
      },
      identityToken: {
        oneOf: [
          { type:'null' },
          { $ref:'IdentityToken' },
        ],
      },
      createdAt: { type:'string', subType:'Date' },
      checkoutAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
    definitions: {
      aclType: { type:'string', enum:[ 'friended', 'muted', 'blocked' ] },
    },
  },
});
