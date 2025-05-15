const pool = require("../config/database");
const notificationService = require("./notificationService");
const partService = require("./partService");

const getOrders = async (
  status,
  economicNumber,
  orderNumber,
  serviceType,
  technician_id,
  page = 1,
  limit = 10,
  startDate,
  endDate
) => {
  let query = `
    SELECT o.*, v.branch, v.plate, v.brand, v.model, v.year, v.mileage, 
           COUNT(*) OVER() as total_count 
    FROM orders o 
    LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number 
    WHERE 1=1
  `;
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
  if (serviceType) {
    query += " AND o.type >= $" + (values.length + 1);
    values.push(serviceType);
  }
  if (startDate) {
    query += " AND o.created_at >= $" + (values.length + 1);
    values.push(startDate);
  }
  if (endDate) {
    query += " AND o.created_at <= $" + (values.length + 1);
    values.push(endDate);
  }
  query += ` ORDER BY o.created_at DESC LIMIT $${values.length + 1} OFFSET $${
    values.length + 2
  }`;
  values.push(limit, (page - 1) * limit);

  try {
    const result = await pool.query(query, values);
    console.log("[ORDER_SERVICE] Órdenes obtenidas:", result.rows.length);
    const total =
      result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return {
      orders: result.rows,
      total,
      totalPages: Math.ceil(total / limit),
    };
  } catch (err) {
    console.error("[ORDER_SERVICE] Error al obtener órdenes:", err);
    throw { status: 500, message: "Error al obtener órdenes" };
  }
};

const getOrderById = async (id) => {
  const client = await pool.connect();
  try {
    const orderResult = await client.query(
      "SELECT o.*, v.branch, v.plate, v.brand, v.model, v.year, v.mileage FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE o.id = $1",
      [id]
    );
    if (!orderResult.rows.length) {
      console.log("[ORDER_SERVICE] Orden no encontrada para id:", id);
      return null;
    }

    const order = orderResult.rows[0];
    const historyResult = await client.query(
      "SELECT * FROM order_history WHERE order_id = $1",
      [id]
    );
    const partsResult = await client.query(
      `
      SELECT op.*, p.name,
             req_user.id AS requested_by_id,
             req_user.first_name AS requested_by_first_name,
             req_user.last_name AS requested_by_last_name,
             auth_user.id AS authorized_by_id,
             auth_user.first_name AS authorized_by_first_name,
             auth_user.last_name AS authorized_by_last_name
      FROM order_parts op
      JOIN parts p ON op.part_id = p.id
      LEFT JOIN users req_user ON op.requested_by = req_user.id
      LEFT JOIN users auth_user ON op.authorized_by = auth_user.id
      WHERE order_id = $1
      `,
      [id]
    );
    const notificationsResult = await client.query(
      "SELECT * FROM notifications WHERE order_id = $1",
      [id]
    );
    const invoiceResult = await client.query(
      "SELECT invoice_number, delivery_note_number, total FROM invoices WHERE order_id = $1",
      [id]
    );

    const response = {
      ...order,
      history: historyResult.rows,
      parts: partsResult.rows.map((part) => ({
        part_id: part.part_id,
        name: part.name,
        quantity: part.quantity,
        price: part.price,
        status: part.status,
        requested_by_id: part.requested_by_id || null,
        requested_by: part.requested_by_first_name
          ? `${part.requested_by_first_name} ${part.requested_by_last_name}`
          : "Técnico",
        authorized_by_id: part.authorized_by_id || null,
        authorized_by: part.authorized_by_first_name
          ? `${part.authorized_by_first_name} ${part.authorized_by_last_name}`
          : null,
      })),
      notifications: notificationsResult.rows,
      invoice: invoiceResult.rows[0] || null,
    };
    console.log("[ORDER_SERVICE] Respuesta de getOrderById:", response);
    return response;
  } catch (error) {
    console.error("[ORDER_SERVICE] Error en getOrderById:", error);
    throw error;
  } finally {
    client.release();
  }
};

