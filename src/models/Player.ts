import { v4 as uuid } from 'uuid';
import XRegExp from 'xregexp';
import getTextWidth from 'string-pixel-width';

import ActiveModel from '#models/ActiveModel.js';
import Identities from '#models/Identities.js';
import Identity from '#models/Identity.js';
import obscenity from '#utils/obscenity.js';
import serializer from '#utils/serializer.js';

import IdentityToken from '#server/IdentityToken.js';
import AccessToken from '#server/AccessToken.js';
import config from '#config/server.js';
import ServerError from '#server/Error.js';

/*
 * Player names may have the following characters:
 *   Letter, Number, Punctuation, Symbol, Space
 *
 * Other restrictions are imposed by the validatePlayerName() method.
 */
XRegExp.install('astral');
const rUnicodeWhitelist = XRegExp('^(\\pL|\\pN|\\pP|\\pS| )+$');
const rUnicodeBlacklist = XRegExp('[\\u3164]');

enum Disposition {
  friend = 'friended',
  mute = 'muted',
  block = 'blocked',
}

interface ACL {
  newAccounts: Disposition | null
  guestAccounts: Disposition | null
}

export default class Player extends ActiveModel {
  protected data: {
    id: string
    identityId: string
    name: string
    confirmName: boolean
    verified: boolean
    devices: Map<string, any>
    identityToken: IdentityToken | null
    acl: ACL
    authProviderLinks: Map<string, string>
    checkinAt: Date
    checkoutAt: Date
    createdAt: Date
  }
  static identities: Identities
  public identity: Identity

  constructor(data) {
    super();
    this.data = {
      confirmName: false,
      verified: false,
      identityToken: null,
      acl: { newAccounts:null, guestAccounts:null },
      authProviderLinks: new Map(),

      ...data,
    };
  }

  static create(data) {
    if (!data.name)
      throw new Error('Required player name');

    Player.validatePlayerName(data.name);

    data.id = uuid();
    data.createdAt = new Date();
    data.checkinAt = data.createdAt;
    data.checkoutAt = data.createdAt;
    data.devices = new Map();

    return new Player(data);
  }
  static fromJSON(data) {
    // Map the devices array to a map.
    data.devices = new Map(data.devices.map(d => [ d.id, d ]));

    return new Player(data);
  }

  /*
   * checkIdentity can be:
   *  true: Check all identities for the name and throw error if found
   *  false: Do not check identities.
   *  Identity: Check all identities on behalf of provided Identity.
   */
  static validatePlayerName(name, checkIdentity:boolean | Identity = true) {
    if (!name)
      throw new ServerError(422, 'Player name is required');
    if (name.length > 20)
      throw new ServerError(403, 'Player name length limit is 20 characters');

    const width = getTextWidth(name, { font: 'Arial', size: 12 });
    if (width > 110)
      throw new ServerError(403, 'Player name visual length is too long');

    if (!rUnicodeWhitelist.test(name))
      throw new ServerError(403, 'Name contains forbidden characters');
    if (rUnicodeBlacklist.test(name))
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
    if (obscenity.hasMatch(name))
      throw new ServerError(403, 'The name is obscene');

    if (checkIdentity && Player.identities.sharesName(name, checkIdentity))
      throw new ServerError(403, 'The name is currently in use');
  }

