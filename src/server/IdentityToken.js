import Token from 'server/Token.js';
import serializer from 'utils/serializer.js';

export default class IdentityToken extends Token {
  get playerId() {
    return this.claims.sub;
  }
  get playerName() {
    return this.claims.name;
  }
};

serializer.addType({
  name: 'IdentityToken',
  constructor: IdentityToken,
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema',
    $id: 'IdentityToken',
    type: 'string',
  },
});
