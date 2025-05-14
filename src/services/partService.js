const pool = require("../config/database");

const getParts = async (model, page = 1, limit = 10) => {
  try {
    const offset = (page - 1) * limit;
    let query = `
      SELECT *, COUNT(*) OVER() as total_count 
      FROM parts 
      WHERE compatible_models IS NOT NULL
    `;
    const values = [];

    if (model) {
      query += " AND $1 = ANY(compatible_models)";
      values.push(model);
    }

    query += ` ORDER BY id ASC LIMIT $${values.length + 1} OFFSET $${
      values.length + 2
    }`;
    values.push(limit, offset);

    console.log("[partService] Consulta para getParts:", query, values);
    const result = await pool.query(query, values);
    console.log("[partService] Repuestos obtenidos:", result.rows);
    return {
      parts: result.rows,
      total:
        result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0,
    };
  } catch (error) {
    console.error("[partService] Error al obtener repuestos:", error);
    throw {
      status: 500,
      message: `Error al obtener repuestos: ${error.message}`,
    };
  }
};

const createPart = async (partData) => {
  const { id, name, description, quantity, price, image, compatible_models } =
    partData;

  // Validaciones
  if (!id || id.length < 3) {
    throw {
      status: 400,
      message: "El ID es requerido y debe tener al menos 3 caracteres",
    };
  }
  if (!name || name.length < 3) {
    throw {
      status: 400,
      message: "El nombre es requerido y debe tener al menos 3 caracteres",
    };
  }
  if (price < 0) {
    throw { status: 400, message: "El precio no puede ser negativo" };
  }
  if (quantity < 0) {
    throw { status: 400, message: "La cantidad no puede ser negativa" };
  }

  try {
    const query = `
      INSERT INTO parts (id, name, description, quantity, price, image, compatible_models)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      id,
      name,
      description || null,
      quantity,
      price,
      image || null,
      compatible_models || null,
    ];
    console.log("[partService] Insertando repuesto con valores:", values);
    const result = await pool.query(query, values);
    console.log("[partService] Repuesto creado:", result.rows[0]);
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") {
      // Violación de unicidad (id)
      throw { status: 400, message: "El ID ya está en uso" };
    }
    console.error("[partService] Error al crear repuesto:", error);
    throw {
      status: 500,
      message: `Error al crear repuesto: ${error.message}`,
    };
  }
};

const updatePart = async (id, partData) => {
  const { name, description, quantity, price, image, compatible_models } =
    partData;

  // Validaciones
  if (!name || name.length < 3) {
    throw {
      status: 400,
      message: "El nombre es requerido y debe tener al menos 3 caracteres",
    };
  }
  if (price < 0) {
    throw { status: 400, message: "El precio no puede ser negativo" };
  }
  if (quantity < 0) {
    throw { status: 400, message: "La cantidad no puede ser negativa" };
  }

  try {
    const query = `
      UPDATE parts 
      SET name = $1, description = $2, quantity = $3, price = $4, image = $5, compatible_models = $6
      WHERE id = $7
      RETURNING *
    `;
    const values = [
      name,
      description || null,
      quantity,
      price,
      image || null,
      compatible_models || null,
      id,
    ];
    console.log("[partService] Actualizando repuesto con valores:", values);
    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      throw { status: 404, message: "Repuesto no encontrado" };
    }
    console.log("[partService] Repuesto actualizado:", result.rows[0]);
    return result.rows[0];
  } catch (error) {
    console.error("[partService] Error al actualizar repuesto:", error);
    throw {
      status: error.status || 500,
      message: `Error al actualizar repuesto: ${error.message}`,
    };
  }
};

const deletePart = async (id) => {
  try {
    const query = `DELETE FROM parts WHERE id = $1 RETURNING *`;
    const result = await pool.query(query, [id]);
    if (result.rowCount === 0) {
      throw { status: 404, message: "Repuesto no encontrado" };
    }
    console.log("[partService] Repuesto eliminado:", result.rows[0]);
    return result.rows[0];
  } catch (error) {
    console.error("[partService] Error al eliminar repuesto:", error);
    throw {
      status: error.status || 500,
      message: `Error al eliminar repuesto: ${error.message}`,
    };
  }
};

const updatePartInventory = async (partId, quantityChange) => {
  try {
    const partResult = await pool.query(
      "SELECT quantity FROM parts WHERE id = $1",
      [partId]
    );
    if (partResult.rowCount === 0) {
      throw { status: 404, message: `Repuesto con ID ${partId} no encontrado` };
    }

    const currentQuantity = parseInt(partResult.rows[0].quantity, 10);
    const newQuantity = currentQuantity - quantityChange;

    if (newQuantity < 0) {
      throw {
        status: 400,
        message: `Inventario insuficiente para el repuesto ${partId}. Disponible: ${currentQuantity}, Solicitado: ${quantityChange}`,
      };
    }

    const query = `
      UPDATE parts 
      SET quantity = $1
      WHERE id = $2
      RETURNING *
    `;
    const values = [newQuantity, partId];
    console.log("[partService] Actualizando inventario con valores:", values);
    const result = await pool.query(query, values);
    console.log("[partService] Inventario actualizado:", result.rows[0]);
    return result.rows[0];
  } catch (error) {
    console.error("[partService] Error al actualizar inventario:", error);
    throw {
      status: error.status || 500,
      message: `Error al actualizar inventario: ${error.message}`,
    };
  }
};

module.exports = {
  getParts,
  createPart,
  updatePart,
  deletePart,
  updatePartInventory,
};
