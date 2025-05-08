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
  restrictTo("technician", "admin"),
  async (req, res) => {
    try {
      const { id, partId } = req.params;
      const { quantity, status, price, note, authorized_by } = req.body;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Actualizar el repuesto incluyendo authorized_by
        const updateQuery = `
          UPDATE order_parts
          SET quantity = $1, status = $2, price = $3, authorized_by = $4
          WHERE order_id = $5 AND part_id = $6
          RETURNING *
        `;
        const updateValues = [
          quantity,
          status,
          price || null,
          authorized_by || null, // Guardar authorized_by o NULL si no se proporciona
          id,
          partId,
        ];
        const result = await client.query(updateQuery, updateValues);

        if (!result.rows.length) {
          throw { status: 404, message: "Repuesto no encontrado" };
        }

        // Crear notificación si el repuesto es rechazado
        if (status === "Rechazado" && note) {
          const orderResult = await client.query(
            "SELECT technician_id FROM orders WHERE id = $1",
            [id]
          );
          if (orderResult.rows.length) {
            const technicianId = orderResult.rows[0].technician_id;
            await notificationService.createNotification(
              {
                order_id: id,
                from_user_id: req.user.id,
                to_user_id: technicianId,
                message: `Repuesto rechazado: ${note}`,
                type: "part_rejection",
                status: "Pendiente",
              },
              client
            );
          }
        }

        await client.query("COMMIT");
        res.json(result.rows[0]);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Error al actualizar repuesto:", err);
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

      // Validar permisos
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

      // Actualizar order_number si está presente y el usuario es admin
      let updatedOrder = null;
      if (orderNumber && userRole === "admin") {
        updatedOrder = await orderService.updateOrderNumber(id, orderNumber);
      }

      // Actualizar delivery_note_number o invoice_number si están presentes
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

module.exports = router;
