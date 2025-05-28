require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const createSubscriber = require("pg-listen");
const { parse } = require("pg-connection-string");
const app = require("./app");
const config = require("./config/config");
const jwt = require("jsonwebtoken");
const socket = require("./socket");
const notificationService = require("./services/notificationService");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://mechatrack-front.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    transports: ["websocket", "polling"],
    credentials: true,
  },
  allowEIO3: true,
});

socket.init(io);
app.set("io", socket.getIo());

const setupSubscriber = async () => {
  const parsedConfig = parse(process.env.DATABASE_URL);

  const subscriber = createSubscriber({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { sslmode: "require", rejectUnauthorized: false }
        : false,
  });

  subscriber.events.on("error", (error) => {
    console.error("[index] Error en pg-listen:", error.message);
  });

  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await subscriber.connect();
      await subscriber.listenTo("invoice_created");
      await subscriber.listenTo("invoice_updated");
      await subscriber.listenTo("invoice_deleted");

      subscriber.notifications.on("invoice_created", (payload) => {
        io.to("secretary").emit("invoice_created", payload);
        console.log(
          "[index] Emitiendo invoice_created a sala beberapa:",
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
      return;
    } catch (error) {
      retries++;
      console.error(
        `[index] Intento ${retries}/${maxRetries} fallido:`,
        error.message
      );
      if (retries === maxRetries) {
        console.error(
          "[index] Máximo de reintentos alcanzado. No se pudo conectar a la base de datos."
        );
        throw error;
      }
      console.error(`[index] Reintentando en 5 segundos...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

setupSubscriber();

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

const clients = new Map();

io.on("connection", (socket) => {
  console.log(`Usuario ${socket.userId} conectado (Rol: ${socket.role})`);

  socket.join(socket.userId);
  socket.join(socket.role);
  clients.set(socket.userId, socket);

  socket.on("joinOrder", (orderId) => {
    socket.join(`order_${orderId}`);
    console.log(`[Socket] Usuario ${socket.userId} se unió a order_${orderId}`);
  });

  socket.on("join", (room) => {
    socket.join(room);
    console.log(`[Socket] Usuario ${socket.userId} se unió a ${room}`);
  });

  socket.on("typing", ({ room, isTyping }) => {
    socket.to(room).emit("typing", { userId: socket.userId, room, isTyping });
    console.log(
      `[Socket] Usuario ${socket.userId} ${
        isTyping ? "está escribiendo" : "dejó de escribir"
      } en ${room}`
    );
  });

  socket.emit("welcome", `Bienvenido, usuario ${socket.userId}`);

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
        io.to(toUserId).to(socket.userId).emit("notification", {
          id: notification.id,
          orderId,
          fromUserId: socket.userId,
          toUserId,
          message,
          type,
          status: "Pendiente",
          timestamp: new Date(),
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

  socket.on("disconnect", () => {
    clients.delete(socket.userId);
    console.log(`Usuario ${socket.userId} desconectado`);
  });

  socket.on("error", (error) => {
    console.error(`Error en Socket.IO para usuario ${socket.userId}:`, error);
  });
});

module.exports = { server, io };

server.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
});
