require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const config = require("./config/config");
const jwt = require("jsonwebtoken");

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Frontend en puerto 5173
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Autenticación de Socket.IO con JWT
io.use((socket, next) => {
  const token = socket.handshake.query.token;
  if (!token) {
    return next(new Error("Token requerido"));
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    socket.userId = decoded.id;
    socket.role = decoded.role;
    next();
  } catch (error) {
    next(new Error("Token inválido"));
  }
});

// Mapa para almacenar conexiones de usuarios
const clients = new Map();

// Manejo de conexiones Socket.IO
io.on("connection", (socket) => {
  console.log(`Usuario ${socket.userId} conectado (Rol: ${socket.role})`);

  // Unir al usuario a sus salas
  socket.join(socket.userId); // Sala individual
  socket.join(socket.role); // Sala por rol (admin, secretary, etc.)
  clients.set(socket.userId, socket);

  // Enviar mensaje de bienvenida
  socket.emit("welcome", `Bienvenido, usuario ${socket.userId}`);

  // Manejar mensajes directos
  socket.on(
    "message",
    async ({ toUserId, orderId, message, type = "message" }) => {
      try {
        // Crear notificación en la base de datos
        const notification =
          await require("./services/notificationService").createNotification({
            order_id: orderId,
            from_user_id: socket.userId,
            to_user_id: toUserId,
            message,
            type,
            status: "Pendiente",
          });
        // La notificación se emite en notificationService.js
        socket.emit("messageSent", {
          message: "Mensaje enviado",
          notification,
        });
      } catch (error) {
        socket.emit("error", {
          message: `Error al enviar mensaje: ${error.message}`,
        });
      }
    }
  );

  // Manejar desconexión
  socket.on("disconnect", () => {
    clients.delete(socket.userId);
    console.log(`Usuario ${socket.userId} desconectado`);
  });

  // Manejar errores
  socket.on("error", (error) => {
    console.error(`Error en Socket.IO para usuario ${socket.userId}:`, error);
  });
});

// Exportar io para usarlo en otros módulos
module.exports = { server, io };

// Iniciar el servidor
server.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
});
