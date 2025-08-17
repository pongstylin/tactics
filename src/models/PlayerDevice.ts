import { v4 as uuid } from 'uuid';

import ActiveModel from '#models/ActiveModel.js';
import type Player from '#models/Player.js';
import AccessToken from '#server/AccessToken.js';
import ServerError from '#server/Error.js';
import serializer from '#utils/serializer.js';

export default class PlayerDevice extends ActiveModel {
  protected data: {
    id: string
    name: string | null
    token: AccessToken | null
    nextToken: AccessToken | null
    agents: Map<string, Map<string, Date>>
    createdAt: Date
    checkinAt: Date
    checkoutAt: Date
  }
  public player: Player | null = null;

  constructor(data) {
    super();
    this.data = data;
  }

  static create(client) {
    const now = new Date();
    const deviceId = uuid();
    const data = {
      id: deviceId,
      name: null,
      token: null,
      nextToken: null,
      agents: new Map([[
        client.agent,
        new Map([[client.address, now]]),
      ]]),
      createdAt: now,
      checkinAt: now,
      checkoutAt: null,
    };

    return new PlayerDevice(data);
  }

  get id() {
    return this.data.id;
  }
  get name() {
    return this.data.name;
  }
  set name(name) {
    if (name !== null) {
      if (typeof name !== 'string')
        throw new ServerError(400, 'Expected device name');
      if (name.length > 20)
        throw new ServerError(400, 'Device name may not exceed 20 characters');
    }

    this.data.name = name;
    this.emit('change:name');
  }
  get token() {
    return this.data.token;
  }
  set token(token:AccessToken) {
    this.data.token = token;
    this.emit('change:token');
  }
  get nextToken() {
    return this.data.nextToken;
  }
  set nextToken(token:AccessToken) {
    this.data.nextToken = token;
    this.emit('change:nextToken');
  }
  get agents() {
    return this.data.agents;
  }

  get lastSeenAt() {
    return this.data.checkinAt > this.data.checkoutAt ? new Date() : this.data.checkoutAt;
  }
  get ttl() {
    // Delete the object after 3 months of inactivity
    const days = 3 * 30;
    const deviceTTL = Math.round(this.lastSeenAt.getTime() / 1000) + days * 86400;
    if (!this.player)
      return deviceTTL;

    // The device cannot live longer than the player
    return Math.min(this.player.ttl, deviceTTL);
  }

  activateAccessToken(token:AccessToken) {
    this.data.token = token;
    this.data.nextToken = null;
    this.emit('change:activateAccessToken');
  }
  checkin(client, checkinAt = new Date()) {
    this._setAgentAddress(client, checkinAt);
    this.data.checkinAt = checkinAt;
    this.emit('change:checkin');
  }
  checkout(client, checkoutAt = new Date()) {
    this._setAgentAddress(client, checkoutAt);
    this.data.checkoutAt = checkoutAt;
    this.emit('change:checkout');
  }

  _setAgentAddress(client, lastSeenAt:Date) {
    if (this.data.agents.has(client.agent))
      this.data.agents.get(client.agent)!.set(client.address, lastSeenAt);
    else
      this.data.agents.set(client.agent, new Map([[client.address, lastSeenAt]]));

    /*
     * Keep the 10 most recently seen agents and the 10 most recently seen addresses per agent.
     */
    const agents = Array.from(this.data.agents.entries()).map(([ agent, addressMap ]) => {
      const addresses = Array.from(addressMap.entries()).sort((a,b) => b[1].getTime() - a[1].getTime());
      for (let i = 10; i < addresses.length; i++)
        addressMap.delete(addresses[i][0]);

      return { agent, lastSeenAt:addresses[0][1] };
    }).sort((a,b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());

    for (let i = 10; i < agents.length; i++)
      this.data.agents.delete(agents[i].agent);
  }
};

serializer.addType({
  name: 'PlayerDevice',
  constructor: PlayerDevice,
  schema: {
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
      createdAt: { type:'string', subType:'Date' },
      checkinAt: { type:'string', subType:'Date' },
      checkoutAt: { type:'string', subType:'Date' },
    },
    additionalProperties: false,
  },
});
