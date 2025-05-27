let io = null;

module.exports = {
  init: (socketIo) => {
    io = socketIo;
  },
  getIo: () => {
    if (!io) {
      console.warn("[socket] Socket.IO no está inicializado");
    }
    return io;
  },
};
