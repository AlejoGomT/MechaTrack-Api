const pool = require("../config/database");

const getVehicles = async (branch, economicNumber) => {
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
  const result = await pool.query(query, values);
  return result.rows;
};

module.exports = { getVehicles };
