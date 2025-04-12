const pool = require("../config/database");

const getNotifications = async (recipient_id) => {
  try {
    let query = "SELECT * FROM notifications WHERE 1=1";
    const values = [];

    if (recipient_id) {
      query += " AND recipient_id = $1";
      values.push(recipient_id);
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    throw { status: 500, message: "Error al obtener notificaciones" };
  }
};

module.exports = { getNotifications };
