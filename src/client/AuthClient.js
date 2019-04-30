import jwt from 'jsonwebtoken';

import config from 'config/client.js';

export default class AuthClient {
  constructor(server) {
    Object.assign(this, {
      name: 'auth',
      token: null,
      _server: server,
    });
  }

  /*
   * The business logic in this method is specific to the MVP server release.
   * Creating an account should ultimately be an intentional user decision.
   */
  setAccountName(newName) {
    let server = this.server;
    let token = this.getToken();

    if (token)
      return this.refreshToken()
        .catch(error => {
          if (error.code === 404) {
            this.clearToken();
            return this.setAccountName(newName);
          }

          throw error;
        })
        .then(() => this.authorize())
        .then(() => this.saveProfile({ name:newName }));

    return this.register({ name:newName });
  }

  register(profile) {
    return this._server.request(this.name, 'register', [profile])
      .then(token => this.setToken(token));
  }

  refreshToken() {
    let token = this.getToken();

    return this._server.request(this.name, 'refreshToken', [token])
      .then(token => this.setToken(token));
  }

  authorize() {
    let token = this.getToken();

    return this._server.authorize(this.name, { token });
  }

  saveProfile(profile) {
    return this._server.request(this.name, 'saveProfile', [profile])
      .then(token => this.setToken(token));
  }

  getMyIdentity() {
    let token = this.getToken();
    if (!token) return Promise.resolve();

    let claims = jwt.verify(token, config.publicKey, {
      ignoreExpiration: true,
    });

    return Promise.resolve({
      id: claims.sub,
      name: claims.name,
    });
  }

  setToken(token) {
    localStorage.setItem('token', token);
    return this.token = token;
  }
  getToken() {
    return localStorage.getItem('token');
  }
  clearToken() {
    localStorage.removeItem('token');
    this.token = null;
  }
}
