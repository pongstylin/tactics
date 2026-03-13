import { v4 as uuid } from 'uuid';
import XRegExp from 'xregexp';
// @ts-ignore
import getTextWidth from 'string-pixel-width';

import ActiveModel, { type AbstractEvents } from '#models/ActiveModel.js';
import Session from '#models/Session.js';
import PlayerDevice from '#models/PlayerDevice.js';
import type Provider from '#models/Provider.js';
import Identities from '#models/Identities.js';
import Identity from '#models/Identity.js';
// @ts-ignore
import obscenity from '#utils/obscenity.js';
// @ts-ignore
import { moderationException } from '#utils/openai.js';
import Cache from '#utils/Cache.js';
// @ts-ignore
import serializer from '#utils/serializer.js';

// @ts-ignore
import IdentityToken from '#server/IdentityToken.js';
// @ts-ignore
import AccessToken from '#server/AccessToken.js';
// @ts-ignore
import config from '#config/server.js';
// @ts-ignore
import ServerError from '#server/Error.js';

type PlayerEvents = AbstractEvents & {
  'change:identityId': {},
  'change:verified': {},
  'change:acl': {},
  'change:linkAuthProvider': {},
  'change:unlinkAuthProvider': {},
  'change:profile': {},
  'change:checkin': {},
  'change:checkout': {},
  'change:setIdentityToken': {},
  'change:expireIdentityToken': {},
  'change:clearIdentityToken': {},
  'device:create': { device:PlayerDevice },
  'device:change': { device:PlayerDevice, originalEvent:any },
  'device:remove': { device:PlayerDevice },
  'acl': { target:Player, data:{ acl:ACL } },
  'acl:toggleGlobalMute': { target:Player },
  'acl:relationship': { target:Player, data:{ playerId:string, relationship:any } },
  'acl:clear': { target:Player, data:{ playerId:string } },
};

/*
 * Player names may have the following characters:
 *   Letter, Number, Punctuation, Symbol, Space
 *
 * Other restrictions are imposed by the validatePlayerName() method.
 */
XRegExp.install('astral');
const rUnicodeWhitelist = XRegExp('^(\\pL|\\pN|\\pP|\\pS| |\uFE0F|\uD83E|\uDE76)+$');
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

const listeners = new WeakMap();

export default class Player extends ActiveModel<PlayerEvents> {
  protected static _cache: Cache<string, Player>;

  protected data: {
    id: string
    identityId: string
    name: string
    confirmName: string | null
    verified: boolean
    devices: Map<string, PlayerDevice>
    identityToken: IdentityToken | null
    acl: ACL
    authProviderLinks: Map<string, string>
    checkinAt: Date
    checkoutAt: Date
    createdAt: Date
  }
  static identities: Identities
  public identity: Identity
  public hasAllDevices: boolean = false

  constructor(data:Player['data']) {
    super();
    this.data = Object.assign({
      name: null,
      confirmName: null,
      verified: false,
      identityToken: null,
      acl: { newAccounts:null, guestAccounts:null },
      authProviderLinks: new Map(),
    }, data);

    data.devices.forEach(d => this._subscribeDevice(d));
  }

  static get cache() {
    return this._cache ??= new Cache();
  }
  static async create(data:Player['data']) {
    if (data.name !== undefined && data.name !== null)
      await Player.validatePlayerName(data.name);
    else if (data.confirmName === undefined || data.confirmName === null)
      throw new Error('Required player name');

    data.id = uuid();
    data.createdAt = new Date();
    data.checkinAt = data.createdAt;
    data.checkoutAt = data.createdAt;
    data.devices = new Map();

    return new Player(data);
  }
  static fromJSON(data:Override<Player['data'], {
    devices: PlayerDevice[],
  }>) {
    const player = new Player({
      ...data,

      // Map the devices array to a map.
      devices: new Map(data.devices.map(d => [ d.id, d ])),
    });

    // This will always be true under the file adapter and false for the DynamoDB adapter.
    // The DynamoDB adapter will set it to true when loading all devices.
    if (player.devices.size > 0) {
      player.hasAllDevices = true;
      for (const device of player.devices.values())
        device.player = player;
    }

    return player;
  }

