require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const app = require("./app");
const config = require("./config/config");
const jwt = require("jsonwebtoken");
const socket = require("./socket");
const notificationService = require("./services/notificationService");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    transports: ["websocket", "polling"],
    credentials: true,
  },
  allowEIO3: true,
});

socket.init(io);
app.set("io", socket.getIo());

const setupSubscriber = async () => {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    //const pool = new Pool(config.db);
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { sslmode: "require", rejectUnauthorized: false }
          : false,
      //family: 4, // Descomentar si necesitas forzar IPv4
    });

    let client;
    try {
      client = await pool.connect();
      await client.query("LISTEN invoice_created");
      await client.query("LISTEN invoice_updated");
      await client.query("LISTEN invoice_deleted");

      client.on("notification", (msg) => {
        const payload = msg.payload ? JSON.parse(msg.payload) : null;
        if (msg.channel === "invoice_created") {
          io.to("secretary").emit("invoice_created", payload);
        } else if (msg.channel === "invoice_updated") {
          io.to("secretary").emit("invoice_updated", payload);
        } else if (msg.channel === "invoice_deleted") {
          io.to("secretary").emit("invoice_deleted", payload);
        }
      });

      return; // Conexión exitosa, salir del bucle
    } catch (error) {
      retries++;
      console.error(
        `[index] Intento ${retries}/${maxRetries} fallido:`,
        error.message
      );
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error(
            "[index] Error al liberar el cliente:",
            releaseError.message
          );
        }
      }
      await pool.end(); // Cerrar el pool
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

// Iniciar setupSubscriber sin bloquear el servidor
setupSubscriber().catch((error) => {
  console.error("[index] Error crítico en setupSubscriber:", error.message);
});

io.use((socket, next) => {
  const token = socket.handshake.query.token;
  if (!token) {
    console.error("[Socket.IO] Token requerido");
    return next(new Error("Token requerido"));
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    console.log("[Socket.IO] Token verificado, usuario:", decoded);
    socket.userId = decoded.id;
    socket.role = decoded.role;
    next();
  } catch (error) {
    console.error("[Socket.IO] Error verificando token:", error.message);
    next(new Error("Token inválido"));
  }
});

const clients = new Map();

io.on("connection", (socket) => {
  socket.join(socket.userId);
  socket.join(socket.role);
  clients.set(socket.userId, socket);

  socket.on("joinOrder", (orderId) => {
    socket.join(`order_${orderId}`);
  });

  socket.on("join", (room) => {
    socket.join(room);
  });

  socket.on("typing", ({ room, isTyping }) => {
    socket.to(room).emit("typing", { userId: socket.userId, room, isTyping });
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
  });

  socket.on("error", (error) => {
    console.error(`Error en Socket.IO para usuario ${socket.userId}:`, error);
  });
});

module.exports = { server, io };

server.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
});
