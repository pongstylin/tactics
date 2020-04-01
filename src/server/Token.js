import jwt from 'jsonwebtoken';

import config from 'config/server.js';

export default class Token {
  constructor(tokenValue) {
    if (typeof tokenValue !== 'string')
      throw new TypeError('Expected JWT token string');

    let [header, payload, signature] = tokenValue.split('.');

    Object.assign(this, {
      value: tokenValue,
      claims: JSON.parse(
        Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
          .toString('utf8')
      ),
      signature,
    });
  }
  static create(claims) {
    let data = {};
    for (let [key, value] of Object.entries(claims)) {
      if (key === 'subject') continue;
      if (key === 'expiresIn') continue;

      data[key] = value;
    }

    return new this(jwt.sign(data, config.privateKey, {
      algorithm: 'RS512',
      expiresIn: claims.expiresIn,
      subject: claims.subject,
    }));
  }
  static verify(tokenValue, options) {
    if (!tokenValue) return null;

    try {
      jwt.verify(tokenValue, config.publicKey, options);
    }
    catch (error) {
      throw new ServerError(401, error.message);
    }

    return new this(tokenValue);
  }

  get createdAt() {
    if (this._createdAt !== undefined)
      return this._createdAt;

    return this._createdAt = new Date(this.claims.iat * 1000);
  }
  get expiresAt() {
    if (this._expiresAt !== undefined)
      return this._expiresAt;

    return this._expiresAt = new Date(this.claims.exp * 1000);
  }
  get ttl() {
    if (this._ttl !== undefined)
      return this._ttl;

    return this._ttl = this.expiresAt - this.createdAt;
  }
  get age() {
    return Date.now() - this.createdAt;
  }
  get isExpired() {
    return Date.now() > this.expiresAt;
  }

  data(name) {
    return this.claims[name];
  }
  equals(token) {
    if (typeof token === 'string')
      return this.value === token;
    else if (token instanceof Token)
      return this.value === token.value;

    return false;
  }

  toString() {
    return this.value;
  }
  toJSON() {
    return this.value;
  }
}
