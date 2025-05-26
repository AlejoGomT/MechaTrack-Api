const pool = require("../config/database");
const socket = require("../socket");

const getNotifications = async ({ to_user_id, status, order_id, user_id }) => {
  try {
    let query = `
      SELECT n.*, 
             array_agg(jsonb_build_object(
               'id', na.id,
               'file_path', na.file_path,
               'file_type', na.file_type,
               'created_at', na.created_at
             )) FILTER (WHERE na.id IS NOT NULL) AS attachments
      FROM notifications n
      LEFT JOIN notification_attachments na ON n.id = na.notification_id
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (order_id && order_id !== "todos") {
      if (order_id === "DIRECT") {
        query += ` AND n.order_id IS NULL AND n.type = 'direct_message'`;
        if (to_user_id && user_id) {
          query += ` AND ((n.from_user_id = $${paramIndex} AND n.to_user_id = $${
            paramIndex + 1
          }) OR (n.from_user_id = $${
            paramIndex + 1
          } AND n.to_user_id = $${paramIndex}))`;
          values.push(user_id, to_user_id);
          paramIndex += 2;
        }
      } else {
        query += ` AND n.order_id = $${paramIndex}`;
        values.push(order_id);
        paramIndex++;
      }
    } else {
      query += ` AND n.type IN (
        'message', 
        'direct_message',
        'part_request',
        'closure_request',
        'part_approval',
        'part_rejection',
        'closure_approval',
        'closure_rejection',
        'client_update',
        'invoice_complete',
        'part_return_request',
        'order_creation'
      )`;
      if (to_user_id && user_id) {
        query += ` AND ((n.from_user_id = $${paramIndex} AND n.to_user_id = $${
          paramIndex + 1
        }) OR (n.from_user_id = $${
          paramIndex + 1
        } AND n.to_user_id = $${paramIndex}))`;
        values.push(user_id, to_user_id);
        paramIndex += 2;
      } else if (user_id) {
        query += ` AND (n.to_user_id = $${paramIndex} OR n.from_user_id = $${paramIndex})`;
        values.push(user_id);
        paramIndex++;
      }
    }
    if (status) {
      query += ` AND n.status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    query += " GROUP BY n.id ORDER BY n.created_at ASC";

    console.log(
      "[notificationService] Consulta para getNotifications:",
      query,
      values
    );
    const result = await pool.query(query, values);
    console.log(
      "[notificationService] Notificaciones obtenidas para order_id",
      order_id || "todos",
      ":",
      result.rows.length
    );
    return result.rows;
  } catch (error) {
    console.error(
      "[notificationService] Error al obtener notificaciones:",
      error
    );
    throw {
      status: 500,
      message: `Error al obtener notificaciones: ${error.message}`,
    };
  }
};

const getMessagesByOrderId = async (order_id, user_id) => {
  try {
    const query = `
      SELECT n.*, 
             array_agg(jsonb_build_object(
               'id', na.id,
               'file_path', na.file_path,
               'file_type', na.file_type,
               'created_at', na.created_at
             )) FILTER (WHERE na.id IS NOT NULL) AS attachments
      FROM notifications n
      LEFT JOIN notification_attachments na ON n.id = na.notification_id
      WHERE n.order_id = $1
      AND (n.to_user_id = $2 OR n.from_user_id = $2)
      GROUP BY n.id
      ORDER BY n.created_at ASC
    `;
    const values = [order_id, user_id];
    console.log(
      "[notificationService] Consulta para getMessagesByOrderId:",
      query,
      values
    );
    const result = await pool.query(query, values);
    console.log(
      "[notificationService] Mensajes obtenidos:",
      result.rows.length
    );
    return result.rows;
  } catch (error) {
    console.error("[notificationService] Error al obtener mensajes:", error);
    throw {
      status: 500,
      message: `Error al obtener mensajes: ${error.message}`,
    };
  }
};

