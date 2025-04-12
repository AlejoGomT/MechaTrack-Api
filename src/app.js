const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const userRoutes = require("./routes/userRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const partRoutes = require("./routes/partRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const errorHandler = require("./utils/errorHandler");

const app = express();

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// Rutas
app.use("/api/auth", authRoutes);
app.use("/api/orders", upload.array("images"), orderRoutes);
//app.use("/api/users", userRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/parts", partRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(errorHandler);

// Ruta de prueba
app.get("/", (req, res) => {
  res.json({ message: "API Mechatrack funcionando" });
});

module.exports = app;