const getOrderCounts = async (technician_id) => {
  let query = `
    SELECT 
      COUNT(*) FILTER (WHERE status = 'En Proceso') AS in_process,
      COUNT(*) FILTER (WHERE status = 'Pendiente') AS pending,
      COUNT(*) FILTER (WHERE status = 'Finalizado') AS completed
    FROM orders
    WHERE 1=1
  `;
  const values = [];

  if (technician_id) {
    query += " AND technician_id = $1";
    values.push(technician_id);
  }

  try {
    const result = await pool.query(query, values);
    console.log("[ORDER_SERVICE] Conteos obtenidos:", result.rows[0]);
    return {
      inProcess: parseInt(result.rows[0].in_process, 10) || 0,
      pending: parseInt(result.rows[0].pending, 10) || 0,
      completed: parseInt(result.rows[0].completed, 10) || 0,
    };
  } catch (err) {
    console.error("[ORDER_SERVICE] Error al obtener conteos:", err);
    throw { status: 500, message: "Error al obtener conteos de órdenes" };
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
    parts,
  } = orderData;

  if (
    !type ||
    !description ||
    !technician_id ||
    !vehicle_economic_number ||
    !branch ||
    !kilometraje
  ) {
    console.error(
      "[ORDER_SERVICE] Faltan campos obligatorios en orderData:",
      orderData
    );
    throw { status: 400, message: "Faltan campos obligatorios en orderData" };
  }
  console.log("[ORDER_SERVICE] Datos recibidos en createOrder:", orderData);

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    console.log("[ORDER_SERVICE] Transacción iniciada con SERIALIZABLE");

    const vehicleResult = await client.query(
      "SELECT * FROM vehicles WHERE economic_number = $1 AND branch = $2",
      [vehicle_economic_number, branch]
    );
    if (!vehicleResult.rows.length) {
      console.error("[ORDER_SERVICE] Vehículo no encontrado:", {
        vehicle_economic_number,
        branch,
      });
      throw { status: 400, message: "Vehículo no encontrado en la sucursal" };
    }

    const activeOrderResult = await client.query(
      "SELECT * FROM orders WHERE vehicle_economic_number = $1 AND status = $2",
      [vehicle_economic_number, "En Proceso"]
    );
    if (activeOrderResult.rows.length) {
      console.error(
        "[ORDER_SERVICE] Orden activa encontrada para vehículo:",
        vehicle_economic_number
      );
      throw {
        status: 400,
        message: "El vehículo ya tiene una orden activa",
      };
    }

    const idResult = await client.query(
      "SELECT nextval('orders_id_seq') AS new_id"
    );
    const newId = idResult.rows[0].new_id.toString().padStart(3, "0");

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
      images && images.length > 0 ? images : [],
      technician_id,
      vehicle_economic_number,
      "En Proceso",
      new Date(),
    ];

    const result = await client.query(query, values);
    const order = result.rows[0];

    const verifyOrder = await client.query(
      "SELECT id FROM orders WHERE id = $1",
      [newId]
    );
    if (!verifyOrder.rows.length) {
      console.error("[ORDER_SERVICE] Fallo al verificar orden con id:", newId);
      throw {
        status: 500,
        message: "Fallo al insertar la orden en la base de datos",
      };
    }

    if (parts && Array.isArray(parts) && parts.length > 0) {
      const partQuery = `
        INSERT INTO order_parts (
          order_id, part_id, quantity, price, status, requested_by, authorized_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      for (const part of parts) {
        if (!part.part_id || !part.quantity || !part.requested_by) {
          console.error("[ORDER_SERVICE] Datos de repuesto inválidos:", part);
          throw { status: 400, message: "Datos de repuesto inválidos" };
        }

        const partResult = await client.query(
          "SELECT price, name FROM parts WHERE id = $1",
          [part.part_id]
        );
        if (!partResult.rows.length) {
          throw {
            status: 400,
            message: `Repuesto con ID ${part.part_id} no encontrado`,
          };
        }
        const partPrice = partResult.rows[0].price;

        if (part.status === "Aprobado") {
          const availableQuantity = parseInt(partResult.rows[0].quantity, 10);
          if (part.quantity > availableQuantity) {
            throw {
              status: 400,
              message: `Inventario insuficiente para el repuesto ${part.part_id}. Disponible: ${availableQuantity}, Solicitado: ${part.quantity}`,
            };
          }
          await partService.updatePartInventory(part.part_id, part.quantity);
        }

        const partValues = [
          order.id,
          part.part_id,
          part.quantity,
          partPrice,
          part.status || "Solicitado",
          part.requested_by,
          part.authorized_by || null,
        ];
        await client.query(partQuery, partValues);
      }
    }

    const adminResult = await client.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    if (!adminResult.rows.length) {
      throw {
        status: 500,
        message: "No se encontró un usuario administrador",
      };
    }
    const adminId = adminResult.rows[0].id;

    const technicianResult = await client.query(
      "SELECT first_name, last_name FROM users WHERE id = $1",
      [technician_id]
    );
    const technicianName = technicianResult.rows[0]
      ? `${technicianResult.rows[0].first_name} ${technicianResult.rows[0].last_name}`
      : technician_id;

    await notificationService.createNotification(
      {
        order_id: order.id,
        from_user_id: technician_id,
        to_user_id: adminId,
        message: `Nueva orden #${order.id} creada por el técnico ${technicianName}`,
        type: "order_creation",
        status: "Pendiente",
        details: {
          vehicle_economic_number,
          description,
        },
      },
      client
    );

    await client.query(
      "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
      [kilometraje, vehicle_economic_number, branch]
    );

    await client.query("COMMIT");
    console.log("[ORDER_SERVICE] Orden creada exitosamente:", order);
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[ORDER_SERVICE] Error al crear orden:", err);
    throw err.status
      ? err
      : { status: 500, message: "Error al crear orden", details: err.message };
  } finally {
    client.release();
  }
};

