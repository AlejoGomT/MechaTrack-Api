const pool = require("../config/database");
const fs = require("fs").promises;
const path = require("path");

const updateAdminOrder = async (orderId, orderData, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Consultar orden sin asumir que tiene branch
    const orderResult = await client.query(
      "SELECT status, vehicle_economic_number FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    if (orderResult.rows[0].status !== "Finalizado") {
      throw { status: 400, message: "La orden no está en estado Finalizado" };
    }

    const userResult = await client.query(
      "SELECT role FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== "admin") {
      throw {
        status: 403,
        message: "No autorizado: se requiere rol de administrador",
      };
    }

    const {
      type,
      description,
      initial_diagnosis,
      tasks,
      mileage,
      parts = [],
      images = [],
      vehicle_economic_number,
      branch,
      plate,
      brand,
      model,
      year,
    } = orderData;

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
    const values = [orderId];
    let paramIndex = 2;

    if (type !== undefined) {
      updates.push(`type = $${paramIndex}`);
      values.push(type);
      paramIndex++;
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(description || null);
      paramIndex++;
    }
    if (initial_diagnosis !== undefined) {
      updates.push(`initial_diagnosis = $${paramIndex}`);
      values.push(initial_diagnosis || null);
      paramIndex++;
    }
    if (tasks !== undefined) {
      updates.push(`tasks = $${paramIndex}`);
      values.push(tasks || null);
      paramIndex++;
    }
    if (images !== undefined) {
      updates.push(`images = $${paramIndex}`);
      values.push(images);
      paramIndex++;
    }
    if (vehicle_economic_number !== undefined) {
      updates.push(`vehicle_economic_number = $${paramIndex}`);
      values.push(vehicle_economic_number || null);
      paramIndex++;
    }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

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

    // Actualizar mileage en vehicles si se proporcionaron los datos necesarios
    let vehicleData = {};
    if (mileage !== undefined && vehicle_economic_number && branch) {
      const vehicleResult = await client.query(
        "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3 RETURNING economic_number, plate, brand, model, year, mileage, branch",
        [mileage, vehicle_economic_number, branch]
      );
      if (!vehicleResult.rows.length) {
        throw {
          status: 400,
          message: `Vehículo con economic_number ${vehicle_economic_number} y branch ${branch} no encontrado`,
        };
      }
      vehicleData = vehicleResult.rows[0];
    } else if (updatedOrder.vehicle_economic_number) {
      // Consultar datos del vehículo si no se actualizó mileage
      const vehicleResult = await client.query(
        "SELECT economic_number, plate, brand, model, year, mileage, branch FROM vehicles WHERE economic_number = $1",
        [updatedOrder.vehicle_economic_number]
      );
      vehicleData = vehicleResult.rows[0] || {};
    }

    // Actualizar repuestos (order_parts)
    if (parts.length > 0) {
      for (const part of parts) {
        const {
          part_id,
          quantity,
          price,
          status = "Aprobado",
          requested_by,
          authorized_by,
        } = part;

        if (!part_id || !quantity || !requested_by) {
          throw {
            status: 400,
            message: `Datos de repuesto inválidos: ${JSON.stringify(part)}`,
          };
        }

        const partResult = await client.query(
          "SELECT price, quantity, quantity_reserved FROM parts WHERE id = $1 FOR UPDATE",
          [part_id]
        );
        if (!partResult.rows.length) {
          throw {
            status: 400,
            message: `Repuesto con ID ${part_id} no encontrado`,
          };
        }
        const partPrice = price || partResult.rows[0].price;
        const availableQuantity =
          partResult.rows[0].quantity - partResult.rows[0].quantity_reserved;

        const userResult = await client.query(
          "SELECT id FROM users WHERE id = $1",
          [requested_by]
        );
        if (!userResult.rows.length) {
          throw {
            status: 400,
            message: `Usuario con ID ${requested_by} no encontrado`,
          };
        }
        if (authorized_by) {
          const authUserResult = await client.query(
            "SELECT id FROM users WHERE id = $1",
            [authorized_by]
          );
          if (!authUserResult.rows.length) {
            throw {
              status: 400,
              message: `Usuario autorizado con ID ${authorized_by} no encontrado`,
            };
          }
        }

        const existingPart = await client.query(
          "SELECT quantity FROM order_parts WHERE order_id = $1 AND part_id = $2",
          [orderId, part_id]
        );
        const previousQuantity = existingPart.rows.length
          ? existingPart.rows[0].quantity
          : 0;
        const quantityChange = quantity - previousQuantity;

        if (quantityChange > availableQuantity) {
          throw {
            status: 400,
            message: `Inventario insuficiente para el repuesto ${part_id}. Disponible: ${availableQuantity}, Solicitado: ${quantityChange}`,
          };
        }

        if (existingPart.rows.length) {
          await client.query(
            `
            UPDATE order_parts
            SET quantity = $1, price = $2, status = $3, requested_by = $4, authorized_by = $5
            WHERE order_id = $6 AND part_id = $7
            `,
            [
              quantity,
              partPrice,
              status,
              requested_by,
              authorized_by || null,
              orderId,
              part_id,
            ]
          );
        } else {
          await client.query(
            `
            INSERT INTO order_parts (order_id, part_id, quantity, price, status, requested_by, authorized_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            [
              orderId,
              part_id,
              quantity,
              partPrice,
              status,
              requested_by,
              authorized_by || userId,
            ]
          );
        }

        if (quantityChange !== 0) {
          await client.query(
            "UPDATE parts SET quantity_reserved = quantity_reserved + $1 WHERE id = $2",
            [quantityChange, part_id]
          );
        }
      }
    }

    const partsResult = await client.query(
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
      WHERE op.order_id = $1
      `,
      [orderId]
    );

    await client.query("COMMIT");

    return {
      ...updatedOrder,
      parts: partsResult.rows.map((part) => ({
        part_id: part.part_id,
        name: part.name,
        quantity: part.quantity,
        price: part.price,
        status: part.status,
        requested_by_id: part.requested_by,
        requested_by: part.requested_by_first_name
          ? `${part.requested_by_first_name} ${part.requested_by_last_name}`
          : "Técnico",
        authorized_by_id: part.authorized_by,
        authorized_by: part.authorized_by_first_name
          ? `${part.authorized_by_first_name} ${part.authorized_by_last_name}`
          : null,
      })),
      images,
      vehicle_economic_number:
        updatedOrder.vehicle_economic_number || vehicleData.economic_number,
      plate: vehicleData.plate,
      brand: vehicleData.brand,
      model: vehicleData.model,
      year: vehicleData.year,
      branch: vehicleData.branch,
      mileage: vehicleData.mileage,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[updateAdminOrder] Error:", error);
    throw {
      status: error.status || 500,
      message: error.message || "Error al actualizar la orden",
      details: error.details || error.message,
    };
  } finally {
    client.release();
  }
};

const addAdminImages = async (orderId, { images }, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verificar orden y estado
    const orderResult = await client.query(
      "SELECT status, images FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    if (orderResult.rows[0].status !== "Finalizado") {
      throw { status: 400, message: "La orden no está en estado Finalizado" };
    }

    // Verificar administrador
    const userResult = await client.query(
      "SELECT role FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== "admin") {
      throw {
        status: 403,
        message: "No autorizado: se requiere rol de administrador",
      };
    }

    // Validar imágenes
    if (
      !Array.isArray(images) ||
      images.some((img) => typeof img !== "string")
    ) {
      throw { status: 400, message: "El formato de las imágenes es inválido" };
    }

    // Actualizar imágenes
    const query = `
      UPDATE orders
      SET images = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    console.log("[addAdminImages] Imágenes a guardar en DB:", images);
    const result = await client.query(query, [images, orderId]);
    const updatedOrder = result.rows[0];

    console.log("[addAdminImages] Orden actualizada:", updatedOrder);

    await client.query("COMMIT");
    return { order: updatedOrder };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[addAdminImages] Error en servicio:", error);
    throw {
      status: error.status || 500,
      message: error.message || "Error al añadir imágenes",
      details: error.details || error.message,
    };
  } finally {
    client.release();
  }
};

const deleteAdminImage = async (orderId, imageIndex, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      "SELECT status, images FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    if (orderResult.rows[0].status !== "Finalizado") {
      throw { status: 400, message: "La orden no está en estado Finalizado" };
    }
    const currentImages = orderResult.rows[0].images || [];
    if (!currentImages[imageIndex]) {
      throw { status: 400, message: "Índice de imagen inválido" };
    }

    const userResult = await client.query(
      "SELECT role FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== "admin") {
      throw {
        status: 403,
        message: "No autorizado: se requiere rol de administrador",
      };
    }

    // Eliminar imagen del sistema de archivos
    const imagePath = currentImages[imageIndex];
    if (imagePath.startsWith("/Uploads/")) {
      const filePath = path.resolve(
        __dirname,
        "..",
        "..",
        "Uploads",
        path.basename(imagePath)
      );
      try {
        await fs.unlink(filePath);
        console.log(
          "[adminOrderService] Imagen eliminada del sistema de archivos:",
          filePath
        );
      } catch (err) {
        if (err.code === "ENOENT") {
          console.warn("[adminOrderService] Archivo no encontrado:", filePath);
        } else {
          console.error("[adminOrderService] Error al eliminar archivo:", err);
        }
      }
    }

    const updatedImages = currentImages.filter(
      (_, index) => index !== imageIndex
    );
    const query = `
      UPDATE orders
      SET images = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await client.query(query, [updatedImages, orderId]);
    const updatedOrder = result.rows[0];

    await client.query("COMMIT");
    return { order: updatedOrder };
  } catch (error) {
    await client.query("ROLLBACK");
    throw {
      status: error.status || 500,
      message: error.message || "Error al eliminar imagen",
      details: error.details || error.message,
    };
  } finally {
    client.release();
  }
};

const addAdminPart = async (orderId, partData, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verificar orden
    const orderResult = await client.query(
      "SELECT status FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    if (orderResult.rows[0].status !== "Finalizado") {
      throw { status: 400, message: "La orden no está en estado Finalizado" };
    }

    // Verificar administrador
    const userResult = await client.query(
      "SELECT role, first_name, last_name FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== "admin") {
      throw {
        status: 403,
        message: "No autorizado: se requiere rol de administrador",
      };
    }

    // Validar datos del repuesto
    const { part_id, quantity, price } = partData;
    if (!part_id || !quantity) {
      throw {
        status: 400,
        message: "Faltan datos del repuesto (part_id, quantity)",
      };
    }
    if (quantity <= 0) {
      throw { status: 400, message: "La cantidad debe ser mayor que cero" };
    }

    // Verificar repuesto
    const partResult = await client.query(
      "SELECT id, name, quantity, price FROM parts WHERE id = $1 FOR UPDATE",
      [part_id]
    );
    if (!partResult.rows.length) {
      throw {
        status: 400,
        message: `Repuesto con ID ${part_id} no encontrado`,
      };
    }
    const part = partResult.rows[0];
    if (quantity > part.quantity) {
      throw {
        status: 400,
        message: `Inventario insuficiente para el repuesto ${part_id}. Disponible: ${part.quantity}, Solicitado: ${quantity}`,
      };
    }

    // Usar el precio proporcionado o el precio del repuesto
    const finalPrice = price !== undefined ? price : part.price;

    // Insertar en order_parts con estado Aprobado
    const insertQuery = `
      INSERT INTO order_parts (order_id, part_id, quantity, price, status, requested_by, authorized_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const insertValues = [
      orderId,
      part_id,
      quantity,
      finalPrice,
      "Aprobado",
      userId,
      userId,
    ];
    const orderPartResult = await client.query(insertQuery, insertValues);

    // Actualizar solo quantity en parts
    await client.query(
      "UPDATE parts SET quantity = GREATEST(quantity - $1, 0) WHERE id = $2",
      [quantity, part_id]
    );

    // Obtener datos completos del repuesto
    const partDetails = await client.query(
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
      WHERE op.order_id = $1 AND op.part_id = $2
      `,
      [orderId, part_id]
    );

    await client.query("COMMIT");

    const newPart = partDetails.rows[0];
    return {
      part: {
        part_id: newPart.part_id,
        name: newPart.name,
        quantity: newPart.quantity,
        price: newPart.price,
        status: newPart.status,
        requested_by_id: newPart.requested_by,
        requested_by: newPart.requested_by_first_name
          ? `${newPart.requested_by_first_name} ${newPart.requested_by_last_name}`
          : "Administrador",
        authorized_by_id: newPart.authorized_by,
        authorized_by: newPart.authorized_by_first_name
          ? `${newPart.authorized_by_first_name} ${newPart.authorized_by_last_name}`
          : "Administrador",
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[addAdminPart] Error:", error);
    throw {
      status: error.status || 500,
      message: error.message || "Error al añadir repuesto",
      details: error.details || error.message,
    };
  } finally {
    client.release();
  }
};

const editAdminPart = async (orderId, partId, partData, userId) => {
  const { quantity, price } = partData;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verificar orden finalizada
    const orderResult = await client.query(
      "SELECT status FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    if (orderResult.rows[0].status !== "Finalizado") {
      throw { status: 400, message: "La orden no está en estado Finalizado" };
    }

    // Verificar administrador
    const userResult = await client.query(
      "SELECT role FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== "admin") {
      throw {
        status: 403,
        message: "No autorizado: se requiere rol de administrador",
      };
    }

    // Obtener datos actuales del repuesto
    const currentPart = await client.query(
      "SELECT quantity FROM order_parts WHERE order_id = $1 AND part_id = $2 FOR UPDATE",
      [orderId, partId]
    );
    if (currentPart.rows.length === 0) {
      throw { status: 404, message: "Repuesto no encontrado en la orden" };
    }
    const currentQuantity = currentPart.rows[0].quantity;

    // Validar cantidad
    if (quantity < 0) {
      throw { status: 400, message: "La cantidad no puede ser negativa" };
    }
    if (price < 0) {
      throw { status: 400, message: "El precio no puede ser negativo" };
    }

    // Calcular cambio en cantidad
    const quantityChange = quantity - currentQuantity;

    // Verificar inventario disponible si quantity aumenta
    if (quantityChange > 0) {
      const partInventory = await client.query(
        "SELECT quantity, quantity_reserved FROM parts WHERE id = $1 FOR UPDATE",
        [partId]
      );
      if (partInventory.rows.length === 0) {
        throw { status: 404, message: "Repuesto no encontrado en inventario" };
      }
      const availableQuantity =
        partInventory.rows[0].quantity -
        partInventory.rows[0].quantity_reserved;
      if (quantityChange > availableQuantity) {
        throw {
          status: 400,
          message: `Inventario insuficiente. Disponible: ${availableQuantity}, Solicitado: ${quantityChange}`,
        };
      }
    }

    // Actualizar order_parts
    await client.query(
      "UPDATE order_parts SET quantity = $1, price = $2 WHERE order_id = $3 AND part_id = $4",
      [quantity, price, orderId, partId]
    );

    // Ajustar quantity en parts
    if (quantityChange !== 0) {
      await client.query(
        "UPDATE parts SET quantity = quantity - $1 WHERE id = $2",
        [quantityChange, partId]
      );
    }

    await client.query("COMMIT");

    return { message: "Repuesto actualizado correctamente" };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[editAdminPart] Error:", error);
    throw {
      status: error.status || 500,
      message: error.message || "Error al actualizar repuesto",
      details: error.details || error.message,
    };
  } finally {
    client.release();
  }
};

const deleteAdminPart = async (orderId, partId, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verificar orden finalizada
    const orderResult = await client.query(
      "SELECT status FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw { status: 404, message: "Orden no encontrada" };
    }
    if (orderResult.rows[0].status !== "Finalizado") {
      throw { status: 400, message: "La orden no está en estado Finalizado" };
    }

    // Verificar administrador
    const userResult = await client.query(
      "SELECT role FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== "admin") {
      throw {
        status: 403,
        message: "No autorizado: se requiere rol de administrador",
      };
    }

    // Obtener cantidad actual del repuesto
    const currentPart = await client.query(
      "SELECT quantity FROM order_parts WHERE order_id = $1 AND part_id = $2 FOR UPDATE",
      [orderId, partId]
    );
    if (currentPart.rows.length === 0) {
      throw { status: 404, message: "Repuesto no encontrado en la orden" };
    }
    const quantity = currentPart.rows[0].quantity;

    // Eliminar de order_parts
    await client.query(
      "DELETE FROM order_parts WHERE order_id = $1 AND part_id = $2",
      [orderId, partId]
    );

    // Restaurar quantity en parts
    await client.query(
      "UPDATE parts SET quantity = quantity + $1 WHERE id = $2",
      [quantity, partId]
    );

    await client.query("COMMIT");

    return { message: "Repuesto eliminado correctamente" };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[deleteAdminPart] Error:", error);
    throw {
      status: error.status || 500,
      message: error.message || "Error al eliminar repuesto",
      details: error.details || error.message,
    };
  } finally {
    client.release();
  }
};

module.exports = {
  updateAdminOrder,
  addAdminImages,
  deleteAdminImage,
  addAdminPart,
  editAdminPart,
  deleteAdminPart,
};
