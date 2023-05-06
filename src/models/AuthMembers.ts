import ActiveModel from 'models/ActiveModel.js';
import serializer from 'utils/serializer.js';

export default class AuthMembers extends ActiveModel {
  protected data: {
    provider: string
    links: Map<string,string>
  }
  protected reverseLinks: Map<string,string>

  constructor(data) {
    super();
    this.data = data;
    this.reverseLinks = new Map(Array.from(data.links, a => [ a[1], a[0] ]));
  }

  static create(provider) {
    return new AuthMembers({
      provider,
      links: new Map(),
    });
  }

  get provider() {
    return this.data.provider;
  }

  hasMemberId(playerId) {
    return this.reverseLinks.has(playerId);
  }
  deletePlayerId(memberId) {
    const playerId = this.data.links.get(memberId);
    if (!playerId)
      return false;

    this.data.links.delete(memberId);
    this.reverseLinks.delete(playerId);
    this.emit({ type:'change:unlink', data:{ playerId, memberId } });

    return true;
  }
  deleteMemberId(playerId) {
    const memberId = this.reverseLinks.get(playerId);
    if (!memberId)
      return false;

    this.data.links.delete(memberId);
    this.reverseLinks.delete(playerId);
    this.emit({ type:'change:unlink', data:{ playerId, memberId } });

    return true;
  }

  setPlayerId(memberId, playerId) {
    if (this.data.links.get(memberId) === playerId)
      return false;

    // Enforce one-to-one relationships.
    this.deleteMemberId(playerId);

    this.data.links.set(memberId, playerId);
    this.reverseLinks.set(playerId, memberId);
    this.emit({ type:'change:link', data:{ playerId, memberId } });

    return true;
  }
  getPlayerId(memberId) {
    return this.data.links.get(memberId) ?? null;
  }
};

serializer.addType({
  name: 'AuthMembers',
  constructor: AuthMembers,
  schema: {
    type: 'object',
    required: [ 'provider', 'links' ],
    properties: {
      provider: { type:'string', format:'uuid' },
      links: {
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
});
