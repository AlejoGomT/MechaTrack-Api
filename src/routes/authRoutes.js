const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authenticateToken = require("../middleware/auth");

router.post("/login", authController.login);
router.get("/verify", authenticateToken, authController.verifyToken);

module.exports = router;
