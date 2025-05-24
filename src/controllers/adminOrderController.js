const adminOrderService = require("../services/adminOrderService");
const { validationResult } = require("express-validator");
const { check } = require("express-validator");

const updateAdminOrder = [
  (req, res, next) => {
    if (req.body.parts && typeof req.body.parts === "string") {
      try {
        req.body.parts = JSON.parse(req.body.parts);
      } catch (error) {
        return res.status(400).json({
          errors: [
            {
              location: "body",
              msg: "Formato de repuestos inválido",
              path: "parts",
              value: req.body.parts,
            },
          ],
        });
      }
    }
    next();
  },
  // Validaciones
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
    .isString()
    .withMessage("El ID del repuesto debe ser una cadena"),
  check("parts.*.quantity")
    .optional()
    .isInt({ min: 0 })
    .withMessage("La cantidad debe ser un número positivo"),
  check("parts.*.price")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("El precio debe ser un número positivo"),
  check("parts.*.requested_by")
    .optional()
    .isString()
    .withMessage("El solicitante debe ser una cadena"),
  check("parts.*.authorized_by")
    .optional()
    .isString()
    .withMessage("El autorizante debe ser una cadena")
    .custom((value) => value === null || typeof value === "string")
    .withMessage("El autorizante debe ser una cadena o null"),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { orderId } = req.params;
      const userId = req.user.id; // ID del admin desde el token
      let orderData = req.body;

      const newImages =
        req.files?.map((file) => `/Uploads/${file.filename}`) || [];
      let existingImages = [];
      if (orderData.existingImages) {
        try {
          existingImages = Array.isArray(orderData.existingImages)
            ? orderData.existingImages
            : JSON.parse(orderData.existingImages);
          if (!Array.isArray(existingImages)) {
            throw new Error("existingImages debe ser un arreglo");
          }
        } catch (error) {
          console.error("Error al parsear existingImages:", error);
          existingImages = [];
        }
      }
      orderData.images = [...existingImages, ...newImages];

      // Log para depuración
      console.log("[updateAdminOrder] newImages:", newImages);
      console.log("[updateAdminOrder] existingImages:", existingImages);
      console.log("[updateAdminOrder] orderData.images:", orderData.images);

      const updatedOrder = await adminOrderService.updateAdminOrder(
        orderId,
        orderData,
        userId
      );

      req.io?.emit("orderUpdated", {
        orderId,
        updatedOrder,
      });
      console.log("[updateAdminOrder] Emitiendo orderUpdated:", {
        orderId,
        updatedOrder,
      });

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
    let existingImages = [];
    if (req.body.existingImages) {
      try {
        existingImages = Array.isArray(req.body.existingImages)
          ? req.body.existingImages
          : JSON.parse(req.body.existingImages);
        if (!Array.isArray(existingImages)) {
          throw new Error("existingImages debe ser un arreglo");
        }
      } catch (error) {
        console.error(
          "[addAdminImages] Error al parsear existingImages:",
          error
        );
        return res
          .status(400)
          .json({ message: "Formato inválido de existingImages" });
      }
    }

    const images = [...new Set([...existingImages, ...newImages])]; // Evitar duplicados
    console.log("[addAdminImages] Imágenes a guardar:", images);

    const updatedOrder = await adminOrderService.addAdminImages(
      orderId,
      { images },
      userId
    );

    if (!updatedOrder.order?.images) {
      throw new Error("No se actualizaron las imágenes en la orden");
    }

    req.io?.emit("orderUpdated", {
      orderId,
      updatedOrder: updatedOrder.order,
    });
    console.log("[addAdminImages] Emitiendo orderUpdated:", {
      orderId,
      updatedOrder: updatedOrder.order,
    });

    res.status(200).json(updatedOrder);
  } catch (error) {
    console.error("[addAdminImages] Error:", error);
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

    req.io?.emit("orderUpdated", {
      orderId,
      updatedOrder: updatedOrder.order,
    });
    console.log("[deleteAdminImage] Emitiendo orderUpdated:", {
      orderId,
      updatedOrder,
    });

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

    req.io?.emit("partAdded", {
      orderId,
      part: result.part,
    });
    console.log("[addAdminPart] Emitiendo partAdded:", {
      orderId,
      part: result.part,
    });

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
