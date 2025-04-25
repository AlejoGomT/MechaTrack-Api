const pool = require("../config/database");
const notificationService = require("./notificationService");

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
  try {
    const query = `
      SELECT o.*, v.branch, v.plate
      FROM orders o
      LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
      WHERE o.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    return result.rows[0];
  } catch (err) {
    console.error("Error al obtener orden:", err);
    throw err.status ? err : { status: 500, message: "Error al obtener orden" };
  }
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
    plate,
    brand,
    model,
    year,
    parts,
  } = orderData;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Log para depurar datos antes de insertar
    console.log("Datos para crear orden en orderService:", orderData);

    const orderQuery = `
      INSERT INTO orders (
        type, description, initial_diagnosis, tasks, images, technician_id,
        vehicle_economic_number, kilometraje, branch, plate, brand, model, year,
        created_at, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;
    const orderValues = [
      type,
      description,
      initial_diagnosis,
      tasks || "",
      images || [],
      technician_id,
      vehicle_economic_number,
      kilometraje,
      branch,
      plate || null,
      brand || null,
      model || null,
      year || null,
      new Date(),
      "Abierto",
    ];
    const orderResult = await client.query(orderQuery, orderValues);
    const order = orderResult.rows[0];

    if (parts && parts.length > 0) {
      const partQuery = `
        INSERT INTO order_parts (
          order_id, part_id, name, quantity, status, requested_by, authorized_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      for (const part of parts) {
        const partValues = [
          order.id,
          part.part_id,
          part.name,
          part.quantity,
          part.status || "Solicitado",
          part.requested_by,
          part.authorized_by,
        ];
        await client.query(partQuery, partValues);

        const adminResult = await client.query(
          "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
        );
        const adminId = adminResult.rows[0]?.id || "U001";

        await notificationService.createNotification({
          order_id: order.id,
          from_user_id: part.requested_by,
          to_user_id: adminId,
          message: `Solicitud de repuesto: ${part.name} (${part.quantity})`,
          type: "part_request",
          status: "pending",
        });
      }
    }

    await client.query("COMMIT");
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error al crear orden en orderService:", err);
    throw err.status ? err : { status: 500, message: "Error al crear orden" };
  } finally {
    client.release();
  }
};

const updateOrder = async (id, orderData) => {
  const { initial_diagnosis, tasks, images, parts, kilometraje, branch } =
    orderData;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const query = `
      UPDATE orders
      SET
        initial_diagnosis = COALESCE($1, initial_diagnosis),
        tasks = COALESCE($2, tasks),
        images = COALESCE($3, images),
        kilometraje = COALESCE($4, kilometraje),
        branch = COALESCE($5, branch),
        updated_at = $6
      WHERE id = $7
      RETURNING *
    `;
    const values = [
      initial_diagnosis,
      tasks,
      images,
      kilometraje,
      branch,
      new Date(),
      id,
    ];
    const result = await client.query(query, values);
    if (result.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    const order = result.rows[0];

    if (parts && parts.length > 0) {
      const deleteQuery = "DELETE FROM order_parts WHERE order_id = $1";
      await client.query(deleteQuery, [id]);

      const partQuery = `
        INSERT INTO order_parts (
          order_id, part_id, name, quantity, status, requested_by, authorized_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      for (const part of parts) {
        const partValues = [
          id,
          part.part_id,
          part.name,
          part.quantity,
          part.status || "Solicitado",
          part.requested_by,
          part.authorized_by,
        ];
        await client.query(partQuery, partValues);
      }
    }

    await client.query("COMMIT");
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error al actualizar orden:", err);
    throw err.status
      ? err
      : { status: 500, message: "Error al actualizar orden" };
  } finally {
    client.release();
  }
};

const requestPart = async (orderId, partData) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const query = `
      INSERT INTO order_parts (
        order_id, part_id, name, quantity, status, requested_by, authorized_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      orderId,
      partData.part_id,
      partData.name,
      partData.quantity,
      partData.status || "Solicitado",
      partData.requested_by,
      partData.authorized_by,
    ];
    const result = await client.query(query, values);

    const adminResult = await client.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    const adminId = adminResult.rows[0]?.id || "U001"; // Fallback a U001 si no hay admin

    await notificationService.createNotification({
      order_id: orderId,
      from_user_id: partData.requested_by,
      to_user_id: adminId,
      message: `Solicitud de repuesto: ${partData.name} (${partData.quantity})`,
      type: "part_request",
      status: "pending",
    });

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error al solicitar repuesto:", err);
    throw err.status
      ? err
      : { status: 500, message: "Error al solicitar repuesto" };
  } finally {
    client.release();
  }
};

const updatePartQuantity = async (orderId, partId, quantity) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const query = `
      UPDATE order_parts
      SET quantity = $1
      WHERE order_id = $2 AND part_id = $3
      RETURNING *
    `;
    const values = [quantity, orderId, partId];
    const result = await client.query(query, values);
    if (result.rows.length === 0) {
      throw { status: 404, message: "Repuesto no encontrado" };
    }

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error al actualizar cantidad de repuesto:", err);
    throw err.status
      ? err
      : { status: 500, message: "Error al actualizar cantidad de repuesto" };
  } finally {
    client.release();
  }
};

const requestPartReturn = async (orderId, partId, quantity) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const partQuery = `
      SELECT * FROM order_parts
      WHERE order_id = $1 AND part_id = $2 AND status = 'Aprobado'
    `;
    const partResult = await client.query(partQuery, [orderId, partId]);
    if (partResult.rows.length === 0) {
      throw {
        status: 400,
        message: "Repuesto no encontrado o no está aprobado",
      };
    }

    const adminResult = await client.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    const adminId = adminResult.rows[0]?.id || "U001"; // Fallback a U001 si no hay admin

    await notificationService.createNotification({
      order_id: orderId,
      from_user_id: partResult.rows[0].requested_by,
      to_user_id: adminId,
      message: `Solicitud de devolución de repuesto: ${partResult.rows[0].name} (${quantity})`,
      type: "part_return_request",
      status: "pending",
    });

    await client.query("COMMIT");
    return { message: "Solicitud de devolución enviada" };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error al solicitar devolución de repuesto:", err);
    throw err.status
      ? err
      : { status: 500, message: "Error al solicitar devolución de repuesto" };
  } finally {
    client.release();
  }
};

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  requestPart,
  updatePartQuantity,
  requestPartReturn,
};
