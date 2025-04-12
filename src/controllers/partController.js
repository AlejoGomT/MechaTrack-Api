const partService = require("../services/partService");

const getParts = async (req, res) => {
  const { model } = req.query;
  try {
    const parts = await partService.getParts(model);
    res.json(parts);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

module.exports = { getParts };
