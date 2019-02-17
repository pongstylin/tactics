const config = require('../../../config');
const validator = require('../../../../shared/validator/index');

module.exports = async (socket, data) => {
  console.info('[info] joinRoom', data);

  if (!validator.validate(data,  config.shared.validators.joinRoom(data)).passed) {
    console.info('[info] invalid data');
    return;
  }

  if (!socket.player) {
    return;
  }

  socket.joinRoom(data.room, socket.player.username);
  socket.broadcastRoom('roomOccupantsChanged', { occupants: socket.room.occupantList });
};
