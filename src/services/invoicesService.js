const pool = require("../config/database");

const getInvoices = async ({
  orderNumber,
  invoiceNumber,
  deliveryNoteNumber,
  issuedBy,
  issuedAt,
  total,
  page = 1,
  limit = 10,
}) => {
  try {
    const offset = (page - 1) * limit;
    let query = `
      SELECT 
        i.id,
        i.order_id,
        i.invoice_number,
        i.delivery_note_number,
        i.issued_by,
        CONCAT(u.first_name, ' ', u.last_name) AS issued_by_name,
        i.issued_at,
        i.total,
        o.vehicle_economic_number,
        v.branch
      FROM invoices i
      JOIN orders o ON i.order_id = o.id
      JOIN users u ON i.issued_by = u.id
      JOIN vehicles v ON o.vehicle_economic_number = v.economic_number
      WHERE o.status = 'Facturado'
    `;
    const values = [];
    let paramIndex = 1;

    if (orderNumber) {
      query += ` AND o.id ILIKE $${paramIndex++}`;
      values.push(`%${orderNumber}%`);
    }
    if (invoiceNumber) {
      query += ` AND i.invoice_number ILIKE $${paramIndex++}`;
      values.push(`%${invoiceNumber}%`);
    }
    if (deliveryNoteNumber) {
      query += ` AND i.delivery_note_number ILIKE $${paramIndex++}`;
      values.push(`%${deliveryNoteNumber}%`);
    }
    if (issuedBy) {
      query += ` AND CONCAT(u.first_name, ' ', u.last_name) ILIKE $${paramIndex++}`;
      values.push(`%${issuedBy}%`);
    }
    if (issuedAt) {
      query += ` AND DATE(i.issued_at) = $${paramIndex++}`;
      values.push(issuedAt);
    }
    if (total) {
      query += ` AND i.total = $${paramIndex++}`;
      values.push(total);
    }

    // Agregar ordenación y paginación
    query += `
      ORDER BY i.issued_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    values.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) 
      FROM invoices i
      JOIN orders o ON i.order_id = o.id
      JOIN users u ON i.issued_by = u.id
      WHERE o.status = 'Facturado'
      ${orderNumber ? `AND o.id ILIKE $${values.length + 1}` : ""}
      ${invoiceNumber ? `AND i.invoice_number ILIKE $${values.length + 2}` : ""}
      ${
        deliveryNoteNumber
          ? `AND i.delivery_note_number ILIKE $${values.length + 3}`
          : ""
      }
      ${
        issuedBy
          ? `AND CONCAT(u.first_name, ' ', u.last_name) ILIKE $${
              values.length + 4
            }`
          : ""
      }
      ${issuedAt ? `AND DATE(i.issued_at) = $${values.length + 5}` : ""}
      ${total ? `AND i.total = $${values.length + 6}` : ""}
    `;
    const countValues = values.slice(0, values.length - 2); // Excluir limit y offset

    const [invoicesResult, countResult] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, countValues),
    ]);

    const totalRecords = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalRecords / limit);

    return {
      invoices: invoicesResult.rows,
      total: totalRecords,
      totalPages,
      currentPage: page,
    };
  } catch (error) {
    console.error("[invoicesService] Error al obtener facturas:", error);
    throw new Error("Error al obtener facturas");
  }
};

module.exports = {
  getInvoices,
};