  get id() {
    return this.data.id;
  }
  get identityId() {
    return this.data.identityId ?? this.data.id;
  }
  set identityId(identityId) {
    if (identityId === this.data.identityId)
      return;
    this.data.identityId = identityId;
    this.emit('change:identityId');
  }
  get name() {
    return this.data.name;
  }
  get devices() {
    return this.data.devices;
  }
  get acl() {
    return {
      muted: this.identity.muted,
      ...this.data.acl,
    };
  }
  set acl(acl) {
    if (acl.newAccounts === this.data.acl.newAccounts && acl.guestAccounts === this.data.acl.guestAccounts)
      return;
    this.data.acl = acl;
    this.emit({
      type: 'acl',
      target: this,
      data: { acl },
    });
    this.emit('change:acl');
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
  get lastSeenAt() {
    return this.data.checkinAt > this.data.checkoutAt ? new Date() : this.data.checkoutAt;
  }

  get isNew() {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return oneWeekAgo < this.data.createdAt;
  }
  get isVerified() {
    return this.data.verified;
  }

  hasAuthProviderLink(providerId) {
    return this.data.authProviderLinks.has(providerId);
  }
  getAuthProviderLinkIds() {
    return this.data.authProviderLinks.keys();
  }
  linkAuthProvider(provider, memberId) {
    if (this.data.authProviderLinks.get(provider.id) === memberId)
      return;

    provider.linkPlayerId(this.id, memberId);
    this.data.authProviderLinks.set(provider.id, memberId);
    this.data.verified = true;
    this.identity.name = this.name;
    this.emit('change:linkAuthProvider');
  }
  unlinkAuthProvider(provider) {
    if (!this.data.authProviderLinks.has(provider.id))
      return;

    provider.unlinkPlayerId(this.id);
    this.data.authProviderLinks.delete(provider.id);
    this.emit('change:unlinkAuthProvider');
  }

  updateProfile(profile) {
    let hasChanged = false;

    Object.keys(profile).forEach(property => {
      const oldValue = this[property];
      const newValue = profile[property];

      if (property === 'name') {
        if (oldValue === newValue && this.data.confirmName === false)
          return;

        Player.validatePlayerName(profile.name, this.identity);

        this.data.name = profile.name;
        this.data.confirmName = false;
        if (this.data.verified)
          this.identity.name = profile.name;

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

  checkin() {
    this.data.checkinAt = new Date();
    this.emit('change:checkin');
    this.identity.lastSeenAt = this.data.checkinAt;
  }
  checkout(client, deviceId) {
    const now = Date.now();
    const checkoutAt = new Date(now - client.session.idle * 1000);
    if (checkoutAt > this.data.checkoutAt) {
      this.data.checkoutAt = checkoutAt;
      this.data.devices.get(deviceId).checkoutAt = checkoutAt;
      this.emit('change:checkout');
      this.identity.lastSeenAt = this.data.checkoutAt;
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
      createdAt: now,
      checkoutAt: now,
    };
    this.data.devices.set(deviceId, device);

    /*
     * Only maintain the 10 most recently used devices
     */
    if (this.data.devices.size > 10) {
      const devices = [ ...this.data.devices.values() ].sort((a,b) => a.checkoutAt - b.checkoutAt);
      while (devices.length > 10)
        this.removeDevice(devices.shift().id);
    }

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
    this.emit({
      type: 'change:removeDevice',
      data: { deviceId },
    });

    return true;
  }

  toggleGlobalMute() {
    this.identity.muted = !this.identity.muted;
    this.emit({
      type: 'acl:toggleGlobalMute',
      target: this,
    });

    return this.identity.muted;
  }
  getActiveRelationships() {
    return Player.identities.getRelationships(this.id);
  }
  getRelationship(player) {
    const relationship:any = player.identity.getRelationship(this.id) ?? {};
    const reverse:any = this.identity.getRelationship(player.id) ?? {};

    let blockedByRule:any = false;
    if (player.acl.newAccounts === 'blocked' && this.isNew)
      blockedByRule = 'new';
    else if (player.acl.guestAccounts === 'blocked' && !this.isVerified)
      blockedByRule = 'guest';

    return {
      type: relationship.type,
      name: relationship.nickname,
      reverseType: reverse.type,
      blockedByRule,
    };
  }
  setRelationship(player, relationship) {
    const oldRelationship = this.getRelationship(player);

    if (relationship.type === undefined)
      relationship.type = oldRelationship.type;
    else if (relationship.type === null)
      delete relationship.type;

    if (relationship.name === undefined)
      relationship.name = oldRelationship.name;
    else if (relationship.name === null)
      delete relationship.name;

    if (relationship.type === undefined && relationship.name === undefined)
      return this.clearRelationship(player);
    if (oldRelationship?.type === relationship.type && oldRelationship.name === relationship.name)
      return false;

    Player.validatePlayerName(relationship.name, false);

    player.identity.setRelationship(this.id, {
      type: relationship.type,
      nickname: relationship.name,
      createdAt: relationship.createdAt,
    });

    this.emit({
      type: 'acl:relationship',
      target: this,
      data: { playerId:player.id, relationship },
    });

    return true;
  }
  mute(player, playerName) {
    return this.setRelationship(player, {
      type: 'muted',
      name: playerName,
    });
  }
  clearRelationship(player) {
    if (!player.identity.hasRelationship(this.id))
      return false;

    player.identity.deleteRelationship(this.id);

    this.emit({
      type: 'acl:clear',
      target: this,
      data: { playerId:player.id },
    });

    return true;
  }
  hasBlocked(player, applyRules = true) {
    if (player === this)
      return false;

    const relationship = player.identity.getRelationship(this.id);
    if (relationship)
      return relationship.type === 'blocked';

    if (applyRules) {
      if (this.data.acl.newAccounts === 'blocked' && player.isNew)
        return true;
      if (this.data.acl.guestAccounts === 'blocked' && !player.isVerified)
        return true;
    }

    return false;
  }
  hasMuted(player, applyRules = true) {
    if (player === this)
      return false;

    const relationship = player.identity.getRelationship(this.id);
    if (relationship)
      return relationship.type === 'muted';

    if (applyRules) {
      if (player.identity.muted)
        return true;
      if (this.data.acl.newAccounts === 'muted' && player.isNew)
        return true;
      if (this.data.acl.guestAccounts === 'muted' && !player.isVerified)
        return true;
    }

    return false;
  }
  hasMutedOrBlocked(players, applyRules = true) {
    return players.filter(p => this.hasMuted(p, applyRules) || this.hasBlocked(p, applyRules)).map(p => p.id);
  }

  /*
   * An access token allows a device to access resources.
   */
  createAccessToken(deviceId) {
    const payload:any = {
      subject: this.data.id,
      expiresIn: config.ACCESS_TOKEN_TTL || '1h',
      name: this.data.name,
      deviceId,
      verified: this.data.verified,
    };

    if (this.data.confirmName)
      payload.confirmName = true;

    return AccessToken.create(payload);
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

    if (json.confirmName === false)
      delete json.confirmName;

    return json;
  }
};

serializer.addType({
  name: 'Player',
  constructor: Player,
  schema: {
    type: 'object',
    required: [ 'id', 'name', 'devices', 'acl', 'identityToken', 'createdAt', 'checkoutAt' ],
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
            confirmName: { type:'boolean' },
            verified: { type:'boolean' },
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
            createdAt: { type:'string', subType:'Date' },
            checkoutAt: { type:'string', subType:'Date' },
          },
          additionalProperties: false,
        },
      },
      acl: {
        type: 'object',
        properties: {
          newAccounts: { $ref:'#/definitions/aclType' },
          guestAccounts: { $ref:'#/definitions/aclType' },
        },
        additionalProperties: false,
      },
      authProviderLinks: {
        type: 'array',
        subType: 'Map',
        items: {
          type: 'array',
          items: [
            { type:'string' },
            { type:'string' },
          ],
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
