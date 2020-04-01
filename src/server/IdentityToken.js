import Token from 'server/Token.js';

export default class AccessToken extends Token {
  get playerId() {
    return this.claims.sub;
  }
  get playerName() {
    return this.claims.name;
  }
}
