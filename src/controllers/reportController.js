const reportService = require("../services/reportService");
const PDFDocument = require("pdfkit");
const { PassThrough } = require("stream");

exports.getBranchReports = async (req, res) => {
  try {
    const { startDate, endDate, branch, status } = req.query;
    const reports = await reportService.getBranchReports({
      startDate,
      endDate,
      branch,
      status,
    });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getOrderReport = async (req, res) => {
  try {
    const { id } = req.params;
    const report = await reportService.getOrderReport(id);
    res.json(report);
  } catch (error) {
    res.status(error.message.includes("no encontrada") ? 404 : 500).json({
      message: error.message,
    });
  }
};

exports.getOrderReportPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const report = await reportService.getOrderReport(id);

    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // Título
    doc
      .fontSize(20)
      .fillColor("#1b4552")
      .text(`Informe de Orden #${report.order_number || report.id}`, {
        align: "center",
      });
    doc.moveDown();

    // Sección: Orden
    doc.fontSize(14).text("Detalles de la Orden", { underline: true });
    doc.fontSize(12).text(`ID: ${report.id}`);
    doc.text(`Número de Pedido: ${report.order_number || "N/A"}`);
    doc.text(`Estado: ${report.status}`);
    doc.text(`Tipo: ${report.type}`);
    doc.text(`Descripción: ${report.description}`);
    doc.text(`Diagnóstico Inicial: ${report.initial_diagnosis || "N/A"}`);
    doc.text(`Tareas: ${report.tasks || "N/A"}`);
    doc.text(`Creado: ${new Date(report.created_at).toLocaleDateString()}`);
    doc.text(
      `Finalizado: ${
        report.finalized_at
          ? new Date(report.finalized_at).toLocaleDateString()
          : "N/A"
      }`
    );
    doc.moveDown();

    // Sección: Vehículo
    doc.fontSize(14).text("Vehículo", { underline: true });
    doc.fontSize(12).text(`Número Económico: ${report.economic_number}`);
    doc.text(`Marca: ${report.brand}`);
    doc.text(`Modelo: ${report.model}`);
    doc.text(`Año: ${report.year}`);
    doc.text(`Sucursal: ${report.branch}`);
    doc.text(`Placa: ${report.plate}`);
    doc.text(`VIN: ${report.vin}`);
    doc.text(`Kilometraje: ${report.mileage}`);
    doc.moveDown();

    // Sección: Facturación
    doc.fontSize(14).text("Facturación", { underline: true });
    doc
      .fontSize(12)
      .text(`Número de Factura: ${report.invoice_number || "N/A"}`);
    doc.text(`Número de Albarán: ${report.delivery_note_number || "N/A"}`);
    doc.text(`Total: ${report.total ? report.total.toFixed(2) : "N/A"}`);
    doc.text(
      `Emitido por: ${
        report.issued_by_first_name
          ? `${report.issued_by_first_name} ${report.issued_by_last_name}`
          : "N/A"
      }`
    );
    doc.text(
      `Fecha de Emisión: ${
        report.issued_at
          ? new Date(report.issued_at).toLocaleDateString()
          : "N/A"
      }`
    );
    doc.moveDown();

    // Sección: Repuestos
    doc.fontSize(14).text("Repuestos", { underline: true });
    if (report.parts && report.parts.length > 0 && report.parts[0].part_id) {
      report.parts.forEach((part, index) => {
        doc.fontSize(12).text(`${index + 1}. ${part.name}`);
        doc.text(`   Cantidad: ${part.quantity}`);
        doc.text(`   Precio: ${part.price ? part.price.toFixed(2) : "N/A"}`);
        doc.text(`   Estado: ${part.status}`);
        doc.text(`   Solicitado por: ${part.requested_by || "N/A"}`);
        doc.text(`   Autorizado por: ${part.authorized_by || "N/A"}`);
      });
    } else {
      doc.fontSize(12).text("No hay repuestos registrados.");
    }
    doc.moveDown();

    // Finalizar documento
    doc.end();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=orden_${id}.pdf`
    );
    stream.pipe(res);
  } catch (error) {
    res.status(error.message.includes("no encontrada") ? 404 : 500).json({
      message: error.message,
    });
  }
};

exports.exportBranchReports = async (req, res) => {
  try {
    const { startDate, endDate, branch, status } = req.query;
    const reports = await reportService.getBranchReports({
      startDate,
      endDate,
      branch,
      status,
    });

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Informes por Sucursal");

    worksheet.columns = [
      { header: "Sucursal", key: "branch", width: 20 },
      { header: "Órdenes Totales", key: "total_orders", width: 15 },
      { header: "En Proceso", key: "in_process", width: 15 },
      { header: "Pendiente", key: "pending", width: 15 },
      { header: "Finalizado", key: "finalized", width: 15 },
      { header: "Pendiente de Facturación", key: "pending_billing", width: 20 },
      { header: "Facturado", key: "invoiced", width: 15 },
      { header: "Costo Repuestos", key: "total_parts_cost", width: 15 },
      { header: "Total Facturado", key: "total_invoice_amount", width: 15 },
    ];

    reports.forEach((report) => {
      worksheet.addRow(report);
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=informes_sucursales.xlsx"
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
