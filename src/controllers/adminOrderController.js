const adminOrderService = require("../services/adminOrderService");
const { validationResult } = require("express-validator");
const pool = require("../config/database");
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
  check("vehicle_economic_number")
    .optional()
    .isString()
    .isLength({ max: 10 })
    .withMessage("El número económico no puede exceder los 10 caracteres"),
  check("plate")
    .optional()
    .isString()
    .withMessage("La placa debe ser una cadena"),
  check("brand")
    .optional()
    .isString()
    .withMessage("La marca debe ser una cadena"),
  check("model")
    .optional()
    .isString()
    .withMessage("El modelo debe ser una cadena"),
  check("year")
    .optional()
    .isInt({ min: 1900, max: new Date().getFullYear() + 1 })
    .withMessage("El año debe ser válido"),

  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { orderId } = req.params;
      const userId = req.user.id;
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
          console.error(
            "[updateAdminOrder] Error al parsear existingImages:",
            error
          );
          return res
            .status(400)
            .json({ message: "Formato inválido de existingImages" });
        }
      }
      orderData.images = [...new Set([...existingImages, ...newImages])];

      // Incluir datos del vehículo en orderData
      orderData.vehicle_economic_number =
        orderData.vehicle_economic_number || undefined;
      orderData.plate = orderData.plate || undefined;
      orderData.brand = orderData.brand || undefined;
      orderData.model = orderData.model || undefined;
      orderData.year = orderData.year || undefined;
      orderData.mileage = orderData.mileage
        ? parseInt(orderData.mileage)
        : undefined;

      console.log("[updateAdminOrder] orderData:", {
        orderId,
        ...orderData,
        vehicleData: {
          vehicle_economic_number: orderData.vehicle_economic_number,
          plate: orderData.plate,
          brand: orderData.brand,
          model: orderData.model,
          year: orderData.year,
          mileage: orderData.mileage,
        },
      });

      const updatedOrder = await adminOrderService.updateAdminOrder(
        orderId,
        orderData,
        userId
      );

      console.log("[updateAdminOrder] updatedOrder:", {
        orderId,
        updatedOrder,
        vehicleData: {
          vehicle_economic_number: updatedOrder.vehicle_economic_number,
          plate: updatedOrder.plate,
          brand: updatedOrder.brand,
          model: updatedOrder.model,
          year: updatedOrder.year,
          mileage: updatedOrder.mileage,
        },
      });

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
      console.error("[updateAdminOrder] Error:", error);
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

const addAdminPart = [
  check("part_id").notEmpty().withMessage("El ID del repuesto es obligatorio"),
  check("quantity")
    .isInt({ min: 1 })
    .withMessage("La cantidad debe ser un número entero positivo"),
  check("price")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("El precio debe ser un número no negativo"),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { orderId } = req.params;
      const partData = req.body;
      const userId = req.user.id;

      console.log("[addAdminPart] Añadiendo repuesto:", {
        orderId,
        partData,
        userId,
      });

      const result = await adminOrderService.addAdminPart(
        orderId,
        partData,
        userId
      );

      // Obtener orden actualizada para emitir evento
      const orderResult = await pool.query(
        `
        SELECT o.*, 
               v.economic_number, v.plate, v.brand, v.model, v.year, v.mileage, v.branch
        FROM orders o
        LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
        WHERE o.id = $1
        `,
        [orderId]
      );
      const updatedOrder = orderResult.rows[0];

      const partsResult = await pool.query(
        `
        SELECT op.*, p.name,
               req_user.first_name AS requested_by_first_name,
               req_user.last_name AS requested_by_last_name,
               auth_user.first_name AS authorized_by_first_name,
               auth_user.last_name AS authorized_by_last_name
        FROM order_parts op
        JOIN parts p ON op.part_id = p.id
        LEFT JOIN users req_user ON op.requested_by = req_user.id
        LEFT JOIN users auth_user ON op.authorized_by = auth_user.id
        WHERE op.order_id = $1
        `,
        [orderId]
      );

      updatedOrder.parts = partsResult.rows.map((part) => ({
        part_id: part.part_id,
        name: part.name,
        quantity: part.quantity,
        price: part.price,
        status: part.status,
        requested_by_id: part.requested_by,
        requested_by: part.requested_by_first_name
          ? `${part.requested_by_first_name} ${part.requested_by_last_name}`
          : "Administrador",
        authorized_by_id: part.authorized_by,
        authorized_by: part.authorized_by_first_name
          ? `${part.authorized_by_first_name} ${part.authorized_by_last_name}`
          : null,
      }));

      console.log("[addAdminPart] updatedOrder:", {
        orderId,
        updatedOrder,
        parts: updatedOrder.parts,
      });

      req.io?.emit("orderUpdated", {
        orderId,
        updatedOrder,
      });
      console.log("[addAdminPart] Emitiendo orderUpdated:", {
        orderId,
        updatedOrder,
      });

      res.status(200).json(result);
    } catch (error) {
      console.error("[addAdminPart] Error:", error);
      res.status(error.status || 500).json({
        message: error.message || "Error al añadir repuesto",
        details: error.details || error.message,
      });
    }
  },
];

