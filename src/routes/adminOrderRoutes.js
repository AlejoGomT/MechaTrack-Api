const express = require("express");
const router = express.Router();
const adminOrderController = require("../controllers/adminOrderController");
const authenticateToken = require("../middleware/auth");
const { restrictTo } = require("../middleware/role");
const multer = require("multer");
const path = require("path");

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
    fileSize: 10 * 1024 * 1024, // 10MB
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

const optionalUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res
        .status(400)
        .json({ message: `Error de multer: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

router.put(
  "/orders/:orderId",
  authenticateToken,
  restrictTo("admin"),
  optionalUpload,
  adminOrderController.updateAdminOrder
);
router.post(
  "/orders/:orderId/images",
  authenticateToken,
  restrictTo("admin"),
  optionalUpload,
  adminOrderController.addAdminImages
);
router.delete(
  "/orders/:orderId/images/:imageIndex",
  authenticateToken,
  restrictTo("admin"),
  adminOrderController.deleteAdminImage
);
router.post(
  "/orders/:orderId/parts",
  authenticateToken,
  restrictTo("admin"),
  adminOrderController.addAdminPart
);
router.put(
  "/orders/:orderId/parts/:partId",
  authenticateToken,
  restrictTo("admin"),
  adminOrderController.editAdminPart
);
router.delete(
  "/orders/:orderId/parts/:partId",
  authenticateToken,
  restrictTo("admin"),
  adminOrderController.deleteAdminPart
);
router.get(
  "/admin-id",
  authenticateToken,
  restrictTo("admin", "secretary"),
  adminOrderController.getAdminId
);

module.exports = router;
