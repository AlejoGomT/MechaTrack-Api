const vehicleService = require("../services/vehicleService");

const getVehicles = async (req, res) => {
  const { branch, economicNumber } = req.query;
  try {
    const vehicles = await vehicleService.getVehicles(branch, economicNumber);
    res.json(vehicles);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

module.exports = { getVehicles };
