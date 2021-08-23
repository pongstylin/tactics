import uuid from 'uuid/v4.js';
import XRegExp from 'xregexp';
import getTextWidth from 'string-pixel-width';

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
let rUnicodeLimit = XRegExp('^(\\pL|\\pN|\\pP|\\pS| )+$');

export default class Player {
  constructor(data) {
    Object.assign(this, {
      identityToken: null,
    }, data);
  }

  static create(data) {
    if (!data.name)
      throw new Error('Required player name');

    Player.validatePlayerName(data.name);

    data.id = uuid();
    data.created = new Date();
    data.devices = new Map();

    return new Player(data);
  }

  static load(data) {
    if (typeof data.created === 'string')
      data.created = new Date(data.created);
    if (data.identityToken)
      data.identityToken = new IdentityToken(data.identityToken);
    if (Array.isArray(data.devices))
      data.devices = new Map(data.devices.map(device => [
        device.id,
        Object.assign(device, {
          token: new AccessToken(device.token),
          nextToken: device.nextToken && new AccessToken(device.nextToken),
          agents: new Map(device.agents.map(([agent, addresses]) => [
            agent,
            new Map(addresses.map(
              ([address, lastSeenAt]) => [address, new Date(lastSeenAt)]
            )),
          ])),
        }),
      ]));

    return new Player(data);
  }

  static validatePlayerName(name) {
    if (!name)
      throw new ServerError(422, 'Player name is required');
    if (name.length > 20)
      throw new ServerError(403, 'Player name length limit is 20 characters');

    let width = getTextWidth(name, { font: 'Arial', size: 12 });
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

  updateProfile(profile) {
    let changed = false;

    Object.keys(profile).forEach(property => {
      if (property === 'name') {
        if (profile.name === this.name)
          return;

        Player.validatePlayerName(profile.name);
        this.name = profile.name;

        // Create new access token(s) with the new name
        for (let [deviceId, device] of this.devices) {
          device.nextToken = this.createAccessToken(deviceId);
        }

        changed = true;
      }
      else
        throw new Error('Invalid profile');
    });

    return changed;
  }
  refreshAccessToken(deviceId) {
    let device = this.devices.get(deviceId);
    let token = device.token;
    let nextToken = device.nextToken;

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

  addDevice(client) {
    let now = new Date();
    let deviceId = uuid();
    let device = {
      id: deviceId,
      name: null,
      token: this.createAccessToken(deviceId),
      nextToken: null,
      agents: new Map([[
        client.agent,
        new Map([[client.address, now]]),
      ]]),
    };

    this.devices.set(deviceId, device);

    return device;
  }
  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }
  removeDevice(deviceId) {
    this.devices.delete(deviceId);
  }

  /*
   * An access token allows a device to access resources.
   */
  createAccessToken(deviceId) {
    return AccessToken.create({
      subject: this.id,
      expiresIn: config.ACCESS_TOKEN_TTL || '1h',
      name: this.name,
      deviceId,
    });
  }
  getAccessToken(deviceId) {
    let device = this.devices.get(deviceId);

    return device.nextToken || device.token;
  }
  /*
   * An identity token can be used to create an access token for a new device.
   */
  createIdentityToken() {
    return IdentityToken.create({
      subject: this.id,
      expiresIn: config.IDENTITY_TOKEN_TTL || '30d',
      name: this.name,
    });
  }

  toJSON() {
    let json = {...this};
    json.devices = [...json.devices.values()].map(device =>
      Object.assign({}, device, {
        agents: [...device.agents].map(
          ([agent, addresses]) => [agent, [...addresses]]
        ),
      }),
    );

    return json;
  }
}
