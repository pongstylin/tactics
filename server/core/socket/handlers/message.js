module.exports = (socket, data) => {
  console.info('[info] message', data);

  socket.broadcast('message.received', {
    player: data.player,
    message: data.message,
    timestamp: Date.now(),
  });
};
