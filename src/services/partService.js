const pool = require("../config/database");

const getParts = async (model) => {
  let query = "SELECT * FROM parts WHERE 1=1";
  const values = [];
  if (model) {
    query += " AND $1 = ANY(compatible_models)";
    values.push(model);
  }
  const result = await pool.query(query, values);
  return result.rows;
};

module.exports = { getParts };
