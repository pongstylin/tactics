module.exports = {
  'ping': require('./ping'),
  'register': require('./register'),
  'login': require('./login').loginNormal,
  'loginJWT': require('./login').loginJWT,
  'message': require('./message'),
  'createGame': require('./createGame'),
  'joinGame': require('./joinGame'),
  'submitActions': require('./submitActions'),
  'quickPlay': require('./quickPlay'),
};
