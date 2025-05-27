const express = require("express");
const router = express.Router();
const invoicesController = require("../controllers/invoicesController");
const authenticateToken = require("../middleware/auth");

router.get("/", authenticateToken, invoicesController.getInvoices);
router.put("/:orderId", authenticateToken, invoicesController.editInvoice);
router.delete("/:orderId", authenticateToken, invoicesController.deleteInvoice);

module.exports = router;
