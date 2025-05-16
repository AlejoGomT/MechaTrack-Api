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
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (quantity === 0 || quantity === undefined) {
          console.log("[orderRoutes] Eliminando repuesto:", { id, partId });
          const deleteQuery = `
            DELETE FROM order_parts
            WHERE order_id = $1 AND part_id = $2
            RETURNING *
          `;
          const deleteValues = [id, partId];
          const result = await client.query(deleteQuery, deleteValues);

          await notificationService.deletePartRequestNotification(
            id,
            partId,
            client
          );
          await client.query("COMMIT");
          return res.json({
            message: "Repuesto eliminado exitosamente",
            deleted: true,
          });
        }

        // Validar estado del repuesto
        const partCheck = await client.query(
          "SELECT status FROM order_parts WHERE order_id = $1 AND part_id = $2",
          [id, partId]
        );
        if (!partCheck.rows.length) {
          throw { status: 404, message: "Repuesto no encontrado" };
        }
        if (
          req.user.role === "technician" &&
          partCheck.rows[0].status !== "Solicitado"
        ) {
          throw {
            status: 400,
            message: "Solo se pueden editar repuestos en estado Solicitado",
          };
        }

        // Obtener precio desde la tabla parts
        const partResult = await client.query(
          "SELECT price FROM parts WHERE id = $1",
          [partId]
        );
        if (!partResult.rows.length) {
          throw {
            status: 400,
            message: `Repuesto con ID ${partId} no encontrado`,
          };
        }
        const partPrice = partResult.rows[0].price;

        // Validar inventario si se aprueba
        if (status === "Aprobado") {
          const availablePart = await client.query(
            "SELECT quantity AS available_quantity FROM parts WHERE id = $1",
            [partId]
          );
          if (!availablePart.rows.length) {
            throw {
              status: 400,
              message: `Repuesto con ID ${partId} no encontrado`,
            };
          }
          const availableQuantity = parseInt(
            availablePart.rows[0].available_quantity,
            10
          );
          if (quantity > availableQuantity) {
            throw {
              status: 400,
              message: `Inventario insuficiente para el repuesto ${partId}. Disponible: ${availableQuantity}, Solicitado: ${quantity}`,
            };
          }
          await partService.updatePartInventory(partId, quantity);
        }

        const updateQuery = `
          UPDATE order_parts
          SET quantity = $1, status = $2, price = $3, authorized_by = $4
          WHERE order_id = $5 AND part_id = $6
          RETURNING *
        `;
        const updateValues = [
          quantity,
          status || partCheck.rows[0].status,
          partPrice,
          authorized_by || null,
          id,
          partId,
        ];
        const result = await client.query(updateQuery, updateValues);

        if (!result.rows.length) {
          throw { status: 404, message: "Repuesto no encontrado" };
        }

        await client.query("COMMIT");
        res.json({
          message: "Repuesto actualizado exitosamente",
          part: result.rows[0],
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
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