const editAdminPart = [
  check("quantity")
    .isInt({ min: 0 })
    .withMessage("La cantidad debe ser un número entero no negativo"),
  check("price")
    .isFloat({ min: 0 })
    .withMessage("El precio debe ser un número no negativo"),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { orderId, partId } = req.params;
      const { quantity, price } = req.body;
      const userId = req.user.id;

      console.log("[editAdminPart] Editando repuesto:", {
        orderId,
        partId,
        quantity,
        price,
        userId,
      });

      const result = await adminOrderService.editAdminPart(
        orderId,
        partId,
        { quantity, price },
        userId
      );

      // Obtener orden actualizada
      const orderResult = await pool.query(
        `
        SELECT o.*, 
               v.economic_number, v.plate, v.brand, v.model, v.year, v.mileage, v.branch
        FROM orders o
        LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
        WHERE o.id = $1
        `,
        [orderId]
      );
      const updatedOrder = orderResult.rows[0];

      const partsResult = await pool.query(
        `
        SELECT op.*, p.name,
               req_user.first_name AS requested_by_first_name,
               req_user.last_name AS requested_by_last_name,
               auth_user.first_name AS authorized_by_first_name,
               auth_user.last_name AS authorized_by_last_name
        FROM order_parts op
        JOIN parts p ON op.part_id = p.id
        LEFT JOIN users req_user ON op.requested_by = req_user.id
        LEFT JOIN users auth_user ON op.authorized_by = auth_user.id
        WHERE op.order_id = $1
        `,
        [orderId]
      );

      updatedOrder.parts = partsResult.rows.map((part) => ({
        part_id: part.part_id,
        name: part.name,
        quantity: part.quantity,
        price: part.price,
        status: part.status,
        requested_by_id: part.requested_by,
        requested_by: part.requested_by_first_name
          ? `${part.requested_by_first_name} ${part.requested_by_last_name}`
          : "Administrador",
        authorized_by_id: part.authorized_by,
        authorized_by: part.authorized_by_first_name
          ? `${part.authorized_by_first_name} ${part.authorized_by_last_name}`
          : null,
      }));

      console.log("[editAdminPart] updatedOrder:", {
        orderId,
        updatedOrder,
        parts: updatedOrder.parts,
      });

      req.io?.emit("orderUpdated", {
        orderId,
        updatedOrder,
      });
      console.log("[editAdminPart] Emitiendo orderUpdated:", {
        orderId,
        updatedOrder,
      });

      res.status(200).json(result);
    } catch (error) {
      console.error("[editAdminPart] Error:", error);
      res.status(error.status || 500).json({
        message: error.message || "Error al actualizar repuesto",
        details: error.details || error.message,
      });
    }
  },
];

const deleteAdminPart = [
  check("partId").notEmpty().withMessage("El ID del repuesto es obligatorio"),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { orderId, partId } = req.params;
      const userId = req.user.id;

      console.log("[deleteAdminPart] Eliminando repuesto:", {
        orderId,
        partId,
        userId,
      });

      const result = await adminOrderService.deleteAdminPart(
        orderId,
        partId,
        userId
      );

      // Obtener orden actualizada
      const orderResult = await pool.query(
        `
        SELECT o.*, 
               v.economic_number, v.plate, v.brand, v.model, v.year, v.mileage, v.branch
        FROM orders o
        LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
        WHERE o.id = $1
        `,
        [orderId]
      );
      const updatedOrder = orderResult.rows[0];

      const partsResult = await pool.query(
        `
        SELECT op.*, p.name,
               req_user.first_name AS requested_by_first_name,
               req_user.last_name AS requested_by_last_name,
               auth_user.first_name AS authorized_by_first_name,
               auth_user.last_name AS authorized_by_last_name
        FROM order_parts op
        JOIN parts p ON op.part_id = p.id
        LEFT JOIN users req_user ON op.requested_by = req_user.id
        LEFT JOIN users auth_user ON op.authorized_by = auth_user.id
        WHERE op.order_id = $1
        `,
        [orderId]
      );

      updatedOrder.parts = partsResult.rows.map((part) => ({
        part_id: part.part_id,
        name: part.name,
        quantity: part.quantity,
        price: part.price,
        status: part.status,
        requested_by_id: part.requested_by,
        requested_by: part.requested_by_first_name
          ? `${part.requested_by_first_name} ${part.requested_by_last_name}`
          : "Administrador",
        authorized_by_id: part.authorized_by,
        authorized_by: part.authorized_by_first_name
          ? `${part.authorized_by_first_name} ${part.authorized_by_last_name}`
          : null,
      }));

      console.log("[deleteAdminPart] updatedOrder:", {
        orderId,
        updatedOrder,
        parts: updatedOrder.parts,
      });

      req.io?.emit("orderUpdated", {
        orderId,
        updatedOrder,
      });
      console.log("[deleteAdminPart] Emitiendo orderUpdated:", {
        orderId,
        updatedOrder,
      });

      res.status(200).json(result);
    } catch (error) {
      console.error("[deleteAdminPart] Error:", error);
      res.status(error.status || 500).json({
        message: error.message || "Error al eliminar repuesto",
        details: error.details || error.message,
      });
    }
  },
];

module.exports = {
  updateAdminOrder,
  addAdminImages,
  deleteAdminImage,
  addAdminPart,
  editAdminPart,
  deleteAdminPart,
};
