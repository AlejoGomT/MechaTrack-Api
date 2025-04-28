const partService = require("../services/partService");

const getParts = async (req, res) => {
  const { model } = req.query;
  try {
    const parts = await partService.getParts(model);
    res.json(parts);
  } catch (error) {
    console.error("[partController] Error al obtener repuestos:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

const createPart = async (req, res) => {
  const { id, name, description, quantity, price } = req.body;
  let imageUrl = null;

  try {
    if (req.file) {
      // Nota: Implementar uploadToCloudinary o un equivalente
      // const uploadResult = await uploadToCloudinary(req.file.path);
      // imageUrl = uploadResult.secure_url;
      imageUrl = req.file.path; // Usar la ruta local por ahora
    }

    const part = await partService.createPart({
      id,
      name,
      description,
      quantity: parseInt(quantity, 10),
      price: parseFloat(price),
      image: imageUrl,
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

module.exports = { getParts, createPart };
