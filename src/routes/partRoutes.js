const express = require("express");
const router = express.Router();
const partController = require("../controllers/partController");
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
    fileSize: 10 * 1024 * 1024, // 10MB límite
    files: 1,
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
}).single("image");

// Middleware para subida opcional
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

router.get(
  "/",
  authenticateToken,
  restrictTo("admin", "technician"),
  partController.getParts
);
router.post(
  "/",
  authenticateToken,
  restrictTo("admin"),
  optionalUpload,
  partController.createPart
);
router.put(
  "/:id",
  authenticateToken,
  restrictTo("admin"),
  optionalUpload,
  partController.updatePart
);
router.delete(
  "/:id",
  authenticateToken,
  restrictTo("admin"),
  partController.deletePart
);

module.exports = router;
