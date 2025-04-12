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
    branch,
    kilometraje,
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
      branch,
      kilometraje,
    });
    res.status(201).json(order);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const updateOrder = async (req, res) => {
  const { id } = req.params;
  const { status, description, initial_diagnosis, tasks, images } = req.body;
  try {
    const updatedOrder = await orderService.updateOrder(id, {
      status,
      description,
      initial_diagnosis,
      tasks,
      images,
    });
    res.json(updatedOrder);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

module.exports = { getOrders, getOrderById, createOrder, updateOrder };
