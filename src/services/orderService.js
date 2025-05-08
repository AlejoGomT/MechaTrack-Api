const pool = require("../config/database");
const notificationService = require("./notificationService");

const getOrders = async (
  status,
  economicNumber,
  orderNumber,
  technician_id
) => {
  let query =
    "SELECT o.*, v.branch, v.plate, v.brand, v.model, v.year, v.mileage FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE 1=1";
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
    console.log("[ORDER_SERVICE] Órdenes obtenidas:", result.rows.length);
    return result.rows;
  } catch (err) {
    console.error("[ORDER_SERVICE] Error al obtener órdenes:", err);
    throw { status: 500, message: "Error al obtener órdenes" };
  }
};

const getOrderById = async (id) => {
  const orderResult = await pool.query(
    "SELECT o.*, v.branch, v.plate, v.brand, v.model, v.year, v.mileage FROM orders o LEFT JOIN vehicles v ON o.vehicle_economic_number = v.economic_number WHERE o.id = $1",
    [id]
  );
  if (!orderResult.rows.length) {
    console.log("[ORDER_SERVICE] Orden no encontrada para id:", id);
    return null;
  }

  const order = orderResult.rows[0];
  const historyResult = await pool.query(
    "SELECT * FROM order_history WHERE order_id = $1",
    [id]
  );
  // Modificar la consulta para incluir nombres completos de requested_by y authorized_by
  const partsResult = await pool.query(
    `
    SELECT op.*, p.name,
           req_user.first_name AS requested_by_first_name,
           req_user.last_name AS requested_by_last_name,
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
  const notificationsResult = await pool.query(
    "SELECT * FROM notifications WHERE order_id = $1",
    [id]
  );
  const invoiceResult = await pool.query(
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
      requested_by: part.requested_by_first_name
        ? `${part.requested_by_first_name} ${part.requested_by_last_name}`
        : "Técnico", // Devolver nombre completo o "Técnico" si no hay usuario
      authorized_by: part.authorized_by_first_name
        ? `${part.authorized_by_first_name} ${part.authorized_by_last_name}`
        : null, // Devolver nombre completo o null si no hay usuario
    })),
    notifications: notificationsResult.rows,
    invoice: invoiceResult.rows[0] || null,
  };
  console.log("[ORDER_SERVICE] Respuesta de getOrderById:", response);
  return response;
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

  // Validar datos de entrada
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
    // Usar nivel de aislamiento SERIALIZABLE para evitar problemas de concurrencia
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    console.log("[ORDER_SERVICE] Transacción iniciada con SERIALIZABLE");

    // Validar vehículo
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
    console.log("[ORDER_SERVICE] Vehículo validado:", vehicleResult.rows[0]);

    // Validar órdenes activas
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
    console.log("[ORDER_SERVICE] No hay órdenes activas para vehículo");

    // Generar nuevo ID usando la secuencia
    const idResult = await client.query(
      "SELECT nextval('orders_id_seq') AS new_id"
    );
    const newId = idResult.rows[0].new_id.toString().padStart(3, "0");
    console.log(
      "[ORDER_SERVICE] Nuevo order_id generado con secuencia:",
      newId
    );

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
    console.log("[ORDER_SERVICE] Valores para INSERT INTO orders:", values);
    const result = await client.query(query, values);
    const order = result.rows[0];
    console.log("[ORDER_SERVICE] Orden insertada:", order);

    // Verificar que la orden existe
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
    console.log(
      "[ORDER_SERVICE] Orden verificada en la base de datos:",
      verifyOrder.rows[0]
    );

    // Insertar repuestos si existen
    let notificationParts = [];
    if (parts && Array.isArray(parts) && parts.length > 0) {
      const partQuery = `
        INSERT INTO order_parts (
          order_id, part_id, quantity, price, status, requested_by, authorized_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      for (const part of parts) {
        // Validar datos del repuesto
        if (
          !part.part_id ||
          !part.quantity ||
          !part.requested_by ||
          !part.price
        ) {
          console.error("[ORDER_SERVICE] Datos de repuesto inválidos:", part);
          throw { status: 400, message: "Datos de repuesto inválidos" };
        }
        const partValues = [
          order.id,
          part.part_id,
          part.quantity,
          part.price,
          part.status || "Solicitado",
          part.requested_by,
          part.authorized_by || null,
        ];
        console.log(
          "[ORDER_SERVICE] Insertando repuesto con valores:",
          partValues
        );
        const partResult = await client.query(partQuery, partValues);
        console.log("[ORDER_SERVICE] Repuesto insertado:", partResult.rows[0]);

        // Obtener el nombre del repuesto para la notificación
        const partNameResult = await client.query(
          "SELECT name FROM parts WHERE id = $1",
          [part.part_id]
        );
        if (!partNameResult.rows.length) {
          console.error(
            "[ORDER_SERVICE] Repuesto no encontrado con ID:",
            part.part_id
          );
          throw {
            status: 400,
            message: `Repuesto con ID ${part.part_id} no encontrado`,
          };
        }
        const partName = partNameResult.rows[0].name || "Repuesto desconocido";
        notificationParts.push(`${partName} (${part.quantity})`);
      }
    }
    console.log("[ORDER_SERVICE] Partes para notificación:", notificationParts);

    // Crear una única notificación con todos los repuestos
    if (notificationParts.length > 0) {
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

      // Confirmar nuevamente que la orden existe antes de crear la notificación
      const confirmOrder = await client.query(
        "SELECT id FROM orders WHERE id = $1",
        [newId]
      );
      if (!confirmOrder.rows.length) {
        console.error(
          "[ORDER_SERVICE] Orden no encontrada antes de crear notificación:",
          newId
        );
        throw {
          status: 500,
          message: "Orden no encontrada antes de crear la notificación",
        };
      }
      console.log(
        "[ORDER_SERVICE] Orden confirmada antes de notificación:",
        confirmOrder.rows[0]
      );

      await notificationService.createNotification(
        {
          order_id: order.id,
          from_user_id: technician_id,
          to_user_id: adminId,
          message: `Solicitud de repuestos: ${notificationParts.join(", ")}`,
          type: "part_request",
          status: "Pendiente",
        },
        client
      );
      console.log("[ORDER_SERVICE] Notificación creada para orden:", order.id);
    }

    // Actualizar kilometraje del vehículo
    await client.query(
      "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
      [kilometraje, vehicle_economic_number, branch]
    );
    console.log(
      "[ORDER_SERVICE] Kilometraje actualizado para vehículo:",
      vehicle_economic_number
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
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
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
    console.log("[ORDER_SERVICE] Transacción iniciada para updateOrder:", id);

    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [id]
    );
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", id);
      throw { status: 404, message: "Orden no encontrada" };
    }
    console.log("[ORDER_SERVICE] Orden encontrada:", orderResult.rows[0]);

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

    // Procesar repuestos
    let notificationParts = [];
    if (parts && Array.isArray(parts) && parts.length > 0) {
      for (const part of parts) {
        if (
          !part.part_id ||
          !part.quantity ||
          !part.requested_by ||
          !part.price
        ) {
          console.error("[ORDER_SERVICE] Datos de repuesto inválidos:", part);
          throw { status: 400, message: "Datos de repuesto inválidos" };
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
              part.price,
              part.status || "Solicitado",
              part.requested_by,
              part.authorized_by || null,
              id,
              part.part_id,
            ]
          );
          console.log(
            "[ORDER_SERVICE] Repuesto actualizado para order_id:",
            id,
            "part_id:",
            part.part_id
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
              part.price,
              part.status || "Solicitado",
              part.requested_by,
              part.authorized_by || null,
            ]
          );
          console.log(
            "[ORDER_SERVICE] Repuesto insertado para order_id:",
            id,
            "part_id:",
            part.part_id
          );
        }

        const partResult = await client.query(
          "SELECT name FROM parts WHERE id = $1",
          [part.part_id]
        );
        if (!partResult.rows.length) {
          console.error(
            "[ORDER_SERVICE] Repuesto no encontrado con ID:",
            part.part_id
          );
          throw {
            status: 400,
            message: `Repuesto con ID ${part.part_id} no encontrado`,
          };
        }
        const partName = partResult.rows[0].name || "Repuesto desconocido";
        notificationParts.push(`${partName} (${part.quantity})`);
      }
    }
    console.log(
      "[ORDER_SERVICE] Partes para notificación en updateOrder:",
      notificationParts
    );

    // Crear notificaciones para nuevos repuestos
    if (notificationParts.length > 0) {
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
          message: `Solicitud de repuestos: ${notificationParts.join(", ")}`,
          type: "part_request",
          status: "Pendiente",
        },
        client
      );
      console.log(
        "[ORDER_SERVICE] Notificación creada para nuevos repuestos en orden:",
        id
      );
    }

    // Actualizar kilometraje del vehículo si se proporciona
    if (kilometraje && vehicle_economic_number && branch) {
      await client.query(
        "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3",
        [kilometraje, vehicle_economic_number, branch]
      );
      console.log(
        "[ORDER_SERVICE] Kilometraje actualizado para vehículo:",
        vehicle_economic_number
      );
    }

    // Actualizar la orden si hay cambios
    if (updates.length > 0) {
      const query = `UPDATE orders SET ${updates.join(
        ", "
      )} WHERE id = $1 RETURNING *`;
      const result = await client.query(query, values);
      console.log("[ORDER_SERVICE] Orden actualizada:", result.rows[0]);
    }

    await client.query("COMMIT");
    console.log("[ORDER_SERVICE] Orden actualizada exitosamente:", id);
    return await getOrderById(id); // Devolver la orden actualizada
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[ORDER_SERVICE] Error al actualizar orden:", err);
    throw err.status
      ? err
      : {
          status: 500,
          message: "Error al actualizar orden",
          details: err.message,
        };
  } finally {
    client.release();
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
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

    // Verificar que la orden existe
    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [id]
    );
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", id);
      throw { status: 404, message: "Orden no encontrada" };
    }
    console.log("[ORDER_SERVICE] Orden encontrada:", orderResult.rows[0]);

    // Actualizar el estado
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

    // Crear notificación si el estado es Pendiente
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

    // Verificar que la orden existe
    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [orderId]
    );
    if (!orderResult.rows.length) {
      console.error("[ORDER_SERVICE] Orden no encontrada para id:", orderId);
      throw { status: 404, message: "Orden no encontrada" };
    }

    // Verificar si ya existe un registro en invoices
    let invoiceResult = await client.query(
      "SELECT * FROM invoices WHERE order_id = $1",
      [orderId]
    );

    if (!invoiceResult.rows.length) {
      // Crear un nuevo registro en invoices si no existe
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

    // Actualizar delivery_note_number y/o invoice_number
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

    // Verificar que la orden existe
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

    // Validar datos del repuesto
    if (!part.part_id || !part.quantity || !part.requested_by || !part.price) {
      console.error("[ORDER_SERVICE] Datos de repuesto inválidos:", part);
      throw { status: 400, message: "Datos de repuesto inválidos" };
    }

    // Insertar el repuesto
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
    console.log("[ORDER_SERVICE] Insertando repuesto con valores:", partValues);
    const partResult = await client.query(partQuery, partValues);
    console.log("[ORDER_SERVICE] Repuesto insertado:", partResult.rows[0]);

    // Crear notificación para el repuesto solicitado
    const adminResult = await client.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    if (!adminResult.rows.length) {
      console.error("[ORDER_SERVICE] No se encontró un usuario administrador");
      throw { status: 500, message: "No se encontró un usuario administrador" };
    }
    const adminId = adminResult.rows[0].id;
    console.log("[ORDER_SERVICE] Admin encontrado:", adminId);

    const partNameResult = await client.query(
      "SELECT name FROM parts WHERE id = $1",
      [part.part_id]
    );
    if (!partNameResult.rows.length) {
      console.error(
        "[ORDER_SERVICE] Repuesto no encontrado con ID:",
        part.part_id
      );
      throw {
        status: 400,
        message: `Repuesto con ID ${part.part_id} no encontrado`,
      };
    }
    const partName = partNameResult.rows[0].name || "Repuesto desconocido";
    console.log("[ORDER_SERVICE] Nombre del repuesto:", partName);

    await notificationService.createNotification(
      {
        order_id: orderId,
        from_user_id: technicianId,
        to_user_id: adminId,
        message: `Solicitud de repuesto: ${partName} (${part.quantity})`,
        type: "part_request",
        status: "Pendiente",
      },
      client
    );
    console.log("[ORDER_SERVICE] Notificación creada para orden:", orderId);

    await client.query("COMMIT");
    console.log(
      "[ORDER_SERVICE] Transacción completada para requestPart:",
      orderId
    );
    return partResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[ORDER_SERVICE] Error al solicitar repuesto:", err);
    throw err.status
      ? err
      : {
          status: 500,
          message: "Error al solicitar repuesto",
          details: err.message,
        };
  } finally {
    client.release();
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
  }
};

