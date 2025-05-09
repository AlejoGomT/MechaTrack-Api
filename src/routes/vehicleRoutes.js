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

module.exports = router;
