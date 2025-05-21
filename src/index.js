require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const config = require("./config/config");
const jwt = require("jsonwebtoken");
const socket = require("./socket"); // Importar socket.js
const notificationService = require("./services/notificationService");

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

// Inicializar io en socket.js
socket.init(io);

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
  socket.join(socket.userId);
  socket.join(socket.role);
  clients.set(socket.userId, socket);

  // Manejar unión a salas de órdenes
  socket.on("joinOrder", (orderId) => {
    socket.join(`order_${orderId}`);
    console.log(`[Socket] Usuario ${socket.userId} se unió a order_${orderId}`);
  });

  // Enviar mensaje de bienvenida
  socket.emit("welcome", `Bienvenido, usuario ${socket.userId}`);

  // Manejar mensajes directos
  socket.on(
    "message",
    async ({ toUserId, orderId, message, type = "message" }) => {
      try {
        const notification = await notificationService.createNotification({
          order_id: orderId,
          from_user_id: socket.userId,
          to_user_id: toUserId,
          message,
          type,
          status: "Pendiente",
        });
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

// Exportar server para usarlo en otros módulos
module.exports = { server, io }; // Mantener io por compatibilidad, pero socket.js es la fuente principal

// Iniciar el servidor
server.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
});
