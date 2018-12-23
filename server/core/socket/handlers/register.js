module.exports = (socket, data) => {
  console.info('[info] register', data);

  const player = {
    id: 1,
    username: data.username,
    stats: 750,
  };

  socket.emit('registered', player);
};
