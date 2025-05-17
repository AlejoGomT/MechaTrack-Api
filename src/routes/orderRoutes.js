const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const orderService = require("../services/orderService");
const authenticateToken = require("../middleware/auth");
const { restrictTo } = require("../middleware/role");
const multer = require("multer");
const path = require("path");
const pool = require("../config/database");
const notificationService = require("../services/notificationService");

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

router.get("/counts", authenticateToken, orderController.getOrderCounts);
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
  restrictTo("technician", "admin"),
  async (req, res) => {
    try {
      const { id, partId } = req.params;
      const { quantity, status, authorized_by } = req.body;

      if (!quantity || quantity < 0) {
        return res.status(400).json({ message: "Cantidad inválida" });
      }

      // Validar estado
      const validStatuses = [
        "Solicitado",
        "Aprobado",
        "Rechazado",
        "Devolución Solicitada",
        "Devolución Rechazada",
      ];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ message: "Estado de repuesto inválido" });
      }

      // Para técnicos, solo permitir cambios en estado "Solicitado"
      const partCheck = await orderService.getOrderById(id);
      const part = partCheck?.parts.find((p) => p.part_id === partId);
      if (!part) {
        return res.status(404).json({ message: "Repuesto no encontrado" });
      }
      if (
        req.user.role === "technician" &&
        part.status !== "Solicitado" &&
        (!status || status !== "Solicitado")
      ) {
        return res.status(403).json({
          message: "Solo se pueden editar repuestos en estado Solicitado",
        });
      }

      // Si es eliminación (quantity = 0)
      if (quantity === 0) {
        const result = await orderService.updatePartQuantity(id, partId, 0);
        return res.json(result);
      }

      // Si se aprueba, el admin debe proporcionar authorized_by
      if (status === "Aprobado" && req.user.role === "admin") {
        if (!authorized_by) {
          return res.status(400).json({
            message: "Se requiere el ID del usuario que autoriza",
          });
        }
        const partData = {
          part_id: partId,
          quantity: parseInt(quantity, 10),
          status: "Aprobado",
          requested_by: part.requested_by_id || req.user.id,
          authorized_by,
        };
        await orderService.requestPart(id, partData);
        return res.json({ message: "Repuesto aprobado exitosamente" });
      }

      // Actualización estándar (técnico o admin)
      const result = await orderService.updatePartQuantity(
        id,
        partId,
        parseInt(quantity, 10)
      );
      res.json(result);
    } catch (err) {
      console.error("[orderRoutes] Error al actualizar repuesto:", err);
      res.status(err.status || 500).json({ message: err.message });
    }
  }
);
router.post(
  "/:id/parts/:partId/return",
  authenticateToken,
  restrictTo("technician"),
  orderController.requestPartReturn
);
router.post(
  "/:id/parts/:partId/approve-return",
  authenticateToken,
  restrictTo("admin"),
  async (req, res) => {
    try {
      const { id, partId } = req.params;
      const { status } = req.body; // "Devolución Aprobada" o "Devolución Rechazada"
      const authorizedBy = req.user.id;

      const result = await orderService.approvePartReturn(
        id,
        partId,
        status,
        authorizedBy
      );
      res.json({
        message:
          status === "Devolución Aprobada"
            ? "Devolución aprobada y repuesto eliminado exitosamente"
            : "Devolución rechazada exitosamente",
        part: result,
      });
    } catch (err) {
      console.error("[orderRoutes] Error al aprobar/rechazar devolución:", err);
      res.status(err.status || 500).json({ message: err.message });
    }
  }
);
router.put(
  "/:id/status",
  authenticateToken,
  restrictTo("technician", "admin", "secretary"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const updatedOrder = await orderService.updateOrderStatus(id, status);
      res.json(updatedOrder);
    } catch (err) {
      console.error("Error al actualizar estado de orden:", err);
      res.status(err.status || 500).json({ message: err.message });
    }
  }
);
router.put(
  "/:id/numbers",
  authenticateToken,
  restrictTo("admin", "secretary"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { orderNumber, deliveryNoteNumber, invoiceNumber } = req.body;
      const userRole = req.user.role;

      if (userRole === "secretary" && (orderNumber || deliveryNoteNumber)) {
        return res.status(403).json({
          message:
            "La secretaria no puede actualizar número de pedido ni albarán",
        });
      }
      if (userRole === "admin" && invoiceNumber) {
        return res.status(403).json({
          message: "El administrador no puede actualizar número de factura",
        });
      }

      let updatedOrder = null;
      if (orderNumber && userRole === "admin") {
        updatedOrder = await orderService.updateOrderNumber(id, orderNumber);
      }

      let updatedInvoice = null;
      if (deliveryNoteNumber || invoiceNumber) {
        updatedInvoice = await orderService.updateInvoiceNumbers(
          id,
          { deliveryNoteNumber, invoiceNumber },
          req.user.id
        );
      }

      res.json({
        order: updatedOrder || (await orderService.getOrderById(id)),
        invoice: updatedInvoice,
      });
    } catch (err) {
      console.error("Error al actualizar números de orden/factura:", err);
      res.status(err.status || 500).json({
        message: err.message || "Error al actualizar números de orden/factura",
      });
    }
  }
);
router.delete(
  "/:id/images/:imageIndex",
  authenticateToken,
  restrictTo("admin", "technician"),
  orderController.deleteOrderImage
);

module.exports = router;
