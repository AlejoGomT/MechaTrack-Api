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

module.exports = { getNotifications };
