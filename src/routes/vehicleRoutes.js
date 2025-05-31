const express = require("express");
const router = express.Router();
const vehicleController = require("../controllers/vehicleController");
const authenticateToken = require("../middleware/auth");
const { restrictTo } = require("../middleware/role");

router.get(
  "/",
  authenticateToken,
  restrictTo("admin", "technician", "secretary", "client"),
  vehicleController.getVehicles
);
router.get(
  "/models",
  authenticateToken,
  restrictTo("admin", "technician", "client"),
  vehicleController.getVehicleModels
);
router.get(
  "/brands",
  authenticateToken,
  restrictTo("admin", "technician", "client"),
  vehicleController.getVehicleBrands
);
router.get(
  "/branches",
  authenticateToken,
  restrictTo("admin", "client"),
  vehicleController.getBranches
);
router.post(
  "/",
  authenticateToken,
  restrictTo("admin"),
  vehicleController.createVehicle
);
router.put(
  "/:economic_number",
  authenticateToken,
  restrictTo("admin"),
  vehicleController.updateVehicle
);
router.delete(
  "/:economic_number",
  authenticateToken,
  restrictTo("admin"),
  vehicleController.deleteVehicle
);

module.exports = router;
