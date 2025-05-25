require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const createSubscriber = require("pg-listen");
const app = require("./app");
const config = require("./config/config");
const jwt = require("jsonwebtoken");
const socket = require("./socket");
const notificationService = require("./services/notificationService");

// Crear servidor HTTP
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    transports: ["websocket", "polling"],
    credentials: true,
  },
  allowEIO3: true,
});

// Inicializar io en socket.js
socket.init(io);

// Hacer que io esté disponible en los controladores
app.set("io", socket.getIo());

// Función para crear y conectar un nuevo subscriber
const setupSubscriber = async () => {
  const subscriber = createSubscriber({
    user: config.db.user,
    host: config.db.host,
    database: config.db.database,
    password: config.db.password,
    port: config.db.port,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
  });

  subscriber.events.on("error", (error) => {
    console.error("[index] Error en pg-listen:", error.message);
  });

  try {
    await subscriber.connect();
    await subscriber.listenTo("invoice_created");
    await subscriber.listenTo("invoice_updated");
    await subscriber.listenTo("invoice_deleted");

    subscriber.notifications.on("invoice_created", (payload) => {
      io.to("secretary").emit("invoice_created", payload);
      console.log(
        "[index] Emitiendo invoice_created a sala secretary:",
        payload
      );
    });

    subscriber.notifications.on("invoice_updated", (payload) => {
      io.to("secretary").emit("invoice_updated", payload);
      console.log(
        "[index] Emitiendo invoice_updated a sala secretary:",
        payload
      );
    });

    subscriber.notifications.on("invoice_deleted", (payload) => {
      io.to("secretary").emit("invoice_deleted", payload);
      console.log(
        "[index] Emitiendo invoice_deleted a sala secretary:",
        payload
      );
    });

    console.log("[index] pg-listen conectado y escuchando notificaciones");
  } catch (error) {
    console.error("[index] Error conectando a pg-listen:", error.message);
    console.error("[index] Reintentando en 5 segundos...");
    await subscriber.close(); // Cerrar el subscriber antes de reintentar
    setTimeout(setupSubscriber, 5000);
  }
};

// Iniciar el subscriber
setupSubscriber();

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
module.exports = { server, io };

// Iniciar el servidor
server.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
});
