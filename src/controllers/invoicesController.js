const invoicesService = require("../services/invoicesService");

const getInvoices = async (req, res) => {
  try {
    const {
      orderNumber,
      invoiceNumber,
      deliveryNoteNumber,
      issuedBy,
      issuedAt,
      total,
      page,
      limit,
    } = req.query;

    const invoicesData = await invoicesService.getInvoices({
      orderNumber,
      invoiceNumber,
      deliveryNoteNumber,
      issuedBy,
      issuedAt,
      total,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
    });

    res.json(invoicesData);
  } catch (error) {
    console.error("[invoicesController] Error en getInvoices:", error);
    res
      .status(500)
      .json({ message: error.message || "Error al obtener facturas" });
  }
};

const editInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { invoice_number, issued_by } = req.body;

    if (!invoice_number || !issued_by) {
      return res.status(400).json({ message: "Faltan campos requeridos" });
    }

    const invoice = await invoicesService.editInvoiceNumber(orderId, {
      invoice_number,
      issued_by,
    });

    res.json(invoice);
  } catch (error) {
    console.error("[invoicesController] Error en editInvoice:", error);
    res
      .status(500)
      .json({ message: error.message || "Error al editar factura" });
  }
};

const deleteInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await invoicesService.deleteInvoice(orderId);
    res.json(result);
  } catch (error) {
    console.error("[invoicesController] Error en deleteInvoice:", error);
    res
      .status(500)
      .json({ message: error.message || "Error al eliminar factura" });
  }
};

module.exports = {
  getInvoices,
  editInvoice,
  deleteInvoice,
};
