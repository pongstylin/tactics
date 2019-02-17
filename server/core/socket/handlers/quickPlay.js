const config = require('../../../config');
const UserService = require('../../services/UserService');
const uuid = require('../../../util/uuid');
const validator = require('../../../../shared/validator/index');

module.exports = async (socket, data) => {
  console.info('[info] quickPlay', data);

  const validation = validator.validate(data, config.shared.validators.quickPlay(data));
  if (!validation.passed) {
    console.info('[info] validation failed');
    socket.emit('auth.failed', validation.getErrors());
    return;
  }

  const { playerJSON, err } = await UserService.createUser(data.username, uuid.uuidv4(), true);

  if (err) {
    socket.emit('auth.failed', [err]);
    return;
  }

  socket.state.player = playerJSON;
  socket.emit('auth.succeeded', playerJSON);
};
