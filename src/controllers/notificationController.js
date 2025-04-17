const pool = require("../config/database");
const notificationService = require("../services/notificationService");

const getNotifications = async (req, res) => {
  const { to_user_id } = req.query;
  try {
    const notifications = await notificationService.getNotifications(
      to_user_id
    );
    res.json(notifications);
  } catch (error) {
    console.error("Error en getNotifications:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
};

module.exports = { getNotifications };
