const express = require("express");
const router = express.Router();
const partController = require("../controllers/partController");
const authenticateToken = require("../middleware/auth");
const { restrictTo } = require("../middleware/role");

router.get(
  "/",
  authenticateToken,
  restrictTo("admin", "technician"),
  partController.getParts
);

module.exports = router;
