const config = require('../../../config');
const UserService = require('../../services/UserService');
const validator = require('../../../../shared/validator/index');

module.exports = async (socket, data) => {
  console.info('[info] register', data);

  const validation = validator.validate(data, config.shared.validators.register(data));

  if (!validation.passed) {
    socket.emit('auth.failed', validation.getErrors());
    return;
  }
  const { playerJSON, err } = await UserService.createUser(data.username, data.password);

  if (err) {
    socket.emit('auth.failed', [err]);
    return;
  }

  socket.player = playerJSON;
  socket.emit('auth.succeeded', playerJSON);
};
