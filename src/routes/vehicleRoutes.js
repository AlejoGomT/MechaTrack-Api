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

module.exports = router;
