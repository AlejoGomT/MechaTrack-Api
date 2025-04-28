const pool = require("../config/database");

const getParts = async (model) => {
  try {
    let query = "SELECT * FROM parts";
    const values = [];
    if (model) {
      query += " WHERE $1 = ANY(compatible_models)";
      values.push(model);
    }
    console.log("[partService] Consulta para getParts:", query, values);
    const result = await pool.query(query, values);
    console.log("[partService] Repuestos obtenidos:", result.rows.length);
    return result.rows;
  } catch (error) {
    console.error("[partService] Error al obtener repuestos:", error);
    throw {
      status: 500,
      message: `Error al obtener repuestos: ${error.message}`,
    };
  }
};

const createPart = async (partData) => {
  const { id, name, description, quantity, price, image } = partData;
  try {
    const query = `
      INSERT INTO parts (id, name, description, quantity, price, image)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [id, name, description, quantity, price, image || null];
    console.log("[partService] Insertando repuesto con valores:", values);
    const result = await pool.query(query, values);
    console.log("[partService] Repuesto creado:", result.rows[0]);
    return result.rows[0];
  } catch (error) {
    console.error("[partService] Error al crear repuesto:", error);
    throw {
      status: 500,
      message: `Error al crear repuesto: ${error.message}`,
    };
  }
};

module.exports = { getParts, createPart };
