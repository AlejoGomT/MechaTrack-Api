const pool = require("../config/database");

const getNotifications = async (req, res) => {
  const { to_user_id } = req.query;
  try {
    let query = "SELECT * FROM notifications WHERE 1=1";
    const values = [];

    if (to_user_id) {
      query += " AND to_user_id = $1";
      values.push(to_user_id);
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error("Error en getNotifications:", error);
    res.status(500).json({ message: "Error al obtener notificaciones" });
  }
};

module.exports = { getNotifications };
