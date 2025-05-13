const pool = require("../config/database");

const getNotifications = async (to_user_id, status) => {
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

    if (to_user_id) {
      query += ` AND to_user_id = $${paramIndex}`;
      values.push(to_user_id);
      paramIndex++;
    }
    if (status) {
      query += ` AND status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    query += " GROUP BY n.id ORDER BY n.created_at DESC";

    console.log(
      "[notificationService] Consulta para getNotifications:",
      query,
      values
    );
    const result = await pool.query(query, values);
    console.log(
      "[notificationService] Notificaciones obtenidas:",
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
    order_id,
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
    console.log(
      "[notificationService] Notificación insertada:",
      result.rows[0]
    );
    return result.rows[0];
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
    console.log(
      "[notificationService] Notificación actualizada:",
      result.rows[0]
    );
    return result.rows[0];
  } catch (error) {
    console.error(
      "[notificationService] Error al actualizar notificación:",
      error
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

module.exports = {
  getNotifications,
  getMessagesByOrderId,
  createNotification,
  updateNotification,
  createAttachment,
};
