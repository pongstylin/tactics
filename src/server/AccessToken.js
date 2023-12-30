import Token from '#server/Token.js';
import serializer from '#utils/serializer.js';
import ServerError from '#server/Error.js';

export default class AccessToken extends Token {
  static validate(tokenValue, options) {
    super.validate(tokenValue, options);

    const { claims } = this._parse(tokenValue);

    if (!claims.deviceId)
      throw new ServerError(422, 'Expected access token');
  }

  get deviceId() {
    return this.claims.deviceId;
  }
};

serializer.addType({
  name: 'AccessToken',
  constructor: AccessToken,
  schema: {
    type: 'string',
  },
});
