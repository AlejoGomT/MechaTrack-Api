const partService = require("../services/partService");

const getParts = async (req, res) => {
  const { model, page = 1, limit = 10 } = req.query;
  try {
    const { parts, total } = await partService.getParts(
      model,
      parseInt(page),
      parseInt(limit)
    );
    res.json({
      parts,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("[partController] Error al obtener repuestos:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const getPartById = async (req, res) => {
  try {
    const { id } = req.params;
    const part = await partService.getPartById(id);
    res.json(part);
  } catch (error) {
    console.error("[partController] Error al obtener repuesto:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const createPart = async (req, res) => {
  const { id, name, description, quantity, price, compatible_models } =
    req.body;
  let imageUrl = null;

  try {
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`; // Ruta relativa para servir desde express.static
    }

    const part = await partService.createPart({
      id,
      name,
      description,
      quantity: parseInt(quantity, 10),
      price: parseFloat(price),
      image: imageUrl,
      compatible_models: compatible_models
        ? JSON.parse(compatible_models)
        : null,
    });

    console.log("[partController] Repuesto creado:", part);
    res.status(201).json(part);
  } catch (error) {
    console.error("[partController] Error al crear repuesto:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al crear repuesto",
      details: error.stack,
    });
  }
};

const updatePart = async (req, res) => {
  const { id } = req.params;
  const { name, description, quantity, price, compatible_models } = req.body;
  let imageUrl = null;

  try {
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`; // Ruta relativa
    }

    const part = await partService.updatePart(id, {
      name,
      description,
      quantity: parseInt(quantity, 10),
      price: parseFloat(price),
      image: imageUrl || req.body.image, // Mantener imagen existente si no se sube una nueva
      compatible_models: compatible_models
        ? JSON.parse(compatible_models)
        : null,
    });

    console.log("[partController] Repuesto actualizado:", part);
    res.json(part);
  } catch (error) {
    console.error("[partController] Error al actualizar repuesto:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al actualizar repuesto",
      details: error.stack,
    });
  }
};

const deletePart = async (req, res) => {
  const { id } = req.params;
  try {
    const part = await partService.deletePart(id);
    console.log("[partController] Repuesto eliminado:", part);
    res.json({ message: "Repuesto eliminado", part });
  } catch (error) {
    console.error("[partController] Error al eliminar repuesto:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const updatePartInventory = async (req, res) => {
  const { id } = req.params;
  const { quantityChange } = req.body;

  try {
    if (!quantityChange || isNaN(quantityChange) || quantityChange <= 0) {
      throw {
        status: 400,
        message: "quantityChange debe ser un número positivo",
      };
    }

    const part = await partService.updatePartInventory(
      id,
      parseInt(quantityChange, 10)
    );
    console.log("[partController] Inventario actualizado:", part);
    res.json(part);
  } catch (error) {
    console.error("[partController] Error al actualizar inventario:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al actualizar inventario",
      details: error.stack,
    });
  }
};

module.exports = {
  getParts,
  getPartById,
  createPart,
  updatePart,
  deletePart,
  updatePartInventory,
};
