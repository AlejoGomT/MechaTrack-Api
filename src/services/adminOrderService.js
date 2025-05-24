const pool = require("../config/database");
const fs = require("fs").promises;
const path = require("path");

const updateAdminOrder = async (orderId, orderData, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verificar que la orden existe y está en estado Finalizado
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

    // Verificar que el usuario es administrador
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

    // Preparar datos para actualizar
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
    } = orderData;

    // Validar longitud de campos
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

    // Actualizar orden
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
    if (mileage !== undefined) {
      updates.push(`mileage = $${paramIndex}`);
      values.push(mileage);
      paramIndex++;
    }
    if (images !== undefined) {
      updates.push(`images = $${paramIndex}`);
      values.push(images);
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

    // Actualizar vehículo si se proporcionan vehicle_economic_number y mileage
    if (mileage && vehicle_economic_number && branch) {
      const vehicleResult = await client.query(
        "UPDATE vehicles SET mileage = $1 WHERE economic_number = $2 AND branch = $3 RETURNING *",
        [mileage, vehicle_economic_number, branch]
      );
      if (!vehicleResult.rows.length) {
        throw {
          status: 400,
          message: `Vehículo con economic_number ${vehicle_economic_number} y branch ${branch} no encontrado`,
        };
      }
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

        // Validar datos del repuesto
        if (!part_id || !quantity || !requested_by) {
          throw {
            status: 400,
            message: `Datos de repuesto inválidos: ${JSON.stringify(part)}`,
          };
        }

        // Verificar existencia del repuesto
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

        // Verificar usuarios
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

        // Validar inventario
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

        // Actualizar o insertar repuesto
        if (existingPart.rows.length) {
          await client.query(
            `
            UPDATE order_parts
            SET quantity = $1, price = $2, status = $3, requested_by = $4, authorized_by = $5, updated_at = NOW()
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
            INSERT INTO order_parts (order_id, part_id, quantity, price, status, requested_by, authorized_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
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

        // Ajustar inventario
        if (quantityChange !== 0) {
          await client.query(
            "UPDATE parts SET quantity_reserved = quantity_reserved + $1 WHERE id = $2",
            [quantityChange, part_id]
          );
        }
      }
    }

    // Obtener repuestos actualizados
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
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error en updateAdminOrder:", error);
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

    // Actualizar imágenes
    const query = `
      UPDATE orders
      SET images = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await client.query(query, [images, orderId]);
    const updatedOrder = result.rows[0];

    await client.query("COMMIT");
    return { order: updatedOrder };
  } catch (error) {
    await client.query("ROLLBACK");
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
        "uploads",
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
      "SELECT role FROM users WHERE id = $1",
      [userId]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== "admin") {
      throw {
        status: 403,
        message: "No autorizado: se requiere rol de administrador",
      };
    }

    // Validar datos del repuesto
    const { part_id, quantity, price, status, requested_by, authorized_by } =
      partData;
    if (!part_id || !quantity || !requested_by) {
      throw { status: 400, message: "Datos de repuesto inválidos" };
    }

    // Verificar repuesto
    const partResult = await client.query(
      "SELECT price, quantity, quantity_reserved, name FROM parts WHERE id = $1 FOR UPDATE",
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

    if (quantity > availableQuantity) {
      throw {
        status: 400,
        message: `Inventario insuficiente para el repuesto ${part_id}. Disponible: ${availableQuantity}, Solicitado: ${quantity}`,
      };
    }

    // Verificar usuarios
    const reqUserResult = await client.query(
      "SELECT id FROM users WHERE id = $1",
      [requested_by]
    );
    if (!reqUserResult.rows.length) {
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

    // Insertar repuesto
    const query = `
      INSERT INTO order_parts (order_id, part_id, quantity, price, status, requested_by, authorized_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      orderId,
      part_id,
      quantity,
      partPrice,
      status || "Aprobado",
      requested_by,
      authorized_by || userId,
    ];
    const result = await client.query(query, values);

    // Actualizar inventario
    await client.query(
      "UPDATE parts SET quantity_reserved = quantity_reserved + $1 WHERE id = $2",
      [quantity, part_id]
    );

    await client.query("COMMIT");

    return {
      part: {
        part_id: result.rows[0].part_id,
        name: partResult.rows[0].name,
        quantity: result.rows[0].quantity,
        price: result.rows[0].price,
        status: result.rows[0].status,
        requested_by_id: result.rows[0].requested_by,
        requested_by: reqUserResult.rows[0].first_name
          ? `${reqUserResult.rows[0].first_name} ${reqUserResult.rows[0].last_name}`
          : "Técnico",
        authorized_by_id: result.rows[0].authorized_by,
        authorized_by: authUserResult.rows[0]?.first_name
          ? `${authUserResult.rows[0].first_name} ${authUserResult.rows[0].last_name}`
          : null,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw {
      status: error.status || 500,
      message: error.message || "Error al añadir repuesto",
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
};
