const pool = require("../config/database");

const getOrders = async (
  status,
  economicNumber,
  orderNumber,
  technician_id
) => {
  let query =
    "SELECT o.*, v.branch, v.plate FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE 1=1";
  const values = [];
  if (status) {
    query += " AND o.status = $" + (values.length + 1);
    values.push(status);
  }
  if (economicNumber) {
    query += " AND o.vehicle_economic_number ILIKE $" + (values.length + 1);
    values.push(`%${economicNumber}%`);
  }
  if (orderNumber) {
    query += " AND o.id ILIKE $" + (values.length + 1);
    values.push(`%${orderNumber}%`);
  }
  if (technician_id) {
    query += " AND o.technician_id = $" + (values.length + 1);
    values.push(technician_id);
  }
  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (err) {
    console.error("Error al obtener órdenes:", err);
    throw { status: 500, message: "Error al obtener órdenes" };
  }
};

const getOrderById = async (id) => {
  const orderResult = await pool.query(
    "SELECT o.*, v.branch FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE o.id = $1",
    [id]
  );
  if (!orderResult.rows.length) return null;

  const order = orderResult.rows[0];
  const historyResult = await pool.query(
    "SELECT * FROM order_history WHERE order_id = $1",
    [id]
  );
  const partsResult = await pool.query(
    "SELECT op.*, p.name FROM order_parts op JOIN parts p ON op.part_id = p.id WHERE order_id = $1",
    [id]
  );
  const notificationsResult = await pool.query(
    "SELECT * FROM notifications WHERE order_id = $1",
    [id]
  );
  const invoiceResult = await pool.query(
    "SELECT * FROM invoices WHERE order_id = $1",
    [id]
  );

  return {
    ...order,
    history: historyResult.rows,
    parts: partsResult.rows.map((part) => ({
      part_id: part.part_id,
      name: part.name,
      quantity: part.quantity,
      status: part.status,
      requested_by: part.requested_by,
      authorized_by: part.authorized_by,
    })),
    notifications: notificationsResult.rows,
    invoice: invoiceResult.rows[0] || null,
  };
};

const createOrder = async (orderData) => {
  const {
    type,
    description,
    initial_diagnosis,
    tasks,
    images,
    technician_id,
    vehicle_economic_number,
    kilometraje,
    branch,
  } = orderData;

  try {
    const vehicleResult = await pool.query(
      "SELECT * FROM vehicles WHERE economic_number = $1 AND branch = $2",
      [vehicle_economic_number, branch]
    );
    if (!vehicleResult.rows.length) {
      throw { status: 400, message: "Vehículo no encontrado en la sucursal" };
    }

    const activeOrderResult = await pool.query(
      "SELECT * FROM orders WHERE vehicle_economic_number = $1 AND status = $2",
      [vehicle_economic_number, "En Proceso"]
    );
    if (activeOrderResult.rows.length) {
      throw {
        status: 400,
        message: "El vehículo ya tiene una orden activa",
      };
    }

    const idResult = await pool.query(
      "SELECT id FROM orders ORDER BY CAST(id AS INTEGER) DESC LIMIT 1"
    );
    let newId = "001";
    if (idResult.rows.length) {
      const lastId = parseInt(idResult.rows[0].id, 10);
      newId = (lastId + 1).toString().padStart(3, "0");
    }

    const query = `
      INSERT INTO orders (id, type, description, initial_diagnosis, tasks, images, technician_id, vehicle_economic_number, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const values = [
      newId,
      type,
      description,
      initial_diagnosis || null,
      tasks || null,
      images || [],
      technician_id,
      vehicle_economic_number,
      "En Proceso",
      new Date(),
    ];
    const result = await pool.query(query, values);

    await pool.query(
      "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
      [kilometraje, vehicle_economic_number, branch]
    );

    return result.rows[0];
  } catch (err) {
    console.error("Error al crear la orden:", err);
    throw err;
  }
};

const updateOrder = async (id, orderData) => {
  const { initial_diagnosis, tasks, images, kilometraje, branch } = orderData;

  try {
    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [
      id,
    ]);
    if (!orderResult.rows.length) {
      throw { status: 404, message: "Orden no encontrada" };
    }

    const updates = [];
    const values = [id];
    let paramIndex = 2;

    if (initial_diagnosis !== undefined && initial_diagnosis !== "") {
      updates.push(`initial_diagnosis = $${paramIndex}`);
      values.push(initial_diagnosis);
      paramIndex++;
    }
    if (tasks !== undefined) {
      updates.push(`tasks = $${paramIndex}`);
      values.push(tasks || null);
      paramIndex++;
    }
    if (images !== undefined) {
      updates.push(`images = $${paramIndex}`);
      values.push(images || []);
      paramIndex++;
    }

    if (kilometraje !== undefined && branch) {
      const vehicleResult = await pool.query(
        "SELECT * FROM vehicles WHERE economic_number = $1 AND branch = $2",
        [orderResult.rows[0].vehicle_economic_number, branch]
      );
      if (!vehicleResult.rows.length) {
        throw { status: 400, message: "Vehículo no encontrado en la sucursal" };
      }
      await pool.query(
        "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
        [kilometraje, orderResult.rows[0].vehicle_economic_number, branch]
      );
    }

    if (updates.length === 0 && kilometraje === undefined) {
      throw {
        status: 400,
        message: "No se proporcionaron datos para actualizar",
      };
    }

    let result;
    if (updates.length > 0) {
      const query = `
        UPDATE orders
        SET ${updates.join(", ")}, updated_at = $${paramIndex}
        WHERE id = $1
        RETURNING *
      `;
      values.push(new Date());
      console.log("Consulta SQL para updateOrder:", query, values);
      result = await pool.query(query, values);
    } else {
      result = orderResult;
    }

    if (initial_diagnosis !== undefined && initial_diagnosis !== "") {
      await pool.query(
        `
        INSERT INTO order_history (order_id, description, status, date)
        VALUES ($1, $2, $3, $4)
      `,
        [
          id,
          initial_diagnosis || "Actualización sin diagnóstico",
          result.rows[0].status,
          new Date(),
        ]
      );
    }

    return result.rows[0];
  } catch (err) {
    console.error("Error al actualizar la orden:", err);
    throw {
      status: err.status || 500,
      message: err.message || "Error al actualizar la orden",
      details: err.stack,
    };
  }
};

module.exports = { getOrders, getOrderById, createOrder, updateOrder };
