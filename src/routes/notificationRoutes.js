const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authenticateToken = require("../middleware/auth");

router.get("/", authenticateToken, notificationController.getNotifications);
router.get(
  "/conversations",
  authenticateToken,
  notificationController.getConversations
);
router.get(
  "/order/:order_id",
  authenticateToken,
  notificationController.getMessagesByOrderId
);
router.post("/", authenticateToken, notificationController.createNotification);
router.put(
  "/:id",
  authenticateToken,
  notificationController.updateNotification
);

module.exports = router;
