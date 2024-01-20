import ActiveModel from '#models/ActiveModel.js';
import Identity from '#models/Identity.js';
import serializer from '#utils/serializer.js';

export default class Identities extends ActiveModel {
  protected data: Set<string>
  protected identities: Set<Identity>

  constructor(data) {
    super();
    this.data = data;
    this.identities = new Set();
  }

  static create() {
    return new Identities(new Set());
  }
  static fromJSON(data) {
    return new Identities(new Set(data));
  }

  getIds() {
    return [ ...this.data ];
  }
  setValues(identities) {
    this.identities = new Set(identities);
  }

  values() {
    return this.identities.values();
  }

  add(identity) {
    if (this.data.has(identity.id))
      return false;
    if (!identity.needsIndex)
      return false;

    this.data.add(identity.id);
    this.identities.add(identity);
    this.emit({
      type: 'change:add',
      data: { identity },
    });

    return true;
  }
  merge(identity1, identity2, players) {
    identity1.merge(identity2);
    for (const player of players) {
      player.identityId = identity1.id;
      player.identity = identity1;
    }

    this.add(identity1);
    this.data.delete(identity2.id);
    this.identities.delete(identity2);
    this.emit({
      type: 'change:merge',
      data: { identity:identity2 },
    });
  }
  archive(identity) {
    if (!this.identities.has(identity))
      return false;

    this.data.delete(identity.id);
    this.identities.delete(identity);
    this.emit({
      type: 'change:archive',
      data: { identity:identity },
    });

    return true;
  }

  getRelationships(playerId) {
    const relationships = new Map();

    for (const identity of this.identities) {
      const relationship = identity.getRelationship(playerId);
      if (relationship)
        relationships.set(identity.id, {
          type: relationship.type,
          name: relationship.nickname,
        });
    }

    return relationships;
  }
  sharesName(name, forIdentity) {
    const normalizedName = name.toLowerCase().replace(/ /g, '');

    for (const identity of this.identities)
      if (identity !== forIdentity && identity.name?.toLowerCase().replace(/ /g, '') === normalizedName)
        return true;

    return false;
  }
};

serializer.addType({
  name: 'Identities',
  constructor: Identities,
  schema: {
    type: 'array',
    subType: 'Set',
    items: { type:'string', format:'uuid' },
  },
});
