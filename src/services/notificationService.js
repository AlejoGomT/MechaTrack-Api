const pool = require("../config/database");

const getNotifications = async (to_user_id) => {
  try {
    let query = "SELECT * FROM notifications WHERE 1=1";
    const values = [];

    if (to_user_id) {
      query += " AND to_user_id = $1";
      values.push(to_user_id);
    }

    query += " ORDER BY created_at DESC";

    console.log("Ejecutando consulta de notificaciones:", query, values);
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error("Error en getNotifications:", error);
    throw {
      status: 500,
      message: `Error al obtener notificaciones: ${error.message}`,
    };
  }
};

const createNotification = async (notificationData) => {
  const { order_id, from_user_id, to_user_id, message, type, status } =
    notificationData;
  try {
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
      status || "Pendiente", // Aseguramos que el valor por defecto sea "Pendiente"
      new Date(),
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (err) {
    console.error("Error al crear notificación:", err);
    throw {
      status: 500,
      message: `Error al crear notificación: ${err.message}`,
    };
  }
};

module.exports = { getNotifications, createNotification };
