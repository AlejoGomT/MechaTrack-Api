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
  } = req.body;
  const images = req.files?.map((file) => file.path) || [];
  try {
    const order = await orderService.createOrder({
      type,
      description,
      initial_diagnosis,
      tasks,
      images,
      technician_id,
      vehicle_economic_number,
      kilometraje,
      branch,
    });
    res.status(201).json(order);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const updateOrder = async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Datos recibidos en updateOrder:", req.body, req.files);
    const newImages = req.files?.map((file) => file.path) || [];
    const existingImages = Array.isArray(req.body.existingImages)
      ? req.body.existingImages
      : req.body.existingImages
      ? [req.body.existingImages]
      : [];
    const images = [...existingImages, ...newImages];
    const orderData = {
      initial_diagnosis: req.body.initial_diagnosis,
      tasks: req.body.tasks,
      images: images.length > 0 ? images : undefined,
      kilometraje: req.body.kilometraje
        ? parseInt(req.body.kilometraje, 10)
        : undefined,
      branch: req.body.branch,
    };
    console.log("Enviando a orderService.updateOrder:", orderData);
    const updatedOrder = await orderService.updateOrder(id, orderData);
    res.json(updatedOrder);
  } catch (error) {
    console.error("Error en updateOrder controller:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al actualizar la orden",
      details: error.stack,
    });
  }
};

module.exports = { getOrders, getOrderById, createOrder, updateOrder };
