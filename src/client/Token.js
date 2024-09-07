import serializer from 'utils/serializer.js';

export default class Token {
  constructor(value) {
    if (typeof value !== 'string')
      throw new TypeError('Expected JWT token string');

    Object.assign(this, {
      value: value,
      claims: this._getClaims(value),
    });
  }

  get playerId() {
    return this.claims.sub;
  }
  get playerName() {
    return this.claims.name ?? null;
  }
  get confirmPlayerName() {
    return this.claims.confirmName ?? null;
  }
  get deviceId() {
    return this.claims.deviceId;
  }
  get isVerified() {
    return this.claims.verified;
  }
  get createdAt() {
    return new Date(this.claims.iat * 1000);
  }
  get expiresAt() {
    return new Date(this.claims.exp * 1000);
  }
  // Remaining time till expiration, in ms
  get expiresIn() {
    return this.expiresAt - Date.now();
  }
  get isExpired() {
    return this.expiresAt < Date.now();
  }

  equals(token) {
    if (typeof token === 'string')
      return this.value === token;
    else if (token instanceof Token)
      return this.value === token.value;

    return false;
  }

  _getClaims(value) {
    // Decode the Base64 encoded payload in the JWT.
    let payload = atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    // Convert UTF-8 sequences to characters.
    payload = decodeURIComponent(
      payload.split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    return JSON.parse(payload);
  }

  toString() {
    return this.value;
  }
  toJSON() {
    return this.value;
  }
};

export class IdentityToken extends Token {
};

export class AccessToken extends Token {
};

/*
 * The IdentityToken and AccessToken classes are currently only imported server-
 * side since they import the 'jsonwebtoken' package and I don't want to bloat
 * the client-side JS bundles.  So, map those classes to these.
 */
serializer.addType({
  name: 'IdentityToken',
  constructor: IdentityToken,
  schema: {
    type: 'string',
  },
});
serializer.addType({
  name: 'AccessToken',
  constructor: AccessToken,
  schema: {
    type: 'string',
  },
});
