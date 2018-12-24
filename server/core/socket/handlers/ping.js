module.exports = socket => {
  console.info('[info] ping');
  socket.emit('pong');
};