const updatePartQuantity = async (orderId, partId, quantity) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(
      "[ORDER_SERVICE] Transacción iniciada para updatePartQuantity:",
      orderId,
      partId
    );

    if (quantity === 0) {
      await client.query(
        "DELETE FROM order_parts WHERE order_id = $1 AND part_id = $2",
        [orderId, partId]
      );
      console.log("[ORDER_SERVICE] Repuesto eliminado:", { orderId, partId });
    } else {
      await client.query(
        "UPDATE order_parts SET quantity = $1 WHERE order_id = $2 AND part_id = $3",
        [quantity, orderId, partId]
      );
      console.log("[ORDER_SERVICE] Cantidad de repuesto actualizada:", {
        orderId,
        partId,
        quantity,
      });
    }

    await client.query("COMMIT");
    console.log(
      "[ORDER_SERVICE] Transacción completada para updatePartQuantity"
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(
      "[ORDER_SERVICE] Error al actualizar cantidad de repuesto:",
      err
    );
    throw err.status
      ? err
      : {
          status: 500,
          message: "Error al actualizar cantidad de repuesto",
          details: err.message,
        };
  } finally {
    client.release();
    console.log("[ORDER_SERVICE] Cliente de base de datos liberado");
  }
};

const requestPartReturn = async (orderId, partId, quantity) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(
      "[ORDER_SERVICE] Transacción iniciada para requestPartReturn:",
      orderId,
      partId
    );

    await client.query(
      `
      UPDATE order_parts
      SET status = $1, quantity = $2
      WHERE order_id = $3 AND part_id = $4
    `,
      ["Devolución Solicitada", quantity, orderId, partId]
    );
    console.log(
      "[ORDER_SERVICE] Estado de repuesto actualizado a Devolución Solicitada:",
      { orderId, partId }
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
  createOrder,
  updateOrder,
  updateOrderStatus,
  updateOrderNumber,
  updateInvoiceNumbers,
  requestPart,
  updatePartQuantity,
  requestPartReturn,
};
