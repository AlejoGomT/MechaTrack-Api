const pool = require("../config/database");
const notificationService = require("./notificationService");

const getOrders = async (
  status,
  economicNumber,
  orderNumber,
  technician_id
) => {
  let query =
    "SELECT o.*, v.branch, v.plate, v.brand, v.model, v.year FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE 1=1";
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
    "SELECT o.*, v.branch, v.plate, v.brand, v.model, v.year FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE o.id = $1",
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
    parts,
  } = orderData;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validar vehículo
    const vehicleResult = await client.query(
      "SELECT * FROM vehicles WHERE economic_number = $1 AND branch = $2",
      [vehicle_economic_number, branch]
    );
    if (!vehicleResult.rows.length) {
      throw { status: 400, message: "Vehículo no encontrado en la sucursal" };
    }

    // Validar órdenes activas
    const activeOrderResult = await client.query(
      "SELECT * FROM orders WHERE vehicle_economic_number = $1 AND status = $2",
      [vehicle_economic_number, "En Proceso"]
    );
    if (activeOrderResult.rows.length) {
      throw {
        status: 400,
        message: "El vehículo ya tiene una orden activa",
      };
    }

    // Generar nuevo ID
    const idResult = await pool.query(
      "SELECT id FROM orders ORDER BY CAST(id AS INTEGER) DESC LIMIT 1"
    );
    let newId = "001";
    if (idResult.rows.length) {
      const lastId = parseInt(idResult.rows[0].id, 10);
      newId = (lastId + 1).toString().padStart(3, "0");
    }

    // Insertar orden
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
    const result = await client.query(query, values);
    const order = result.rows[0];

    // Insertar repuestos si existen
    if (parts && parts.length > 0) {
      const partQuery = `
        INSERT INTO order_parts (
          order_id, part_id, quantity, status, requested_by, authorized_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      for (const part of parts) {
        const partValues = [
          order.id,
          part.part_id,
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

        // Obtener el nombre del repuesto desde la tabla parts
        const partResult = await client.query(
          "SELECT name FROM parts WHERE id = $1",
          [part.part_id]
        );
        const partName = partResult.rows[0]?.name || "Repuesto desconocido";

        await notificationService.createNotification({
          order_id: order.id,
          from_user_id: part.requested_by,
          to_user_id: adminId,
          message: `Solicitud de repuesto: ${partName} (${part.quantity})`,
          type: "part_request",
          status: "Pendiente", // Cambiado de "pending" a "Pendiente"
        });
      }
    }

    // Actualizar kilometraje del vehículo
    await client.query(
      "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
      [kilometraje, vehicle_economic_number, branch]
    );

    await client.query("COMMIT");
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error al crear orden:", err);
    throw err.status ? err : { status: 500, message: "Error al crear orden" };
  } finally {
    client.release();
  }
};

const updateOrder = async (id, orderData) => {
  const { initial_diagnosis, tasks, images, kilometraje, branch, parts } =
    orderData;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [id]
    );
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
    if (parts && parts.length > 0) {
      for (const part of parts) {
        const existingPart = await client.query(
          "SELECT * FROM order_parts WHERE order_id = $1 AND part_id = $2",
          [id, part.part_id]
        );
        if (existingPart.rows.length) {
          await client.query(
            `
            UPDATE order_parts
            SET quantity = $1, status = $2, requested_by = $3, authorized_by = $4
            WHERE order_id = $5 AND part_id = $6
          `,
            [
              part.quantity,
              part.status || "Solicitado",
              part.requested_by,
              part.authorized_by,
              id,
              part.part_id,
            ]
          );
        } else {
          await client.query(
            `
            INSERT INTO order_parts (
              order_id, part_id, quantity, status, requested_by, authorized_by
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
            [
              id,
              part.part_id,
              part.quantity,
              part.status || "Solicitado",
              part.requested_by,
              part.authorized_by,
            ]
          );
        }
      }
    }

    if (kilometraje !== undefined && branch) {
      const vehicleResult = await client.query(
        "SELECT * FROM vehicles WHERE economic_number = $1 AND branch = $2",
        [orderResult.rows[0].vehicle_economic_number, branch]
      );
      if (!vehicleResult.rows.length) {
        throw { status: 400, message: "Vehículo no encontrado en la sucursal" };
      }
      await client.query(
        "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
        [kilometraje, orderResult.rows[0].vehicle_economic_number, branch]
      );
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
      await client.query(
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

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error al actualizar la orden:", err);
    throw {
      status: err.status || 500,
      message: err.message || "Error al actualizar la orden",
      details: err.stack,
    };
  } finally {
    client.release();
  }
};

const requestPart = async (orderId, part) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const partQuery = `
      INSERT INTO order_parts (
        order_id, part_id, quantity, status, requested_by, authorized_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const partValues = [
      orderId,
      part.part_id,
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

    // Obtener el nombre del repuesto desde la tabla parts
    const partResult = await client.query(
      "SELECT name FROM parts WHERE id = $1",
      [part.part_id]
    );
    const partName = partResult.rows[0]?.name || "Repuesto desconocido";

    await notificationService.createNotification({
      order_id: orderId,
      from_user_id: part.requested_by,
      to_user_id: adminId,
      message: `Solicitud de repuesto: ${partName} (${part.quantity})`,
      type: "part_request",
      status: "Pendiente", // Cambiado de "pending" a "Pendiente"
    });

    await client.query("COMMIT");
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
    if (quantity === 0) {
      await client.query(
        "DELETE FROM order_parts WHERE order_id = $1 AND part_id = $2",
        [orderId, partId]
      );
    } else {
      await client.query(
        "UPDATE order_parts SET quantity = $1 WHERE order_id = $2 AND part_id = $3",
        [quantity, orderId, partId]
      );
    }
    await client.query("COMMIT");
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
    await client.query(
      `
      UPDATE order_parts
      SET status = $1, quantity = $2
      WHERE order_id = $3 AND part_id = $4
    `,
      ["Devolución Solicitada", quantity, orderId, partId]
    );

    const orderResult = await client.query(
      "SELECT technician_id FROM orders WHERE id = $1",
      [orderId]
    );
    const technicianId = orderResult.rows[0].technician_id;

    const adminResult = await client.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    const adminId = adminResult.rows[0]?.id || "U001";

    // Obtener el nombre del repuesto desde la tabla parts
    const partResult = await client.query(
      "SELECT name FROM parts WHERE id = $1",
      [partId]
    );
    const partName = partResult.rows[0]?.name || "Repuesto desconocido";

    await notificationService.createNotification({
      order_id: orderId,
      from_user_id: technicianId,
      to_user_id: adminId,
      message: `Solicitud de devolución: ${partName} (${quantity})`,
      type: "part_return",
      status: "Pendiente", // Cambiado de "pending" a "Pendiente"
    });

    await client.query("COMMIT");
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
