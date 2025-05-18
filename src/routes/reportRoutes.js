const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");
const verifyToken = require("../middleware/auth");
const { restrictTo } = require("../middleware/role");
console.log("reportRoutes.js loaded"); // Añadir para depuración
router.use(verifyToken);
router.use(restrictTo("admin", "secretary"));

router.get("/branches", reportController.getBranchReports);
router.get("/orders/:id", reportController.getOrderReport);
router.get("/orders/:id/pdf", reportController.getOrderReportPdf);
router.get("/branches/export", reportController.exportBranchReports);

module.exports = router;
