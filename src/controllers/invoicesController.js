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

module.exports = {
  getInvoices,
};
