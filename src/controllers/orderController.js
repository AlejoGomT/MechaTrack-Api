const fs = require("fs").promises;
const path = require("path");
const orderService = require("../services/orderService");
const notificationService = require("../services/notificationService");
const pool = require("../config/database");

const getOrders = async (req, res) => {
  const {
    status,
    economicNumber,
    orderNumber,
    technician_id,
    page = 1,
    limit = 10,
    serviceType,
    startDate,
    endDate,
  } = req.query;
  try {
    const result = await orderService.getOrders(
      status,
      economicNumber,
      orderNumber,
      serviceType,
      technician_id,
      parseInt(page),
      parseInt(limit),
      startDate,
      endDate
    );
    res.json({
      orders: result.orders,
      total: result.total,
      totalPages: result.totalPages,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const getOrderById = async (req, res) => {
  const { id } = req.params;
  try {
    const order = await orderService.getOrderById(id);
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    const invoiceResult = await pool.query(
      "SELECT invoice_number, delivery_note_number FROM invoices WHERE order_id = $1",
      [id]
    );
    const response = {
      ...order,
      invoice_number: invoiceResult.rows[0]?.invoice_number || null,
      delivery_note_number: invoiceResult.rows[0]?.delivery_note_number || null,
    };
    console.log("[orderController] getOrderById response:", response);
    res.json(response);
  } catch (error) {
    console.error("[orderController] Error en getOrderById:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const getOrderCounts = async (req, res) => {
  const { technician_id } = req.query;
  try {
    const counts = await orderService.getOrderCounts(technician_id);
    res.json(counts);
  } catch (error) {
    console.error("[orderController] Error en getOrderCounts:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const createOrder = async (req, res) => {
  const {
    type,
    description,
    initial_diagnosis,
    tasks,
    technician_id,
    vehicle_economic_number,
    kilometraje,
    branch,
    parts,
  } = req.body;
  const images = req.files?.map((file) => `/uploads/${file.filename}`) || [];
  try {
    console.log("Datos recibidos en createOrder:", {
      body: req.body,
      files: req.files,
    });

    let parsedParts = [];
    if (parts) {
      try {
        parsedParts = Array.isArray(parts) ? parts : JSON.parse(parts);
        if (!Array.isArray(parsedParts)) {
          throw new Error("Parts debe ser un array");
        }
      } catch (error) {
        console.error("Error al parsear parts:", error);
        return res.status(400).json({ message: "Formato inválido para parts" });
      }
    }

    const order = await orderService.createOrder({
      type,
      description,
      initial_diagnosis,
      tasks,
      images,
      technician_id,
      vehicle_economic_number,
      kilometraje: parseInt(kilometraje, 10) || undefined,
      branch,
      parts: parsedParts.map((part) => ({
        part_id: part.part_id,
        quantity: parseInt(part.quantity, 10),
        status: part.status || "Solicitado",
        requested_by: part.requested_by || technician_id,
        authorized_by: part.authorized_by || null,
      })),
    });
    res.status(201).json(order);
  } catch (error) {
    console.error("Error en createOrder controller:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const updateOrder = async (req, res) => {
  const { id } = req.params;
  try {
    const newImages =
      req.files?.map((file) => `/uploads/${file.filename}`) || [];
    const existingImages = req.body.existingImages
      ? Array.isArray(req.body.existingImages)
        ? req.body.existingImages
        : JSON.parse(req.body.existingImages || "[]")
      : [];
    const images = [...existingImages, ...newImages];
    let parts = [];
    if (req.body.parts) {
      try {
        parts = Array.isArray(req.body.parts)
          ? req.body.parts
          : JSON.parse(req.body.parts || "[]");
        if (!Array.isArray(parts)) {
          throw new Error("Parts debe ser un array");
        }
        for (const part of parts) {
          if (
            !part.part_id ||
            String(part.part_id).length > 10 ||
            !part.quantity ||
            !part.requested_by ||
            String(part.requested_by).length > 10
          ) {
            throw new Error(
              `Datos de repuesto inválidos: ${JSON.stringify(part)}`
            );
          }
          const userResult = await pool.query(
            "SELECT id FROM users WHERE id = $1",
            [part.requested_by]
          );
          if (!userResult.rows.length) {
            throw new Error(
              `Usuario con ID ${part.requested_by} no encontrado`
            );
          }
          if (part.authorized_by) {
            if (String(part.authorized_by).length > 10) {
              throw new Error(
                `ID de usuario autorizado excede el límite de 10 caracteres: ${part.authorized_by}`
              );
            }
            const authUserResult = await pool.query(
              "SELECT id FROM users WHERE id = $1",
              [part.authorized_by]
            );
            if (!authUserResult.rows.length) {
              throw new Error(
                `Usuario autorizado con ID ${part.authorized_by} no encontrado`
              );
            }
          }
        }
      } catch (error) {
        console.error("Error al parsear parts:", error);
        return res.status(400).json({ message: error.message });
      }
    }

    const orderData = {
      initial_diagnosis: req.body.initial_diagnosis,
      tasks: req.body.tasks,
      images: images.length > 0 ? images : undefined,
      kilometraje: req.body.kilometraje
        ? parseInt(req.body.kilometraje, 10)
        : undefined,
      branch: req.body.branch,
      vehicle_economic_number: req.body.vehicle_economic_number,
      parts: parts.map((part) => ({
        part_id: part.part_id,
        quantity: parseInt(part.quantity, 10),
        status: part.status || "Solicitado",
        requested_by: part.requested_by,
        authorized_by: part.authorized_by || null,
      })),
    };
    const updatedOrder = await orderService.updateOrder(id, orderData);
    res.json(updatedOrder);
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message || "Error al actualizar la orden",
      details: error.details || error.message,
    });
  }
};

const requestPart = async (req, res) => {
  const { id } = req.params;
  const part = req.body;
  try {
    if (!part.part_id || !part.quantity || !part.requested_by) {
      return res.status(400).json({ message: "Datos de repuesto inválidos" });
    }
    const validStatuses = [
      "Solicitado",
      "Aprobado",
      "Rechazado",
      "Devolución Solicitada",
      "Devolución Rechazada",
    ];
    if (part.status && !validStatuses.includes(part.status)) {
      return res.status(400).json({ message: "Estado de repuesto inválido" });
    }
    await orderService.requestPart(id, {
      part_id: part.part_id,
      quantity: parseInt(part.quantity, 10),
      status: part.status || "Solicitado",
      requested_by: part.requested_by,
      authorized_by: part.authorized_by || null,
    });
    res.status(201).json({ message: "Repuesto solicitado exitosamente" });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const updatePartQuantity = async (req, res) => {
  const { id, partId } = req.params;
  const { quantity } = req.body;
  try {
    if (quantity === undefined || quantity < 0) {
      return res.status(400).json({ message: "Cantidad inválida" });
    }
    await orderService.updatePartQuantity(id, partId, parseInt(quantity, 10));
    res.json({ message: "Cantidad de repuesto actualizada exitosamente" });
  } catch (error) {
    console.error("Error en updatePartQuantity controller:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const requestPartReturn = async (req, res) => {
  const { id, partId } = req.params;
  const { quantity } = req.body;
  try {
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ message: "Cantidad inválida" });
    }
    await orderService.requestPartReturn(id, partId, parseInt(quantity, 10));
    res
      .status(201)
      .json({ message: "Solicitud de devolución enviada exitosamente" });
  } catch (error) {
    console.error("Error en requestPartReturn controller:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const approvePartReturn = async (req, res) => {
  const { id, partId } = req.params;
  const { status } = req.body;
  try {
    if (
      !status ||
      !["Devolución Aprobada", "Devolución Rechazada"].includes(status)
    ) {
      return res.status(400).json({ message: "Estado de devolución inválido" });
    }
    const result = await orderService.approvePartReturn(
      id,
      partId,
      status,
      req.user.id
    );
    res.json({
      message:
        status === "Devolución Aprobada"
          ? "Devolución aprobada y repuesto eliminado exitosamente"
          : "Devolución rechazada exitosamente",
      part: result,
    });
  } catch (error) {
    console.error("Error en approvePartReturn controller:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const deleteOrderImage = async (req, res) => {
  const { id, imageIndex } = req.params;
  try {
    const order = await orderService.getOrderById(id);
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    if (!order.images || order.images.length <= imageIndex) {
      return res.status(400).json({ message: "Índice de imagen inválido" });
    }

    const imagePath = order.images[parseInt(imageIndex)];
    if (!imagePath.startsWith("/uploads/")) {
      console.warn("[orderController] Ruta de imagen inválida:", imagePath);
    } else {
      const filePath = path.resolve(
        __dirname,
        "..",
        "..",
        "uploads",
        path.basename(imagePath)
      );
      try {
        await fs.unlink(filePath);
        console.log(
          "[orderController] Imagen eliminada del sistema de archivos:",
          filePath
        );
      } catch (err) {
        if (err.code === "ENOENT") {
          console.warn("[orderController] Archivo no encontrado:", filePath);
        } else {
          console.error("[orderController] Error al eliminar archivo:", err);
        }
      }
    }
    const updatedImages = order.images.filter(
      (_, index) => index !== parseInt(imageIndex)
    );
    const updatedOrder = await orderService.updateOrder(id, {
      images: updatedImages,
    });
    res.json({ message: "Imagen eliminada exitosamente", order: updatedOrder });
  } catch (error) {
    console.error("[orderController] Error en deleteOrderImage:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const finalizeOrder = async (req, res) => {
  const { id } = req.params;
  const { action, note, status } = req.body;

  try {
    console.log(`[orderController] Finalizando orden #${id}:`, {
      action,
      note,
      status,
    });

    // Validar parámetros
    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ message: "Acción inválida" });
    }
    if (action === "reject" && !note) {
      return res
        .status(400)
        .json({ message: "El motivo de rechazo es obligatorio" });
    }
    if (!status || !["Finalizado", "En Proceso"].includes(status)) {
      return res.status(400).json({ message: "Estado inválido" });
    }

    // Obtener la orden actual
    const order = await orderService.getOrderById(id);
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    if (order.status !== "Pendiente") {
      return res
        .status(400)
        .json({ message: "La orden no está en estado Pendiente" });
    }

    // Preparar datos para actualización
    const orderData = {
      status,
      finalized_at: action === "accept" ? new Date() : null, // Actualizar finalized_at si es accept
    };
    const updatedOrder = await orderService.updateOrder(id, orderData);

    // Registrar en el historial
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO order_history (order_id, description, status, date)
        VALUES ($1, $2, $3, $4)
      `,
        [
          id,
          action === "accept"
            ? "Orden aprobada por administrador"
            : `Orden rechazada: ${note || "Sin motivo"}`,
          updatedOrder.status,
          new Date(),
        ]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Buscar notificación existente
    const orderResult = await pool.query(
      "SELECT technician_id FROM orders WHERE id = $1",
      [id]
    );
    if (!orderResult.rows.length) {
      throw new Error("Técnico no encontrado para la orden");
    }
    const technicianId = orderResult.rows[0].technician_id;

    const notificationResult = await pool.query(
      `
      SELECT * FROM notifications
      WHERE order_id = $1 AND type = 'closure_request'
      ORDER BY updated_at DESC LIMIT 1
    `,
      [id]
    );

    let notification;
    if (notificationResult.rows.length) {
      // Actualizar notificación existente
      const notificationData = {
        message:
          action === "accept"
            ? `Orden #${id} aprobada`
            : `Orden #${id} rechazada: ${note || "Sin motivo"}`,
        type: action === "accept" ? "closure_approval" : "closure_rejection",
        status: "Pendiente",
        from_user_id: req.user.id,
        to_user_id: technicianId,
        updated_at: new Date(),
      };

      const updateQuery = `
        UPDATE notifications
        SET message = $1, type = $2, status = $3, from_user_id = $4, to_user_id = $5, updated_at = $6
        WHERE id = $7
        RETURNING *
      `;
      const updateResult = await pool.query(updateQuery, [
        notificationData.message,
        notificationData.type,
        notificationData.status,
        notificationData.from_user_id,
        notificationData.to_user_id,
        notificationData.updated_at,
        notificationResult.rows[0].id,
      ]);

      notification = updateResult.rows[0];
    } else {
      // Si no existe notificación, crear una (caso de fallback)
      console.warn(
        `[orderController] No se encontró notificación closure_request para order_id: ${id}. Creando una nueva.`
      );
      const notificationData = {
        order_id: id,
        from_user_id: req.user.id,
        to_user_id: technicianId,
        message:
          action === "accept"
            ? `Orden #${id} aprobada`
            : `Orden #${id} rechazada: ${note || "Sin motivo"}`,
        type: action === "accept" ? "closure_approval" : "closure_rejection",
        status: "Pendiente",
      };
      notification = await notificationService.createNotification(
        notificationData
      );
    }

    if (notification) {
      const io = req.app.get("io");
      if (io) {
        const socketNotification = {
          id: notification.id,
          orderId: notification.order_id,
          fromUserId: notification.from_user_id,
          toUserId: notification.to_user_id,
          message: notification.message,
          type: notification.type,
          status: notification.status,
          details: notification.details || {},
          timestamp: notification.updated_at,
        };
        io.to(`order_${id}`).emit("notification", socketNotification);
        io.to(`user_${notification.to_user_id}`).emit(
          "notification",
          socketNotification
        );
        console.log(
          "[orderController] Notificación emitida para order_",
          id,
          ":",
          socketNotification
        );
      } else {
        console.error("[orderController] Instancia io no disponible");
      }
    }

    console.log(`[orderController] Orden finalizada:`, updatedOrder);
    res.json(updatedOrder);
  } catch (error) {
    console.error("[orderController] Error al finalizar orden:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al finalizar la orden",
      details: error.stack,
    });
  }
};

module.exports = {
  getOrders,
  getOrderById,
  getOrderCounts,
  createOrder,
  updateOrder,
  requestPart,
  updatePartQuantity,
  requestPartReturn,
  approvePartReturn,
  deleteOrderImage,
  finalizeOrder,
};