const updateOrder = async (id, orderData) => {
  const {
    initial_diagnosis,
    tasks,
    images,
    kilometraje,
    branch,
    parts,
    vehicle_economic_number,
    status,
  } = orderData;

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

    if (
      vehicle_economic_number &&
      String(vehicle_economic_number).length > 10
    ) {
      throw {
        status: 400,
        message: "El número económico no puede exceder los 10 caracteres",
      };
    }
    if (branch && String(branch).length > 10) {
      throw {
        status: 400,
        message: "La sucursal no puede exceder los 10 caracteres",
      };
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
    if (status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (parts && Array.isArray(parts) && parts.length > 0) {
      const currentPartsResult = await client.query(
        "SELECT part_id, status FROM order_parts WHERE order_id = $1",
        [id]
      );
      const currentParts = currentPartsResult.rows;

      const partsToDelete = currentParts.filter(
        (cp) =>
          cp.status === "Solicitado" &&
          !parts.some((p) => p.part_id === cp.part_id)
      );

      for (const part of partsToDelete) {
        await client.query(
          "DELETE FROM order_parts WHERE order_id = $1 AND part_id = $2",
          [id, part.part_id]
        );
        await notificationService.deletePartRequestNotification(
          id,
          part.part_id,
          client
        );
      }

      for (const part of parts) {
        if (!part.part_id || !part.quantity || !part.requested_by) {
          throw {
            status: 400,
            message: `Datos de repuesto inválidos: ${JSON.stringify(part)}`,
          };
        }
        const userResult = await client.query(
          "SELECT id FROM users WHERE id = $1",
          [part.requested_by]
        );
        if (!userResult.rows.length) {
          throw {
            status: 400,
            message: `Usuario con ID ${part.requested_by} no encontrado`,
          };
        }
        if (part.authorized_by) {
          const authUserResult = await client.query(
            "SELECT id FROM users WHERE id = $1",
            [part.authorized_by]
          );
          if (!authUserResult.rows.length) {
            throw {
              status: 400,
              message: `Usuario autorizado con ID ${part.authorized_by} no encontrado`,
            };
          }
        }

        const partResult = await client.query(
          "SELECT price, name, quantity AS available_quantity FROM parts WHERE id = $1",
          [part.part_id]
        );
        if (!partResult.rows.length) {
          throw {
            status: 400,
            message: `Repuesto con ID ${part.part_id} no encontrado`,
          };
        }
        const partPrice = partResult.rows[0].price;

        if (part.status === "Aprobado") {
          const availableQuantity = parseInt(
            partResult.rows[0].available_quantity,
            10
          );
          const existingPart = await client.query(
            "SELECT quantity FROM order_parts WHERE order_id = $1 AND part_id = $2",
            [id, part.part_id]
          );
          const previousQuantity = existingPart.rows.length
            ? parseInt(existingPart.rows[0].quantity, 10)
            : 0;
          const quantityChange = part.quantity - previousQuantity;
          if (quantityChange > availableQuantity) {
            throw {
              status: 400,
              message: `Inventario insuficiente para el repuesto ${part.part_id}. Disponible: ${availableQuantity}, Solicitado: ${quantityChange}`,
            };
          }
          if (quantityChange > 0) {
            await partService.updatePartInventory(part.part_id, quantityChange);
          }
        }

        const existingPart = await client.query(
          "SELECT * FROM order_parts WHERE order_id = $1 AND part_id = $2",
          [id, part.part_id]
        );
        if (existingPart.rows.length) {
          await client.query(
            `
            UPDATE order_parts
            SET quantity = $1, price = $2, status = $3, requested_by = $4, authorized_by = $5
            WHERE order_id = $6 AND part_id = $7
          `,
            [
              part.quantity,
              partPrice,
              part.status || "Solicitado",
              part.requested_by,
              part.authorized_by || null,
              id,
              part.part_id,
            ]
          );
        } else {
          await client.query(
            `
            INSERT INTO order_parts (
              order_id, part_id, quantity, price, status, requested_by, authorized_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
            [
              id,
              part.part_id,
              part.quantity,
              partPrice,
              part.status || "Solicitado",
              part.requested_by,
              part.authorized_by || null,
            ]
          );
        }
      }
    } else {
      const partsToDelete = await client.query(
        "SELECT part_id FROM order_parts WHERE order_id = $1 AND status = $2",
        [id, "Solicitado"]
      );
      for (const part of partsToDelete.rows) {
        await client.query(
          "DELETE FROM order_parts WHERE order_id = $1 AND part_id = $2",
          [id, part.part_id]
        );
        await notificationService.deletePartRequestNotification(
          id,
          part.part_id,
          client
        );
      }
    }

    if (kilometraje && vehicle_economic_number && branch) {
      const vehicleResult = await client.query(
        "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3 RETURNING *",
        [kilometraje, vehicle_economic_number, branch]
      );
      if (!vehicleResult.rows.length) {
        throw {
          status: 400,
          message: `Vehículo con economic_number ${vehicle_economic_number} y branch ${branch} no encontrado`,
        };
      }
    }

    let updatedOrder;
    if (updates.length > 0) {
      const query = `UPDATE orders SET ${updates.join(
        ", "
      )} WHERE id = $1 RETURNING *`;
      const result = await client.query(query, values);
      updatedOrder = result.rows[0];
    } else {
      updatedOrder = orderResult.rows[0];
    }

    await client.query("COMMIT");
    return await getOrderById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[ORDER_SERVICE] Error al actualizar orden:", err);
    if (err.code === "22001") {
      throw {
        status: 400,
        message: `El valor proporcionado es demasiado largo para una columna (máximo 10 caracteres). Detalles: ${err.message}`,
        details: err.stack,
      };
    }
    throw {
      status: err.status || 500,
      message: err.message || "Error al actualizar orden",
      details: err.stack || err.message,
    };
  } finally {
    client.release();
  }
};

const updateOrderStatus = async (id, status) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(
      "[ORDER_SERVICE] Transacción iniciada para updateOrderStatus:",
      id
    );

    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [id]
    );
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", id);
      throw { status: 404, message: "Orden no encontrada" };
    }
    console.log("[ORDER_SERVICE] Orden encontrada:", orderResult.rows[0]);

    const query = `
      UPDATE orders
      SET status = $1, updated_at = $2
      WHERE id = $3
      RETURNING *
    `;
    const values = [status, new Date(), id];
    console.log(
      "[ORDER_SERVICE] Consulta SQL para updateOrderStatus:",
      query,
      values
    );
    const result = await client.query(query, values);
    console.log("[ORDER_SERVICE] Orden actualizada:", result.rows[0]);

    if (status === "Pendiente") {
      const adminResult = await client.query(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
      );
      if (!adminResult.rows.length) {
        console.error(
          "[ORDER_SERVICE] No se encontró un usuario administrador"
        );
        throw {
          status: 500,
          message: "No se encontró un usuario administrador",
        };
      }
      const adminId = adminResult.rows[0].id;
      console.log(
        "[ORDER_SERVICE] Creando notificación para adminId:",
        adminId
      );

      await notificationService.createNotification(
        {
          order_id: id,
          from_user_id: orderResult.rows[0].technician_id,
          to_user_id: adminId,
          message: `Orden #${id} enviada para aprobación`,
          type: "closure_approval",
          status: "Pendiente",
        },
        client
      );

      console.log(
        "[ORDER_SERVICE] Notificación creada para estado Pendiente en orden:",
        id
      );
    }

    await client.query("COMMIT");
    console.log(
      "[ORDER_SERVICE] Transacción completada para updateOrderStatus:",
      id
    );
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(
      "[ORDER_SERVICE] Error al actualizar estado de la orden:",
      err
    );
    throw {
      status: err.status || 500,
      message: err.message || "Error al actualizar estado de la orden",
      details: err.stack,
    };
  } finally {
    client.release();
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
  }
};

const updateOrderNumber = async (id, orderNumber) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(
      "[ORDER_SERVICE] Transacción iniciada para updateOrderNumber:",
      id
    );

    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [id]
    );
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", id);
      throw { status: 404, message: "Orden no encontrada" };
    }

    const query = `
      UPDATE orders
      SET order_number = $1, updated_at = $2
      WHERE id = $3
      RETURNING *
    `;
    const values = [orderNumber || null, new Date(), id];
    console.log(
      "[ORDER_SERVICE] Consulta SQL para updateOrderNumber:",
      query,
      values
    );
    const result = await client.query(query, values);
    console.log("[ORDER_SERVICE] Orden actualizada:", result.rows[0]);

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[ORDER_SERVICE] Error al actualizar número de pedido:", err);
    throw {
      status: err.status || 500,
      message: err.message || "Error al actualizar número de pedido",
      details: err.stack,
    };
  } finally {
    client.release();
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
  }
};

