// src/controllers/adminOrderController.js
const adminOrderService = require("../services/adminOrderService");
const { validationResult } = require("express-validator");
const { check } = require("express-validator");

const updateAdminOrder = [
  check("type")
    .optional()
    .isIn(["Mantenimiento", "Reparación"])
    .withMessage("El tipo debe ser Mantenimiento o Reparación"),
  check("mileage")
    .optional()
    .isInt({ min: 0 })
    .withMessage("El kilometraje debe ser un número positivo"),
  check("description")
    .optional()
    .isString()
    .trim()
    .withMessage("La descripción debe ser una cadena"),
  check("initial_diagnosis")
    .optional()
    .isString()
    .trim()
    .withMessage("El diagnóstico inicial debe ser una cadena"),
  check("tasks")
    .optional()
    .isString()
    .trim()
    .withMessage("Las tareas deben ser una cadena"),
  check("parts")
    .optional()
    .isArray()
    .withMessage("Los repuestos deben ser un arreglo"),
  check("parts.*.part_id")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del repuesto debe ser un número entero positivo"),
  check("parts.*.quantity")
    .optional()
    .isInt({ min: 0 })
    .withMessage("La cantidad debe ser un número positivo"),
  check("parts.*.price")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("El precio debe ser un número positivo"),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { orderId } = req.params;
      const userId = req.user.id; // ID del admin desde el token
      let orderData = req.body;

      // Manejar imágenes
      const newImages =
        req.files?.map((file) => `/Uploads/${file.filename}`) || [];
      const existingImages = orderData.existingImages
        ? Array.isArray(orderData.existingImages)
          ? orderData.existingImages
          : JSON.parse(orderData.existingImages || "[]")
        : [];
      orderData.images = [...existingImages, ...newImages];

      // Parsear parts si viene como string (desde FormData)
      if (orderData.parts && typeof orderData.parts === "string") {
        orderData.parts = JSON.parse(orderData.parts);
      }

      const updatedOrder = await adminOrderService.updateAdminOrder(
        orderId,
        orderData,
        userId
      );
      res.status(200).json(updatedOrder);
    } catch (error) {
      console.error("Error en updateAdminOrder:", error);
      res.status(error.status || 500).json({
        message: error.message || "Error al actualizar la orden",
        details: error.details || error.message,
      });
    }
  },
];

const addAdminImages = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const newImages =
      req.files?.map((file) => `/Uploads/${file.filename}`) || [];
    const existingImages = req.body.existingImages
      ? Array.isArray(req.body.existingImages)
        ? req.body.existingImages
        : JSON.parse(req.body.existingImages || "[]")
      : [];

    const updatedOrder = await adminOrderService.addAdminImages(
      orderId,
      { images: [...existingImages, ...newImages] },
      userId
    );
    res.status(200).json(updatedOrder);
  } catch (error) {
    console.error("Error en addAdminImages:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al añadir imágenes",
      details: error.details || error.message,
    });
  }
};

const deleteAdminImage = async (req, res) => {
  try {
    const { orderId, imageIndex } = req.params;
    const userId = req.user.id;
    const updatedOrder = await adminOrderService.deleteAdminImage(
      orderId,
      parseInt(imageIndex),
      userId
    );
    res.status(200).json(updatedOrder);
  } catch (error) {
    console.error("Error en deleteAdminImage:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al eliminar imagen",
      details: error.details || error.message,
    });
  }
};

const addAdminPart = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const partData = req.body;

    const result = await adminOrderService.addAdminPart(
      orderId,
      partData,
      userId
    );
    res.status(201).json(result);
  } catch (error) {
    console.error("Error en addAdminPart:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al añadir repuesto",
      details: error.details || error.message,
    });
  }
};

module.exports = {
  updateAdminOrder,
  addAdminImages,
  deleteAdminImage,
  addAdminPart,
};
