const vehicleService = require("../services/vehicleService");

const getVehicles = async (req, res) => {
  try {
    const { branch, economicNumber, model, page, limit } = req.query;
    const vehicles = await vehicleService.getVehicles(
      branch,
      economicNumber,
      model,
      parseInt(page) || 1,
      parseInt(limit) || 20
    );
    res.json(vehicles);
  } catch (err) {
    console.error("Error al obtener vehículos:", err);
    res
      .status(err.status || 500)
      .json({ message: err.message || "Error al obtener vehículos" });
  }
};

const getVehicleModels = async (req, res) => {
  try {
    const models = await vehicleService.getVehicleModels();
    res.json(models);
  } catch (err) {
    console.error("Error al obtener modelos de vehículos:", err);
    res.status(err.status || 500).json({
      message: err.message || "Error al obtener modelos de vehículos",
    });
  }
};

const createVehicle = async (req, res) => {
  try {
    const vehicleData = req.body;
    const vehicle = await vehicleService.createVehicle(vehicleData);
    res.status(201).json(vehicle);
  } catch (err) {
    console.error("Error al crear vehículo:", err);
    res
      .status(err.status || 500)
      .json({ message: err.message || "Error al crear vehículo" });
  }
};

const updateVehicle = async (req, res) => {
  try {
    const { economic_number } = req.params;
    const vehicleData = req.body;
    const vehicle = await vehicleService.updateVehicle(
      economic_number,
      vehicleData
    );
    res.json(vehicle);
  } catch (err) {
    console.error("Error al actualizar vehículo:", err);
    res
      .status(err.status || 500)
      .json({ message: err.message || "Error al actualizar vehículo" });
  }
};

const deleteVehicle = async (req, res) => {
  try {
    const { economic_number } = req.params;
    const vehicle = await vehicleService.deleteVehicle(economic_number);
    res.json(vehicle);
  } catch (err) {
    console.error("Error al eliminar vehículo:", err);
    res
      .status(err.status || 500)
      .json({ message: err.message || "Error al eliminar vehículo" });
  }
};

const getBranches = async (req, res) => {
  try {
    const branches = await vehicleService.getBranches();
    res.json(branches);
  } catch (err) {
    console.error("Error al obtener sucursales:", err);
    res
      .status(err.status || 500)
      .json({ message: err.message || "Error al obtener sucursales" });
  }
};

module.exports = {
  getVehicles,
  getVehicleModels,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getBranches,
};