const createNotification = async (notificationData, client = null) => {
  const { order_id, from_user_id, to_user_id, message, type, status, details } =
    notificationData;
  const query = `
    INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const values = [
    type === "direct_message" ? null : order_id || null,
    from_user_id,
    to_user_id,
    message,
    type,
    status || "Pendiente",
    details || null,
    new Date(),
  ];
  try {
    const queryClient = client || pool;
    console.log(
      "[notificationService] Valores para INSERT INTO notifications:",
      values
    );
    const result = await queryClient.query(query, values);
    const notification = result.rows[0];
    console.log("[notificationService] Notificación insertada:", notification);

    const socketNotification = {
      id: notification.id,
      orderId: notification.order_id,
      fromUserId: notification.from_user_id,
      toUserId: notification.to_user_id,
      message: notification.message,
      type: notification.type,
      status: notification.status,
      details: notification.details,
      timestamp: notification.created_at.toISOString(),
    };

    const io = socket.getIo();
    if (io && typeof io.to === "function") {
      if (notification.order_id) {
        io.to(`order_${order_id}`).emit("notification", socketNotification);
        console.log(
          "[notificationService] Notificación emitida a order_",
          order_id,
          ":",
          socketNotification
        );
      }
      if (to_user_id) {
        io.to(to_user_id).emit("notification", socketNotification);
        console.log(
          "[notificationService] Notificación emitida a usuario:",
          to_user_id
        );
      }
      if (type === "order_creation") {
        io.to("admin").emit("notification", socketNotification);
        console.log("[notificationService] Notificación emitida a rol: admin");
      }
      if (type === "invoice_complete") {
        io.to("secretary").emit("notification", socketNotification);
        console.log(
          "[notificationService] Notificación emitida a rol: secretary"
        );
      }
      if (type === "direct_message") {
        io.to(from_user_id).emit("notification", socketNotification);
        console.log(
          "[notificationService] Notificación directa emitida a remitente:",
          from_user_id
        );
      }
    } else {
      console.warn(
        "[notificationService] Socket.IO no está disponible, no se emitieron notificaciones"
      );
    }

    return notification;
  } catch (err) {
    console.error("[notificationService] Error al crear notificación:", err);
    throw {
      status: 500,
      message: `Error al crear notificación: ${err.message}`,
    };
  }
};

const updateNotification = async (id, updates) => {
  const { status } = updates;
  try {
    console.log(
      "[notificationService] Intentando actualizar notificación ID:",
      id,
      "con status:",
      status
    );
    const query = `
      UPDATE notifications
      SET status = $1, updated_at = $2
      WHERE id = $3
      RETURNING *
    `;
    const values = [status, new Date(), id];
    console.log(
      "[notificationService] Actualizando notificación con valores:",
      values
    );
    const result = await pool.query(query, values);
    if (!result.rows.length) {
      console.error(
        "[notificationService] Notificación no encontrada con id:",
        id
      );
      throw { status: 404, message: "Notificación no encontrada" };
    }
    const notification = result.rows[0];
    console.log(
      "[notificationService] Notificación actualizada:",
      notification
    );

    // Enviar actualización por Socket.IO
    const socketNotification = {
      id: notification.id,
      orderId: notification.order_id,
      fromUserId: notification.from_user_id,
      toUserId: notification.to_user_id,
      message: notification.message,
      type: notification.type,
      status: notification.status,
      details: notification.details,
      timestamp: notification.updated_at.toISOString(),
    };

    const io = socket.getIo();
    if (io && typeof io.to === "function") {
      io.to(`order_${notification.order_id}`).emit(
        "notification",
        socketNotification
      );
      if (notification.to_user_id) {
        io.to(notification.to_user_id).emit("notification", socketNotification);
      }
    } else {
      console.warn(
        "[notificationService] Socket.IO no está disponible, no se emitieron notificaciones"
      );
    }

    return notification;
  } catch (error) {
    console.error(
      "[notificationService] Error al actualizar notificación ID:",
      id,
      "Error:",
      error.message,
      error.stack
    );
    throw {
      status: error.status || 500,
      message: `Error al actualizar notificación: ${error.message}`,
    };
  }
};

const createAttachment = async (
  notification_id,
  file_path,
  file_type,
  client = null
) => {
  const query = `
    INSERT INTO notification_attachments (notification_id, file_path, file_type, created_at)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const values = [notification_id, file_path, file_type, new Date()];
  try {
    const queryClient = client || pool;
    const result = await queryClient.query(query, values);
    console.log("[notificationService] Adjunto creado:", result.rows[0]);
    return result.rows[0];
  } catch (err) {
    console.error("[notificationService] Error al crear adjunto:", err);
    throw {
      status: 500,
      message: `Error al crear adjunto: ${err.message}`,
    };
  }
};

const deletePartRequestNotification = async (
  order_id,
  part_id,
  client = null
) => {
  try {
    const query = `
      DELETE FROM notifications
      WHERE order_id = $1
      AND type IN ('part_request', 'part_rejection', 'part_return_request')
      AND details->>'part_id' = $2
      RETURNING *
    `;
    const values = [order_id, part_id];
    const queryClient = client || pool;
    console.log(
      "[notificationService] Eliminando notificación de solicitud de repuesto:",
      values
    );
    const result = await queryClient.query(query, values);
    console.log(
      "[notificationService] Notificaciones eliminadas:",
      result.rows
    );
    return result.rows;
  } catch (error) {
    console.error(
      "[notificationService] Error al eliminar notificación de repuesto:",
      error
    );
    throw {
      status: 500,
      message: `Error al eliminar notificación de repuesto: ${error.message}`,
    };
  }
};

module.exports = {
  getNotifications,
  getMessagesByOrderId,
  createNotification,
  updateNotification,
  createAttachment,
  deletePartRequestNotification,
};
