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
      const { quantity, status, authorized_by, note } = req.body;
      const userRole = req.user.role;
      const userId = req.user.id;

      // Validar entrada
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

      // Obtener el repuesto actual
      const partCheck = await orderService.getOrderById(id);
      const part = partCheck?.parts.find((p) => p.part_id === partId);
      if (!part) {
        return res.status(404).json({ message: "Repuesto no encontrado" });
      }

      // Restricciones para técnicos
      if (
        userRole === "technician" &&
        part.status !== "Solicitado" &&
        part.status !== "Rechazado" &&
        (!status || (status !== "Solicitado" && status !== "Rechazado"))
      ) {
        return res.status(403).json({
          message: "Solo se pueden editar repuestos en estado Solicitado",
        });
      }

      // Manejar eliminación (quantity = 0)
      if (quantity === 0) {
        const result = await orderService.updatePartQuantity(id, partId, 0);
        return res.json(result);
      }

      // Validar inventario para aprobación
      if (status === "Aprobado" && userRole === "admin") {
        if (!authorized_by) {
          return res.status(400).json({
            message: "Se requiere el ID del usuario que autoriza",
          });
        }
        const partData = await pool.query(
          "SELECT quantity, quantity_reserved FROM parts WHERE id = $1 FOR UPDATE",
          [partId]
        );
        if (!partData.rows.length) {
          return res.status(400).json({
            message: `Repuesto con ID ${partId} no encontrado`,
          });
        }
        const availableQuantity =
          partData.rows[0].quantity -
          partData.rows[0].quantity_reserved +
          part.quantity;
        if (quantity > availableQuantity) {
          return res.status(400).json({
            message: `Inventario insuficiente para el repuesto ${partId}. Disponible: ${availableQuantity}, Solicitado: ${quantity}`,
          });
        }
      }

      // Validar note para rechazo
      if (status === "Rechazado" && !note) {
        return res.status(400).json({
          message: "El motivo de rechazo es obligatorio",
        });
      }

      // Actualizar order_parts
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const updateQuery = `
          UPDATE order_parts
          SET quantity = $1, status = $2, authorized_by = $3, note = $4
          WHERE order_id = $5 AND part_id = $6
          RETURNING *
        `;
        const updateValues = [
          quantity,
          status || part.status,
          status === "Aprobado" || status === "Rechazado"
            ? authorized_by || userId
            : part.authorized_by_id,
          status === "Rechazado" ? note : null,
          id,
          partId,
        ];
        const updateResult = await client.query(updateQuery, updateValues);
        if (!updateResult.rows.length) {
          throw new Error("No se pudo actualizar el repuesto");
        }

        // Ajustar quantity_reserved si es necesario
        const quantityDiff = quantity - part.quantity;
        if (
          quantityDiff !== 0 &&
          status !== "Aprobado" &&
          status !== "Rechazado"
        ) {
          await client.query(
            "UPDATE parts SET quantity_reserved = GREATEST(quantity_reserved + $1, 0) WHERE id = $2",
            [quantityDiff, partId]
          );
        }

        await client.query("COMMIT");

        // Emitir notificación Socket.IO
        if (status === "Aprobado" || status === "Rechazado") {
          console.log(
            "[orderRoutes] Buscando notificación para order_id: %s, part_id: %s",
            id,
            partId
          );
          const notificationResult = await pool.query(
            `SELECT * FROM notifications
             WHERE order_id = $1 AND type IN ('part_approval', 'part_rejection')
             AND (details->>'part_id')::text = $2
             ORDER BY updated_at DESC LIMIT 1`,
            [id, partId]
          );
          if (notificationResult.rows[0]) {
            const io = req.app.get("io");
            console.log("[orderRoutes] Instancia io disponible: %s", !!io);
            if (io) {
              const socketNotification = {
                id: notificationResult.rows[0].id,
                orderId: id,
                fromUserId: notificationResult.rows[0].from_user_id,
                toUserId: notificationResult.rows[0].to_user_id,
                message: notificationResult.rows[0].message,
                type: notificationResult.rows[0].type,
                status: notificationResult.rows[0].status,
                details: notificationResult.rows[0].details,
                timestamp: notificationResult.rows[0].updated_at,
              };
              io.to(`order_${id}`).emit("notification", socketNotification);
              if (notificationResult.rows[0].to_user_id) {
                io.to(`user_${notificationResult.rows[0].to_user_id}`).emit(
                  "notification",
                  socketNotification
                );
              }
              console.log(
                "[orderRoutes] Notificación emitida para order_",
                id,
                ":",
                socketNotification
              );
            } else {
              console.error("[orderRoutes] Instancia io no disponible");
            }
          } else {
            console.warn(
              "[orderRoutes] No se encontró notificación para order_id: %s, part_id: %s",
              id,
              partId
            );
          }
        }

        res.json({
          message: `Repuesto ${
            status === "Aprobado"
              ? "aprobado"
              : status === "Rechazado"
              ? "rechazado"
              : "actualizado"
          } exitosamente`,
          part: updateResult.rows[0],
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
router.post(
  "/:id/parts/:partId/approve-return",
  authenticateToken,
  restrictTo("admin"),
  async (req, res) => {
    try {
      const { id, partId } = req.params;
      const { status } = req.body;
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
router.put(
  "/:id/finalize",
  authenticateToken,
  restrictTo("admin"),
  orderController.finalizeOrder
);

module.exports = router;
