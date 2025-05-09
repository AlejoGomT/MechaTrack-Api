const pool = require("../config/database");

const getVehicles = async (
  branch,
  economicNumber,
  model,
  page = 1,
  limit = 20
) => {
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
    if (model) {
      query += " AND model = $" + (values.length + 1);
      values.push(model);
    }
    // Paginación
    query += " ORDER BY economic_number";
    query +=
      " LIMIT $" + (values.length + 1) + " OFFSET $" + (values.length + 2);
    values.push(limit, (page - 1) * limit);

    console.log("Consulta de vehículos:", query, values);
    const result = await pool.query(query, values);

    // Contar total para paginación
    const countQuery =
      "SELECT COUNT(*) FROM vehicles WHERE 1=1" +
      query.split("WHERE 1=1")[1].split("ORDER BY")[0];
    const countResult = await pool.query(countQuery, values.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);

    return {
      vehicles: result.rows,
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
    };
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

const createVehicle = async (vehicleData) => {
  try {
    const { economic_number, branch, brand, model, year, mileage, vin, plate } =
      vehicleData;

    // Validar duplicados
    const checkQuery = `
      SELECT economic_number, vin, plate FROM vehicles 
      WHERE economic_number = $1 OR vin = $2 OR plate = $3
    `;
    const checkResult = await pool.query(checkQuery, [
      economic_number,
      vin,
      plate,
    ]);
    if (checkResult.rows.length > 0) {
      const errors = [];
      checkResult.rows.forEach((row) => {
        if (row.economic_number === economic_number)
          errors.push("Número económico ya existe");
        if (row.vin === vin) errors.push("VIN ya existe");
        if (row.plate === plate) errors.push("Placa ya existe");
      });
      throw { status: 400, message: errors.join(", ") };
    }

    const query = `
      INSERT INTO vehicles (economic_number, branch, brand, model, year, mileage, vin, plate)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      economic_number,
      branch,
      brand,
      model,
      year,
      mileage,
      vin,
      plate,
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (err) {
    console.error("Error en createVehicle:", err);
    throw {
      status: err.status || 500,
      message: err.message || "Error al crear vehículo",
    };
  }
};

const updateVehicle = async (economic_number, vehicleData) => {
  try {
    const { branch, brand, model, year, mileage } = vehicleData;
    const query = `
      UPDATE vehicles 
      SET branch = $1, brand = $2, model = $3, year = $4, mileage = $5
      WHERE economic_number = $6
      RETURNING *
    `;
    const values = [branch, brand, model, year, mileage, economic_number];
    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      throw { status: 404, message: "Vehículo no encontrado" };
    }
    return result.rows[0];
  } catch (err) {
    console.error("Error en updateVehicle:", err);
    throw {
      status: err.status || 500,
      message: err.message || "Error al actualizar vehículo",
    };
  }
};

const deleteVehicle = async (economic_number) => {
  try {
    const query = "DELETE FROM vehicles WHERE economic_number = $1 RETURNING *";
    const result = await pool.query(query, [economic_number]);
    if (result.rowCount === 0) {
      throw { status: 404, message: "Vehículo no encontrado" };
    }
    return result.rows[0];
  } catch (err) {
    console.error("Error en deleteVehicle:", err);
    if (err.code === "23503") {
      // Violación de clave foránea
      throw {
        status: 400,
        message:
          "No se puede eliminar el vehículo porque está referenciado en órdenes",
      };
    }
    throw {
      status: err.status || 500,
      message: err.message || "Error al eliminar vehículo",
    };
  }
};

const getBranches = async () => {
  try {
    const query = "SELECT DISTINCT branch FROM vehicles ORDER BY branch";
    const result = await pool.query(query);
    return result.rows.map((row) => row.branch);
  } catch (err) {
    console.error("Error en getBranches:", err);
    throw {
      status: 500,
      message: `Error al obtener sucursales: ${err.message}`,
    };
  }
};

module.exports = {
  getVehicles,
  getVehicleModels,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getBranches,
};
