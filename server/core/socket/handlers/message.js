const validator = require('../../../../shared/validator');
const config = require('../../../config');
const commands = require('../../commands/index');
const state = require('../../state');

module.exports = async (socket, data) => {
  console.info('[info] message', data);

  // Clean incoming messages
  data.message = data.message.trim();

  if (!validator.validate({message: data.message}, {message: config.shared.validators.message}).passed) {
    return;
  }

  if (!socket.player) {
    return;
  }

  let type = 'message';
  let socketEmitMethod = 'broadcastRoom';
  const message = data.message.match(/^\/(\w+)\s?(.+)?/);

  // Validate and parse command messages
  if (message && message[1] && commands.hasOwnProperty(message[1])) {
    type = 'command';
    socketEmitMethod = 'emit';
    const args = String(message[2] === undefined ? '' : message[2]).split(' ');
    data.message = await commands[message[1]](socket, data.player, ...args);
  }

  let messageText = data.message;

  // Command messages may return a scope of either player or
  // all. Player will emit to itself and all will broadcast
  // to all players
  if (type === 'command' && typeof data.message === 'object') {
    socketEmitMethod = data.message.scope === 'all' ? 'broadcast' : 'emit';
    messageText = data.message.message;
  }

  socket[socketEmitMethod]('message.received', {
    player: { username: data.player.username },
    message: messageText,
    type,
    timestamp: Date.now(),
  });
};
