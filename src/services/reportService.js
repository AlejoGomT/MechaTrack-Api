const pool = require("../config/database");

exports.getBranchReports = async ({ startDate, endDate, branch, status }) => {
  try {
    let query = `
      SELECT 
          v.branch,
          COUNT(o.id) AS total_orders,
          SUM(CASE WHEN o.status = 'En Proceso' THEN 1 ELSE 0 END) AS in_process,
          SUM(CASE WHEN o.status = 'Pendiente' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN o.status = 'Finalizado' THEN 1 ELSE 0 END) AS finalized,
          SUM(CASE WHEN o.status = 'Pendiente de Facturación' THEN 1 ELSE 0 END) AS pending_billing,
          SUM(CASE WHEN o.status = 'Facturado' THEN 1 ELSE 0 END) AS invoiced,
          COALESCE(SUM(op.price * op.quantity), 0) AS total_parts_cost,
          COALESCE(SUM(i.total), 0) AS total_invoice_amount
      FROM vehicles v
      JOIN orders o ON v.economic_number = o.vehicle_economic_number
      LEFT JOIN order_parts op ON o.id = op.order_id AND op.status = 'Aprobado'
      LEFT JOIN invoices i ON o.id = i.order_id
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (startDate && endDate) {
      query += ` AND o.created_at BETWEEN $${paramIndex} AND $${
        paramIndex + 1
      }`;
      values.push(startDate, endDate);
      paramIndex += 2;
    }
    if (branch) {
      query += ` AND v.branch = $${paramIndex}`;
      values.push(branch);
      paramIndex++;
    }
    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      values.push(status);
    }
    query += ` GROUP BY v.branch`;

    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    throw new Error(`Error al obtener informes por sucursal: ${error.message}`);
  }
};

exports.getOrdersReport = async ({
  startDate,
  endDate,
  branch,
  status,
  orderNumber,
  economicNumber,
}) => {
  try {
    let query = `
      SELECT 
        o.id,
        o.order_number,
        o.status,
        o.vehicle_economic_number,
        v.branch
      FROM orders o
      JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (startDate && endDate) {
      query += ` AND o.created_at BETWEEN $${paramIndex} AND $${
        paramIndex + 1
      }`;
      values.push(startDate, endDate);
      paramIndex += 2;
    }
    if (branch) {
      query += ` AND v.branch = $${paramIndex}`;
      values.push(branch);
      paramIndex++;
    }
    if (status) {
      query += ` AND o.status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }
    if (orderNumber) {
      query += ` AND o.order_number ILIKE $${paramIndex}`;
      values.push(`%${orderNumber}%`);
      paramIndex++;
    }
    if (economicNumber) {
      query += ` AND o.vehicle_economic_number ILIKE $${paramIndex}`;
      values.push(`%${economicNumber}%`);
      paramIndex++;
    }

    query += " ORDER BY o.id DESC";

    console.log("[getOrdersReport] Query:", query, "Values:", values);
    const result = await pool.query(query, values);
    console.log("[getOrdersReport] Órdenes devueltas:", result.rows.length);
    return result.rows;
  } catch (error) {
    console.error("[getOrdersReport] Error:", error);
    throw new Error(`Error al obtener informe de órdenes: ${error.message}`);
  }
};

exports.getPartsReport = async ({
  startDate,
  endDate,
  branch,
  status,
  orderNumber,
  economicNumber,
}) => {
  try {
    let query = `
      SELECT 
          op.name, 
          op.quantity, 
          op.price, 
          op.status, 
          o.id AS order_id, 
          v.branch
      FROM orders o
      JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
      JOIN order_parts op ON o.id = op.order_id
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (startDate && endDate !== undefined && startDate !== "") {
      query += ` AND o.created_at BETWEEN $${paramIndex} AND $${
        paramIndex + 1
      }`;
      values.push(startDate, endDate);
      paramIndex += 2;
    }
    if (branch !== undefined && branch !== "") {
      query += ` AND v.branch = $${paramIndex}`;
      values.push(branch);
      paramIndex++;
    }
    if (status !== undefined && status !== "") {
      query += ` AND o.status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }
    if (orderNumber !== undefined && orderNumber !== "") {
      query += ` AND o.order_number ILIKE $${paramIndex}`;
      values.push(`%${orderNumber}%`);
      paramIndex++;
    }
    if (economicNumber !== undefined && economicNumber !== "") {
      query += ` AND o.vehicle_economic_number ILIKE $${paramIndex}`;
      values.push(`%${economicNumber}%`);
      paramIndex++;
    }

    query += " ORDER BY o.id DESC";

    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    throw new Error(`Error al obtener informe de repuestos: ${error.message}`);
  }
};

exports.getOrderReport = async (orderId) => {
  try {
    const query = `
      SELECT 
          o.id, o.order_number, o.status, o.type, o.description, o.initial_diagnosis, o.tasks, o.images, o.created_at, o.finalized_at, o.updated_at,
          v.economic_number, v.brand, v.model, v.year, v.mileage, v.vin, v.branch, v.plate,
          i.invoice_number, i.delivery_note_number, i.total, i.issued_at, 
          ui.first_name AS issued_by_first_name, ui.last_name AS issued_by_last_name,
          u.first_name AS technician_first_name, u.last_name AS technician_last_name,
          COALESCE((
            SELECT json_agg(
              json_build_object(
                  'part_id', op.part_id,
                  'name', op.name,
                  'quantity', op.quantity,
                  'price', op.price,
                  'status', op.status,
                  'requested_by', op.requested_by_name,
                  'authorized_by', op.authorized_by_name
              )
            )
            FROM (
              SELECT DISTINCT 
                op.part_id, 
                p.name, 
                op.quantity, 
                op.price, 
                op.status, 
                (ur.first_name || ' ' || ur.last_name) AS requested_by_name,
                (ua.first_name || ' ' || ua.last_name) AS authorized_by_name
              FROM order_parts op
              JOIN parts p ON op.part_id = p.id
              LEFT JOIN users ur ON op.requested_by = ur.id
              LEFT JOIN users ua ON op.authorized_by = ua.id
              WHERE op.order_id = $1
            ) op
          ), '[]') AS parts,
          COALESCE((
            SELECT json_agg(
              json_build_object(
                  'message', n.message,
                  'type', n.type,
                  'created_at', n.created_at,
                  'from_user', n.from_user_name,
                  'to_user', n.to_user_name,
                  'attachments', (
                    SELECT json_agg(na.file_path)
                    FROM notification_attachments na
                    WHERE na.notification_id = n.id
                  )
              )
            )
            FROM (
              SELECT DISTINCT ON (n.id)
                n.id, 
                n.message, 
                n.type, 
                n.created_at, 
                (uf.first_name || ' ' || uf.last_name) AS from_user_name,
                (ut.first_name || ' ' || ut.last_name) AS to_user_name
              FROM notifications n
              LEFT JOIN users uf ON n.from_user_id = uf.id
              LEFT JOIN users ut ON n.to_user_id = ut.id
              WHERE n.order_id = $1
            ) n
          ), '[]') AS notifications,
          COALESCE((
            SELECT json_agg(
              json_build_object(
                  'description', oh.description,
                  'date', oh.date,
                  'status', oh.status
              )
            )
            FROM (
              SELECT DISTINCT 
                oh.description, 
                oh.date, 
                oh.status
              FROM order_history oh
              WHERE oh.order_id = $1
            ) oh
          ), '[]') AS history
      FROM orders o
      JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
      JOIN users u ON o.technician_id = u.id
      LEFT JOIN invoices i ON o.id = i.order_id
      LEFT JOIN users ui ON i.issued_by = ui.id
      WHERE o.id = $1
    `;
    const result = await pool.query(query, [orderId]);
    if (result.rows.length === 0) {
      throw new Error("Orden no encontrada");
    }
    return result.rows[0];
  } catch (error) {
    throw new Error(`Error al obtener informe de orden: ${error.message}`);
  }
};
