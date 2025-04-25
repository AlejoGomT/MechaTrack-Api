const orderService = require("../services/orderService");

const getOrders = async (req, res) => {
  const { status, economicNumber, orderNumber, technician_id } = req.query;
  try {
    const orders = await orderService.getOrders(
      status,
      economicNumber,
      orderNumber,
      technician_id
    );
    res.json(orders);
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
    res.json(order);
  } catch (error) {
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
    plate,
    brand,
    model,
    year,
    parts,
  } = req.body;
  const images = req.files?.map((file) => file.path) || [];
  try {
    // Log para depurar datos recibidos
    console.log("Datos recibidos en createOrder:", {
      body: req.body,
      files: req.files,
    });

    // Procesar parts
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

    // Validar campos requeridos
    const requiredFields = {
      type,
      description,
      initial_diagnosis,
      tasks,
      technician_id,
      vehicle_economic_number,
      kilometraje,
      branch,
    };
    for (const [key, value] of Object.entries(requiredFields)) {
      if (!value) {
        console.error(`Campo requerido faltante: ${key}`);
        return res
          .status(400)
          .json({ message: `El campo ${key} es requerido` });
      }
    }

    const order = await orderService.createOrder({
      type,
      description,
      initial_diagnosis,
      tasks,
      images: images.length > 0 ? images : [],
      technician_id,
      vehicle_economic_number,
      kilometraje: parseInt(kilometraje, 10) || undefined,
      branch,
      plate: plate || undefined,
      brand: brand || undefined,
      model: model || undefined,
      year: parseInt(year, 10) || undefined,
      parts: parsedParts.map((part) => ({
        part_id: part.part_id,
        name: part.name,
        quantity: parseInt(part.quantity, 10),
        status: part.status || "Solicitado",
        requested_by: part.requested_by || technician_id,
        authorized_by: part.authorized_by || null,
      })),
    });
    res.status(201).json(order);
  } catch (error) {
    console.error("Error en createOrder controller:", error);
    if (error.message.includes("Unexpected end of form")) {
      return res
        .status(400)
        .json({ message: "Formato de formulario inválido" });
    }
    res.status(error.status || 500).json({ message: error.message });
  }
};

const updateOrder = async (req, res) => {
  const { id } = req.params;
  try {
    const newImages = req.files?.map((file) => file.path) || [];
    const existingImages = req.body.existingImages
      ? Array.isArray(req.body.existingImages)
        ? req.body.existingImages
        : [req.body.existingImages]
      : [];
    const images = [...existingImages, ...newImages];
    const parts = req.body.parts
      ? Array.isArray(req.body.parts)
        ? req.body.parts
        : JSON.parse(req.body.parts)
      : [];
    const orderData = {
      initial_diagnosis: req.body.initial_diagnosis,
      tasks: req.body.tasks,
      images: images.length > 0 ? images : undefined,
      parts: parts.map((part) => ({
        part_id: part.part_id,
        name: part.name,
        quantity: parseInt(part.quantity, 10),
        status: part.status || "Solicitado",
        requested_by: part.requested_by,
        authorized_by: part.authorized_by || null,
      })),
      kilometraje: req.body.kilometraje
        ? parseInt(req.body.kilometraje, 10)
        : undefined,
      branch: req.body.branch,
    };
    const updatedOrder = await orderService.updateOrder(id, orderData);
    res.json(updatedOrder);
  } catch (error) {
    console.error("Error en updateOrder controller:", error);
    if (error.message.includes("Unexpected end of form")) {
      return res
        .status(400)
        .json({ message: "Formato de formulario inválido" });
    }
    res.status(error.status || 500).json({
      message: error.message || "Error al actualizar la orden",
      details: error.stack,
    });
  }
};

const requestPart = async (req, res) => {
  const { id } = req.params;
  const part = req.body;
  try {
    await orderService.requestPart(id, {
      part_id: part.part_id,
      name: part.name,
      quantity: parseInt(part.quantity, 10),
      status: part.status || "Solicitado",
      requested_by: part.requested_by,
      authorized_by: part.authorized_by || null,
    });
    res.status(201).json({ message: "Repuesto solicitado exitosamente" });
  } catch (error) {
    console.error("Error en requestPart controller:", error);
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

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  requestPart,
  updatePartQuantity,
  requestPartReturn,
};
