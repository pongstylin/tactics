import jwt from 'jsonwebtoken';

import config from '#config/server.js';
import ServerError from '#server/Error.js';

export default class Token {
  constructor(tokenValue) {
    const { claims, signature } = Token._parse(tokenValue);

    Object.assign(this, {
      value: tokenValue,
      claims,
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
      allowInsecureKeySizes: true,
      expiresIn: claims.expiresIn,
      subject: claims.subject,
    }));
  }

  static validate(data, options) {
    try {
      jwt.verify(data, config.publicKey, options);
    } catch (error) {
      throw new ServerError(401, error.message);
    }
  }

  static _parse(tokenValue) {
    const [ header, payload, signature ] = tokenValue.split('.');
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        .toString('utf8')
    );

    return { header, payload, claims, signature };
  }

  get playerId() {
    return this.claims.sub;
  }
  get playerName() {
    return this.claims.name;
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