  /*
   * checkIdentity can be:
   *  true: Check all identities for the name and throw error if found
   *  false: Do not check identities.
   *  Identity: Check all identities on behalf of provided Identity.
   */
  static async validatePlayerName(name:string, checkIdentity:boolean | Identity = true, skipModeration = false, retries = 3) {
    Player.checkPlayerName(name);

    if (!skipModeration) {
      if (obscenity.hasMatch(name))
        throw new ServerError(403, 'The name is obscene');

      const exception = await moderationException(name, retries);
      if (exception)
        throw new ServerError(403, exception);
    }

    if (checkIdentity && Player.identities.sharesName(name, checkIdentity))
      throw new ServerError(403, 'The name is currently in use');
  }
  static checkPlayerName(name:string) {
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
  get confirmName() {
    return this.data.confirmName;
  }
  get verified() {
    return this.data.verified;
  }
  set verified(verified) {
    if (this.data.verified === verified)
      return;
    this.data.verified = verified;
    this.identity.name = verified ? this.data.name : null;
    this.emit('change:verified');
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
    this.emit('acl', {
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
  get ttl() {
    // Delete the object after 3 or 12 months of inactivity depending on verification status.
    const days = (this.data.verified ? 12 : 3) * 30;

    return Math.round(this.lastSeenAt.getTime() / 1000) + days * 86400;
  }

  get isNew() {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return oneWeekAgo < this.data.createdAt;
  }

  hasAuthProviderLink(providerId:string) {
    return this.data.authProviderLinks.has(providerId);
  }
  getAuthProviderLinkIds() {
    return this.data.authProviderLinks.keys();
  }
  linkAuthProvider(provider:Provider, memberId:string) {
    if (this.data.authProviderLinks.get(provider.id) === memberId)
      return;

    provider.linkPlayerId(this.id, memberId);
    this.data.authProviderLinks.set(provider.id, memberId);
    this.data.verified = true;
    this.identity.name = this.name;
    this.emit('change:linkAuthProvider');
  }
  unlinkAuthProvider(provider:Provider) {
    if (!this.data.authProviderLinks.has(provider.id))
      return;

    provider.unlinkPlayerId(this.id);
    this.data.authProviderLinks.delete(provider.id);
    this.emit('change:unlinkAuthProvider');
  }

  async updateProfile(profile:Pick<Player, 'name'>, skipModeration = false) {
    let hasChanged = false;

    for (const property of Object.keys(profile) as (keyof Pick<Player, 'name'>)[]) {
      const oldValue = this[property];
      const newValue = profile[property];

      if (property === 'name') {
        if (oldValue === newValue && this.data.confirmName === null)
          return;

        await Player.validatePlayerName(profile.name, this.identity, skipModeration);

        this.data.name = profile.name;
        this.data.confirmName = null;
        if (this.data.verified)
          this.identity.name = profile.name;

        // Create new access token(s) with the new name
        for (let [deviceId, device] of this.data.devices)
          device.nextToken = this.createAccessToken(deviceId);

        hasChanged = true;
      } else
        throw new Error('Invalid profile');
    }

    if (hasChanged) {
      this.emit('change:profile');
      return true;
    }

    return false;
  }
  refreshAccessToken(deviceId:string) {
    const device = this.getDevice(deviceId);
    if (!device)
      return null;

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

    return true;
  }
  activateAccessToken(token:AccessToken) {
    const device = this.getDevice(token.deviceId);
    if (!device)
      return null;

    device.activateAccessToken(token);

    return true;
  }

  checkin(client:Session['client'], device:PlayerDevice) {
    device.checkin(client, this.data.checkinAt = new Date());
    this.emit('change:checkin');
    this.identity.lastSeenAt = this.lastSeenAt;
  }
  checkout(client:Session['client'], device:PlayerDevice) {
    const checkoutAt = new Date(Date.now() - client.session.idle! * 1000);
    device.checkout(client, checkoutAt);
    if (checkoutAt > this.data.checkoutAt) {
      this.data.checkoutAt = checkoutAt;
      this.emit('change:checkout');
    }
    this.identity.lastSeenAt = this.lastSeenAt;
  }

  _subscribeDevice(device:PlayerDevice) {
    const listener = (event:any) => this.emit('device:change', {
      device,
      originalEvent: event,
    });
    listeners.set(device, listener);
    device.on('change', listener);
  }
  _unsubscribeDevice(device:PlayerDevice) {
    device.off('change', listeners.get(device));
  }
  createDevice(client:Session['client'], token:IdentityToken | null = null) {
    if (token) {
      if (!token.equals(this.data.identityToken))
        throw new ServerError(403, 'Identity token was revoked');

      this.clearIdentityToken();
    }

    const device = PlayerDevice.create(client);
    device.token = this.createAccessToken(device.id);
    this.emit('device:create', {
      device,
    });
    this._subscribeDevice(device);

    return device;
  }
  addDevice(device:PlayerDevice) {
    if (this.data.devices.has(device.id))
      return false;

    this.data.devices.set(device.id, device);
    this._subscribeDevice(device);

    return true;
  }
  getDevice(deviceId:string) {
    return this.data.devices.get(deviceId) ?? null;
  }
  setDeviceName(deviceId:string, name:string) {
    const device = this.getDevice(deviceId);
    if (!device)
      throw new ServerError(404, 'No such device');

    device.name = name;

    return true;
  }
  removeDevice(deviceId:string) {
    const device = this.getDevice(deviceId);
    if (!device)
      return false;

    this._unsubscribeDevice(device);
    this.data.devices.delete(deviceId);
    this.emit('device:remove', {
      device,
    });

    return true;
  }

  toggleGlobalMute() {
    this.identity.muted = !this.identity.muted;
    this.emit('acl:toggleGlobalMute', {
      target: this,
    });

    return this.identity.muted;
  }
  getActiveRelationships() {
    return Player.identities.getRelationships(this.id);
  }
  getRelationship(player:Player) {
    const relationship = player.identity.getRelationship(this.id);
    const reverse = this.identity.getRelationship(player.id);

    let blockedByRule:false | 'new' | 'guest' = false as const;
    if (player.acl.newAccounts === 'blocked' && this.isNew)
      blockedByRule = 'new';
    else if (player.acl.guestAccounts === 'blocked' && !this.data.verified)
      blockedByRule = 'guest';

    return {
      type: relationship?.type,
      name: relationship?.nickname,
      reverseType: reverse?.type,
      blockedByRule,
    };
  }
  setRelationship(player:Player, relationship:Partial<{
    type?: string | null,
    name?: string | null,
  }>) {
    const oldRelationship = this.getRelationship(player);

    if (oldRelationship.type)
      if (relationship.type === undefined)
        relationship.type = oldRelationship.type;
      else if (relationship.type === null)
        delete relationship.type;

    if (oldRelationship.name)
      if (relationship.name === undefined)
        relationship.name = oldRelationship.name;
      else if (relationship.name === null)
        delete relationship.name;

    if (relationship.type === undefined && relationship.name === undefined)
      return this.clearRelationship(player);
    if (oldRelationship.type === relationship.type && oldRelationship.name === relationship.name)
      return false;

    Player.checkPlayerName(relationship.name!);

    player.identity.setRelationship(this.id, {
      type: relationship.type!,
      nickname: relationship.name!,
    });

    this.emit('acl:relationship', {
      target: this,
      data: { playerId:player.id, relationship },
    });

    return true;
  }
  mute(player:Player, playerName:string) {
    return this.setRelationship(player, {
      type: 'muted',
      name: playerName,
    });
  }
  clearRelationship(player:Player) {
    if (!player.identity.hasRelationship(this.id))
      return false;

    player.identity.deleteRelationship(this.id);

    this.emit('acl:clear', {
      target: this,
      data: { playerId:player.id },
    });

    return true;
  }
  hasBlocked(player:Player, applyRules = true) {
    if (player === this)
      return false;

    const relationship = player.identity.getRelationship(this.id);
    if (relationship)
      return relationship.type === 'blocked';

    if (applyRules) {
      if (this.data.acl.newAccounts === 'blocked' && player.isNew)
        return true;
      if (this.data.acl.guestAccounts === 'blocked' && !player.verified)
        return true;
    }

    return false;
  }
  hasMuted(player:Player, applyRules = true) {
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
      if (this.data.acl.guestAccounts === 'muted' && !player.verified)
        return true;
    }

    return false;
  }
  hasMutedOrBlocked(players:Player[], applyRules = true) {
    return players.filter(p => this.hasMuted(p, applyRules) || this.hasBlocked(p, applyRules)).map(p => p.id);
  }

  /*
   * An access token allows a device to access resources.
   */
  createAccessToken(deviceId:string) {
    const payload:Record<string, string | number | boolean> = {
      subject: this.data.id,
      expiresIn: config.ACCESS_TOKEN_TTL || '1h',
      deviceId,
      verified: this.data.verified,
    };

    if (this.data.name !== null)
      payload.name = this.data.name;
    else
      payload.confirmName = this.data.confirmName!;

    if (this.identity.admin)
      payload.admin = true;

    return AccessToken.create(payload);
  }
  getAccessToken(deviceId:string) {
    const device = this.getDevice(deviceId);
    if (!device)
      return null;

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

  cloneWithoutDevices() {
    const clone = serializer.clone(this);
    clone.data.devices = new Map();

    return clone;
  }
  toJSON() {
    const json = super.toJSON();

    // Convert the devices map to an array.
    json.devices = [ ...json.devices.values() ];

    if (json.name === null)
      delete json.name;
    if (json.confirmName === null)
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
      confirmName: { type:'string' },
      verified: { type:'boolean' },
      devices: {
        type: 'array',
        items: { $ref:'PlayerDevice' },
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
      checkinAt: { type:'string', subType:'Date' },
      checkoutAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
    definitions: {
      aclType: { type:'string', enum:[ 'friended', 'muted', 'blocked' ] },
    },
  },
});
