const express = require("express");
const router = express.Router();
const vehicleController = require("../controllers/vehicleController");
const authenticateToken = require("../middleware/auth");
const { restrictTo } = require("../middleware/role");

router.get(
  "/",
  authenticateToken,
  restrictTo("admin", "technician", "secretary"),
  vehicleController.getVehicles
);
router.get(
  "/models",
  authenticateToken,
  restrictTo("admin", "technician"),
  vehicleController.getVehicleModels
);
router.get(
  "/branches",
  authenticateToken,
  restrictTo("admin"),
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
