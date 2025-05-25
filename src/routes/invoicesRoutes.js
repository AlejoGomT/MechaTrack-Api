const express = require("express");
const router = express.Router();
const invoicesController = require("../controllers/invoicesController");
const authenticateToken = require("../middleware/auth");

router.get("/", authenticateToken, invoicesController.getInvoices);

module.exports = router;
