import ActiveModel from '#models/ActiveModel.js';
import serializer from '#utils/serializer.js';

interface Links {
  // One-to-one relationships between memberId and playerId.
  active: Map<string,string>
  // Many-to-one relationships between memberId and playerId.
  // (Many memberIds might be associated with one playerId)
  inactive: Map<string,string>
}

export default class Provider extends ActiveModel {
  protected data: {
    id: string
    links: Links
  }
  protected reverseLinks: Map<string,string>

  constructor(data) {
    super();
    this.data = data;
    this.reverseLinks = new Map();

    for (const [ memberId, playerId ] of data.links.active) {
      this.reverseLinks.set(playerId, memberId);
    }
  }

  static create(providerId) {
    return new Provider({
      id: providerId,
      links: {
        active: new Map(),
        inactive: new Map(),
      },
    });
  }

  get id() {
    return this.data.id;
  }

  getActivePlayerId(memberId) {
    return this.data.links.active.get(memberId) ?? null;
  }

  getLinkByMemberId(memberId) {
    if (this.data.links.active.has(memberId))
      return {
        playerId: this.data.links.active.get(memberId),
        memberId: memberId,
        active: true,
      };
    else if (this.data.links.inactive.has(memberId))
      return {
        playerId: this.data.links.inactive.get(memberId),
        memberId: memberId,
        active: false,
      };
    else
      return null;
  }

  linkPlayerId(playerId, memberId) {
    if (this.data.links.active.get(memberId) === playerId)
      return false;

    // The player may only have one active link to a memberId.
    // So archive the old active link if there was one.
    if (this.reverseLinks.has(playerId))
      this.data.links.inactive.set(this.reverseLinks.get(playerId)!, playerId);

    this.reverseLinks.set(playerId, memberId);
    this.data.links.active.set(memberId, playerId);
    this.data.links.inactive.delete(memberId);
    this.emit('change:linkPlayerId');

    return true;
  }
  unlinkPlayerId(playerId) {
    const memberId = this.reverseLinks.get(playerId);
    if (!memberId)
      return false;
    if (!this.data.links.active.has(memberId))
      return false;

    this.reverseLinks.delete(memberId);
    this.data.links.active.delete(memberId);
    this.data.links.inactive.set(memberId, playerId);
    this.emit('change:unlinkPlayerId');

    return true;
  }
};

serializer.addType({
  name: 'Provider',
  constructor: Provider,
  schema: {
    type: 'object',
    required: [ 'id', 'links' ],
    properties: {
      id: { type:'string' },
      links: {
        type: 'object',
        required: [ 'active', 'inactive' ],
        properties: {
          active: {
            type: 'array',
            subType: 'Map',
            items: {
              type: 'array',
              items: [
                { type:'string' },
                { type:'string', format:'uuid' },
              ],
              additionalItems: false,
            },
          },
          inactive: {
            type: 'array',
            subType: 'Map',
            items: {
              type: 'array',
              items: [
                { type:'string' },
                { type:'string', format:'uuid' },
              ],
              additionalItems: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
});
