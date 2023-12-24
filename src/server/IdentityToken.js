import Token from '#server/Token.js';
import serializer from '#utils/serializer.js';
import ServerError from '#server/Error.js';

export default class IdentityToken extends Token {
  static validate(tokenValue, options) {
    super.validate(tokenValue, options);

    const { claims } = this._parse(tokenValue);

    if (claims.deviceId)
      throw new ServerError(422, 'Expected identity token');
  }
};

serializer.addType({
  name: 'IdentityToken',
  constructor: IdentityToken,
  schema: {
    type: 'string',
  },
});
