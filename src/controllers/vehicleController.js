const vehicleService = require("../services/vehicleService");

const getVehicles = async (req, res) => {
  try {
    const { branch, economicNumber } = req.query;
    const vehicles = await vehicleService.getVehicles(branch, economicNumber);
    res.json(vehicles);
  } catch (err) {
    console.error("Error al obtener vehículos:", err);
    res
      .status(err.status || 500)
      .json({ message: err.message || "Error al obtener vehículos" });
  }
};

module.exports = { getVehicles };