const updateInvoiceNumbers = async (
  orderId,
  { deliveryNoteNumber, invoiceNumber },
  userId
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(
      "[ORDER_SERVICE] Transacción iniciada para updateInvoiceNumbers:",
      orderId
    );

    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [orderId]
    );
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", orderId);
      throw { status: 404, message: "Orden no encontrada" };
    }

    let invoiceResult = await client.query(
      "SELECT * FROM invoices WHERE order_id = $1",
      [orderId]
    );

    if (!invoiceResult.rows.length) {
      const insertQuery = `
        INSERT INTO invoices (order_id, issued_by, issued_at)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      const insertValues = [orderId, userId, new Date()];
      console.log(
        "[ORDER_SERVICE] Creando registro en invoices:",
        insertValues
      );
      invoiceResult = await client.query(insertQuery, insertValues);
      console.log(
        "[ORDER_SERVICE] Registro de factura creado:",
        invoiceResult.rows[0]
      );
    }

    const updateQuery = `
      UPDATE invoices
      SET
        delivery_note_number = COALESCE($1, delivery_note_number),
        invoice_number = COALESCE($2, invoice_number),
        issued_at = $3
      WHERE order_id = $4
      RETURNING *
    `;
    const updateValues = [
      deliveryNoteNumber || null,
      invoiceNumber || null,
      new Date(),
      orderId,
    ];
    console.log(
      "[ORDER_SERVICE] Consulta SQL para updateInvoiceNumbers:",
      updateQuery,
      updateValues
    );
    const result = await client.query(updateQuery, updateValues);
    console.log("[ORDER_SERVICE] Factura actualizada:", result.rows[0]);

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(
      "[ORDER_SERVICE] Error al actualizar números de factura:",
      err
    );
    throw {
      status: err.status || 500,
      message: err.message || "Error al actualizar números de factura",
      details: err.stack,
    };
  } finally {
    client.release();
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
  }
};

const requestPart = async (orderId, part) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(
      "[ORDER_SERVICE] Transacción iniciada para requestPart:",
      orderId
    );

    const orderResult = await client.query(
      "SELECT technician_id FROM orders WHERE id = $1",
      [orderId]
    );
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", orderId);
      throw { status: 404, message: "Orden no encontrada" };
    }

    if (!part.part_id || !part.quantity || !part.requested_by) {
      console.error("[ORDER_SERVICE] Datos de repuesto inválidos:", part);
      throw { status: 400, message: "Datos de repuesto inválidos" };
    }

    const partQuery = `
      INSERT INTO order_parts (
        order_id, part_id, quantity, price, status, requested_by, authorized_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const partValues = [
      orderId,
      part.part_id,
      part.quantity,
      part.price,
      part.status || "Solicitado",
      part.requested_by,
      part.authorized_by || null,
    ];
    const partResult = await client.query(partQuery, partValues);

    await client.query("COMMIT");
    return partResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err.status
      ? err
      : {
          status: 500,
          message: "Error al solicitar repuesto",
          details: err.message,
        };
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
    throw err.status
      ? err
      : {
          status: 500,
          message: "Error al actualizar cantidad de repuesto",
          details: err.message,
        };
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
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", orderId);
      throw { status: 404, message: "Orden no encontrada" };
    }
    const technicianId = orderResult.rows[0].technician_id;
    console.log("[ORDER_SERVICE] Técnico encontrado:", technicianId);

    const adminResult = await client.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    if (!adminResult.rows.length) {
      console.error("[ORDER_SERVICE] No se encontró un usuario administrador");
      throw { status: 500, message: "No se encontró un usuario administrador" };
    }
    const adminId = adminResult.rows[0].id;
    console.log("[ORDER_SERVICE] Admin encontrado:", adminId);

    const partResult = await client.query(
      "SELECT name FROM parts WHERE id = $1",
      [partId]
    );
    if (!partResult.rows.length) {
      console.error("[ORDER_SERVICE] Repuesto no encontrado con ID:", partId);
      throw { status: 400, message: `Repuesto con ID ${partId} no encontrado` };
    }
    const partName = partResult.rows[0].name || "Repuesto desconocido";
    console.log("[ORDER_SERVICE] Nombre del repuesto:", partName);

    await notificationService.createNotification(
      {
        order_id: orderId,
        from_user_id: technicianId,
        to_user_id: adminId,
        message: `Solicitud de devolución: ${partName} (${quantity})`,
        type: "part_return",
        status: "Pendiente",
      },
      client
    );
    console.log("[ORDER_SERVICE] Notificación creada para orden:", orderId);

    await client.query("COMMIT");
    console.log(
      "[ORDER_SERVICE] Transacción completada para requestPartReturn"
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(
      "[ORDER_SERVICE] Error al solicitar devolución de repuesto:",
      err
    );
    throw err.status
      ? err
      : {
          status: 500,
          message: "Error al solicitar devolución de repuesto",
          details: err.message,
        };
  } finally {
    client.release();
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
  }
};

module.exports = {
  getOrders,
  getOrderById,
  getOrderCounts,
  createOrder,
  updateOrder,
  updateOrderStatus,
  updateOrderNumber,
  updateInvoiceNumbers,
  requestPart,
  updatePartQuantity,
  requestPartReturn,
};
