const pool = require("../config/database");

const getVehicles = async (branch, economicNumber) => {
  try {
    let query = "SELECT * FROM vehicles WHERE 1=1";
    const values = [];
    if (branch) {
      query += " AND branch = $" + (values.length + 1);
      values.push(branch);
    }
    if (economicNumber) {
      query += " AND economic_number ILIKE $" + (values.length + 1);
      values.push(`%${economicNumber}%`);
    }
    console.log("Consulta de vehículos:", query, values);
    const result = await pool.query(query, values);
    return result.rows;
  } catch (err) {
    console.error("Error en getVehicles:", err);
    throw {
      status: 500,
      message: `Error al obtener vehículos: ${err.message}`,
    };
  }
};

const getVehicleModels = async () => {
  try {
    const query = "SELECT DISTINCT model FROM vehicles ORDER BY model";
    console.log("Consulta de modelos:", query);
    const result = await pool.query(query);
    return result.rows.map((row) => row.model);
  } catch (err) {
    console.error("Error en getVehicleModels:", err);
    throw {
      status: 500,
      message: `Error al obtener modelos de vehículos: ${err.message}`,
    };
  }
};

module.exports = { getVehicles, getVehicleModels };
