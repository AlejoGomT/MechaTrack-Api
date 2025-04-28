const pool = require("../config/database");

const getNotifications = async (to_user_id, status) => {
  try {
    let query = "SELECT * FROM notifications WHERE 1=1";
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

    query += " ORDER BY created_at DESC";

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

const createNotification = async (notificationData, client = null) => {
  const { order_id, from_user_id, to_user_id, message, type, status } =
    notificationData;
  const query = `
    INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const values = [
    order_id,
    from_user_id,
    to_user_id,
    message,
    type,
    status || "Pendiente",
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

module.exports = { getNotifications, createNotification, updateNotification };
