const notificationService = require("../services/notificationService");

const getNotifications = async (req, res) => {
  const { to_user_id, status } = req.query;
  try {
    const notifications = await notificationService.getNotifications(
      to_user_id,
      status
    );
    console.log(
      "[notificationController] Notificaciones enviadas:",
      notifications.length
    );
    res.json(notifications);
  } catch (error) {
    console.error(
      "[notificationController] Error al obtener notificaciones:",
      error
    );
    res.status(error.status || 500).json({
      message: error.message || "Error al obtener notificaciones",
      details: error.stack,
    });
  }
};

const updateNotification = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const updatedNotification = await notificationService.updateNotification(
      id,
      updates
    );
    console.log(
      "[notificationController] Notificación actualizada:",
      updatedNotification
    );
    res.json(updatedNotification);
  } catch (error) {
    console.error(
      "[notificationController] Error al actualizar notificación:",
      error
    );
    res.status(error.status || 500).json({
      message: error.message || "Error al actualizar notificación",
      details: error.stack,
    });
  }
};

module.exports = { getNotifications, updateNotification };
