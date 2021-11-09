import IdentityToken from 'server/IdentityToken.js';
import serializer from 'utils/serializer.js';
import ServerError from 'server/Error.js';

export default class AccessToken extends IdentityToken {
  get deviceId() {
    return this.claims.deviceId;
  }

  static verify(tokenValue, options) {
    let token = super.verify(tokenValue, options);
    if (!token.deviceId)
      throw new ServerError(401, 'Expected access token');

    return token;
  }
};

serializer.addType({
  name: 'AccessToken',
  constructor: AccessToken,
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema',
    $id: 'AccessToken',
    type: 'string',
  },
});
