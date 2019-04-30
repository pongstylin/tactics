'use strict';

import uuid from 'uuid/v4';
import jwt from 'jsonwebtoken';
import config from 'config/server.js';

export default class Player {
  constructor(data) {
    Object.assign(this, data);
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
      data.devices = new Map(data.devices.map(([id, data]) => [
        id,
        Object.assign(data, {
          addresses: new Map(data.addresses.map(([address, ts]) => [
            address,
            new Date(ts),
          ])),
          agents: new Map(data.agents.map(([agent, ts]) => [
            agent,
            new Date(ts),
          ])),
        }),
      ]));

    return new Player(data);
  }

  update(data) {
    Object.keys(data).forEach(property => {
      if (property === 'name')
        this.name = data.name;
      else
        throw new Error('Invalid update');
    });
  }

  addDevice(device) {
    device.id = uuid();
    this.devices.set(device.id, device);

    return device;
  }
  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }
  removeDevice(deviceId) {
    this.devices.delete(deviceId);
  }

  createToken(deviceId) {
    let device = this.devices.get(deviceId);
    device.token = jwt.sign({
      name: this.name,
      deviceId: deviceId,
    }, config.privateKey, {
      algorithm: 'RS512',
      expiresIn: '1d',
      subject: this.id,
    });

    return device.token;
  }

  toJSON() {
    let json = {...this};
    json.created = json.created.toISOString();
    json.devices = [...json.devices].map(([id, data]) => [
      id,
      Object.assign(data, {
        addresses: [...data.addresses],
        agents: [...data.agents],
      }),
    ]);

    return json;
  }
}
