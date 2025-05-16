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
    await orderService.requestPartReturn(id, partId, parseInt(quantity, 10));
    res
      .status(201)
      .json({ message: "Solicitud de devolución enviada exitosamente" });
  } catch (error) {
    console.error("Error en requestPartReturn controller:", error);
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

    const updatedImages = order.images.filter(
      (_, index) => index !== parseInt(imageIndex)
    );
    const updatedOrder = await orderService.updateOrder(id, {
      images: updatedImages,
    });
    res.json({ message: "Imagen eliminada exitosamente", order: updatedOrder });
  } catch (error) {
    console.error("Error en deleteOrderImage controller:", error);
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
    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ message: "Acción inválida" });
    }

    const orderData = {
      status: status || (action === "accept" ? "Finalizado" : "En Proceso"),
    };

    const updatedOrder = await orderService.updateOrder(id, orderData);

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

    if (action === "reject") {
      const orderResult = await pool.query(
        "SELECT technician_id FROM orders WHERE id = $1",
        [id]
      );
      if (orderResult.rows.length) {
        const technicianId = orderResult.rows[0].technician_id;
        await notificationService.createNotification({
          order_id: id,
          from_user_id: req.user.id,
          to_user_id: technicianId,
          message: `Orden #${id} rechazada: ${note || "Sin motivo"}`,
          type: "closure_rejection",
          status: "Pendiente",
        });
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
  deleteOrderImage,
  finalizeOrder,
};
