import uuid from 'uuid/v4';

import ActiveModel from 'models/ActiveModel.js';
import Identity from 'models/Identity.js';
import serializer from 'utils/serializer.js';

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
    this.data.add(identity.id);
    this.identities.add(identity);
    this.emit({
      type: 'change:add',
      data: { identity },
    });
  }
  merge(identity1, identity2, players) {
    identity1.merge(identity2);
    for (const player of players) {
      player.identityId = identity1.id;
      player.identity = identity1;
    }

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
