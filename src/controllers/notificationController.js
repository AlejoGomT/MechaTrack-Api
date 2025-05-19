const notificationService = require("../services/notificationService");
const pool = require("../config/database");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB límite
    files: 5, // Máximo 5 archivos
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Solo se permiten imágenes JPEG/JPG/PNG o PDFs"));
  },
}).array("attachments", 5);

const getNotifications = async (req, res) => {
  const { to_user_id, status, order_id, user_id } = req.query;
  try {
    const notifications = await notificationService.getNotifications({
      to_user_id: to_user_id || req.user.id,
      status,
      order_id,
      user_id: user_id || req.user.id,
    });
    console.log(
      "[notificationController] Notificaciones enviadas para order_id",
      order_id || "todos",
      ":",
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

const getMessagesByOrderId = async (req, res) => {
  try {
    const { order_id } = req.params;
    const user_id = req.user.id;
    const messages = await notificationService.getMessagesByOrderId(
      order_id,
      user_id
    );
    console.log(
      "[notificationController] Mensajes enviados para order_id",
      order_id,
      ":",
      messages.length
    );
    res.json(messages);
  } catch (error) {
    console.error("[notificationController] Error al obtener mensajes:", error);
    res.status(error.status || 500).json({
      message: error.message || "Error al obtener mensajes",
      details: error.stack,
    });
  }
};

const createNotification = async (req, res) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res
        .status(400)
        .json({ message: `Error de multer: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    const { order_id, to_user_id, message, type, status, details } = req.body;
    const from_user_id = req.user.id;

    try {
      const notificationData = {
        order_id,
        from_user_id,
        to_user_id,
        message,
        type: type || "message",
        status: status || "Pendiente",
        details: details ? JSON.parse(details) : null,
      };

      const notification = await notificationService.createNotification(
        notificationData
      );

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          await notificationService.createAttachment(
            notification.id,
            `/uploads/${file.filename}`,
            file.mimetype
          );
        }
      }

      console.log(
        "[notificationController] Notificación creada:",
        notification
      );
      res.status(201).json(notification);
    } catch (error) {
      console.error(
        "[notificationController] Error al crear notificación:",
        error
      );
      res.status(error.status || 500).json({
        message: error.message || "Error al crear notificación",
        details: error.stack,
      });
    }
  });
};

const getConversations = async (req, res) => {
  const user_id = req.query.user_id || req.user.id;
  if (!user_id) {
    return res.status(400).json({ message: "user_id es requerido" });
  }
  try {
    const query = `
      SELECT DISTINCT
        c.order_id,
        c.vehicle_economic_number,
        c.order_status,
        c.last_message_at,
        c.total_messages,
        COUNT(CASE WHEN n.status = 'Pendiente' AND n.to_user_id = $1 THEN 1 END) AS unread_messages,
        c.senders,
        c.recipients
      FROM conversations c
      JOIN notifications n ON c.order_id = n.order_id
      WHERE (n.to_user_id = $1 OR n.from_user_id = $1)
        AND c.order_status IN ('En Proceso', 'Pendiente')
      GROUP BY 
        c.order_id,
        c.vehicle_economic_number,
        c.order_status,
        c.last_message_at,
        c.total_messages,
        c.senders,
        c.recipients
      ORDER BY c.last_message_at DESC
    `;
    const result = await pool.query(query, [user_id]);
    console.log(
      "[notificationController] Conversaciones enviadas:",
      result.rows
    );
    res.json(result.rows);
  } catch (error) {
    console.error(
      "[notificationController] Error al obtener conversaciones:",
      error
    );
    res.status(500).json({
      message: "Error al obtener conversaciones",
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

module.exports = {
  getNotifications,
  createNotification,
  getConversations,
  updateNotification,
  getMessagesByOrderId,
};
