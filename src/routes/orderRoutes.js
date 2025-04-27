const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const authenticateToken = require("../middleware/auth");
const { restrictTo } = require("../middleware/role");
const multer = require("multer");
const path = require("path");

// Configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB límite por archivo
    files: 10, // Máximo 10 archivos
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Solo se permiten imágenes JPEG/JPG/PNG"));
  },
}).array("images", 10);

// Middleware para hacer que los archivos sean opcionales
const optionalUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("MulterError:", err);
      return res
        .status(400)
        .json({ message: `Error de multer: ${err.message}` });
    } else if (err) {
      console.error("Error de subida:", err);
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

router.get("/", authenticateToken, orderController.getOrders);
router.get("/:id", authenticateToken, orderController.getOrderById);
router.post(
  "/",
  authenticateToken,
  restrictTo("technician", "admin"),
  optionalUpload,
  orderController.createOrder
);
router.put(
  "/:id",
  authenticateToken,
  restrictTo("technician", "admin"),
  optionalUpload,
  orderController.updateOrder
);
router.post(
  "/:id/parts",
  authenticateToken,
  restrictTo("technician"),
  orderController.requestPart
);
router.put(
  "/:id/parts/:partId",
  authenticateToken,
  restrictTo("technician"),
  orderController.updatePartQuantity
);
router.post(
  "/:id/parts/:partId/return",
  authenticateToken,
  restrictTo("technician"),
  orderController.requestPartReturn
);

module.exports = router;
