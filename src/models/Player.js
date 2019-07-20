'use strict';

import uuid from 'uuid/v4';
import jwt from 'jsonwebtoken';
import config from 'config/server.js';

export default class Player {
  constructor(data) {
    Object.assign(this, {
      identityToken: null,
    }, data);
  }

  static create(data) {
    if (!data.name)
      throw new Error('Required player name');

    data.id = uuid();
    data.created = new Date();
    data.devices = new Map();

    return new Player(data);
  }

  static load(data) {
    if (typeof data.created === 'string')
      data.created = new Date(data.created);
    if (Array.isArray(data.devices))
      data.devices = new Map(data.devices.map(device => [
        device.id,
        Object.assign(device, {
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

  /*
   * This is used to update a profile at the request of a user.
   * It may not be used to update any arbitrary field.
   */
  update(data) {
    Object.keys(data).forEach(property => {
      if (property === 'name')
        this.name = data.name;
      else
        throw new Error('Invalid update');
    });
  }

  addDevice(device) {
    device = Object.assign({
      id: uuid(),
      name: null,
      token: null,
    }, device);

    this.devices.set(device.id, device);

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
    return jwt.sign({
      name: this.name,
      deviceId: deviceId,
    }, config.privateKey, {
      algorithm: 'RS512',
      expiresIn: config.ACCESS_TOKEN_TTL || '1h',
      subject: this.id,
    });
  }
  /*
   * An identity token can be used to obtain an access token for a device.
   */
  createIdentityToken() {
    return jwt.sign({
      name: this.name,
    }, config.privateKey, {
      algorithm: 'RS512',
      expiresIn: config.IDENTITY_TOKEN_TTL || '30d',
      subject: this.id,
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
