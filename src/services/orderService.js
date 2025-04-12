const pool = require("../config/database");

const getOrders = async (
  status,
  economicNumber,
  orderNumber,
  technician_id
) => {
  let query =
    "SELECT o.*, v.branch FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE 1=1";
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
  const result = await pool.query(query, values);
  return result.rows;
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
    parts: partsResult.rows,
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
    branch,
    kilometraje,
  } = orderData;

  const vehicleResult = await pool.query(
    "SELECT * FROM vehicles WHERE economic_number = $1 AND branch = $2",
    [vehicle_economic_number, branch]
  );
  if (!vehicleResult.rows.length) {
    throw { status: 400, message: "Vehículo no encontrado" };
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
    "SELECT id FROM orders WHERE id LIKE 'ORD%' ORDER BY id DESC LIMIT 1"
  );
  let newId = "ORD100";
  if (idResult.rows.length) {
    const lastId = idResult.rows[0].id;
    const number = parseInt(lastId.replace("ORD", "")) + 1;
    newId = `ORD${number.toString().padStart(3, "0")}`;
  }

  const query = `
    INSERT INTO orders (id, type, description, initial_diagnosis, tasks, images, technician_id, vehicle_economic_number, status, created_at, branch, kilometraje)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;
  const values = [
    newId,
    type,
    description,
    initial_diagnosis,
    tasks,
    images,
    technician_id,
    vehicle_economic_number,
    "Pendiente",
    new Date(),
    branch,
    kilometraje,
  ];
  const result = await pool.query(query, values);

  await pool.query(
    "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
    [kilometraje, vehicle_economic_number, branch]
  );

  return result.rows[0];
};

const updateOrder = async (id, orderData) => {
  const { status, description, initial_diagnosis, tasks, images } = orderData;

  const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [
    id,
  ]);
  if (!orderResult.rows.length) {
    throw { status: 404, message: "Orden no encontrada" };
  }

  const updates = [];
  const values = [id];
  let paramIndex = 2;

  if (status) {
    updates.push(`status = $${paramIndex}`);
    values.push(status);
    paramIndex++;
  }
  if (description) {
    updates.push(`description = $${paramIndex}`);
    values.push(description);
    paramIndex++;
  }
  if (initial_diagnosis) {
    updates.push(`initial_diagnosis = $${paramIndex}`);
    values.push(initial_diagnosis);
    paramIndex++;
  }
  if (tasks) {
    updates.push(`tasks = $${paramIndex}`);
    values.push(tasks);
    paramIndex++;
  }
  if (images && images.length > 0) {
    updates.push(`images = $${paramIndex}`);
    values.push(images);
    paramIndex++;
  }

  if (updates.length === 0) {
    throw {
      status: 400,
      message: "No se proporcionaron datos para actualizar",
    };
  }

  const query = `
    UPDATE orders
    SET ${updates.join(", ")}, updated_at = $${paramIndex}
    WHERE id = $1
    RETURNING *
  `;
  values.push(new Date());

  const result = await pool.query(query, values);

  // Registrar en el historial
  if (initial_diagnosis || status) {
    await pool.query(
      `
      INSERT INTO order_history (order_id, description, status, date)
      VALUES ($1, $2, $3, $4)
    `,
      [
        id,
        initial_diagnosis || "Actualización de estado",
        status || result.rows[0].status,
        new Date(),
      ]
    );
  }

  // Crear notificación si se cambia a "Pendiente" para aprobación
  if (status === "Pendiente") {
    await pool.query(
      `
      INSERT INTO notifications (order_id, recipient_id, message, status, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [
        id,
        "U001", // Admin
        `Orden ${id} finalizada, esperando aprobación`,
        "Pendiente",
        new Date(),
      ]
    );
  }

  return result.rows[0];
};

module.exports = { getOrders, getOrderById, createOrder, updateOrder };
