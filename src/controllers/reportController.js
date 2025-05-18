const reportService = require("../services/reportService");
const PDFDocument = require("pdfkit");
const { PassThrough } = require("stream");

// Colores basados en GlobalStyles.js
const colors = {
  primary: "#d74a49",
  primaryHover: "#ff6b6b",
  backgroundDark: "#1b4552",
  backgroundLight: "#183e4b",
  tableBorder: "#ddd",
};

const statusColors = {
  inProcess: { background: "#fae79c", text: "#B8860B" },
  pending: { background: "#B0E0E6", text: "#104E8B" },
  completed: { background: "#90EE90", text: "#228B22" },
  default: { background: "#DCDCDC", text: "#696969" },
};

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

    // Eliminar duplicados como respaldo
    const uniqueParts = report.parts
      ? Array.from(
          new Map(report.parts.map((part) => [part.part_id, part])).values()
        )
      : [];
    const uniqueNotifications = report.notifications
      ? Array.from(
          new Map(
            report.notifications.map((notification) => [
              `${notification.message}-${notification.created_at}`,
              notification,
            ])
          ).values()
        )
      : [];
    report.parts = uniqueParts;
    report.notifications = uniqueNotifications;

    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // Configuración de fuentes (Arial aproximado con Helvetica)
    doc.registerFont("Bold", "Helvetica-Bold");
    doc.registerFont("Regular", "Helvetica");

    // Función para dibujar tablas
    const drawTable = (y, headers, rows, columnWidths) => {
      const rowHeight = 20;
      const headerHeight = 25;
      const pageHeight = doc.page.height - doc.page.margins.bottom;
      let currentY = y;

      // Verificar si necesitamos una nueva página
      const checkPageBreak = (requiredHeight) => {
        if (currentY + requiredHeight > pageHeight) {
          doc.addPage();
          currentY = doc.page.margins.top;
        }
      };

      // Encabezado
      checkPageBreak(headerHeight);
      doc
        .fillColor(colors.backgroundLight)
        .rect(50, currentY, 495, headerHeight)
        .fill();
      headers.forEach((header, i) => {
        doc
          .font("Bold")
          .fontSize(10)
          .fillColor("white")
          .text(header, 55 + sumWidths(columnWidths, 0, i), currentY + 5, {
            width: columnWidths[i],
            align: "center",
          });
      });
      currentY += headerHeight;

      // Filas
      rows.forEach((row) => {
        checkPageBreak(rowHeight);
        row.forEach((cell, i) => {
          doc
            .font("Regular")
            .fontSize(10)
            .fillColor("#000000")
            .text(cell, 55 + sumWidths(columnWidths, 0, i), currentY + 5, {
              width: columnWidths[i],
              align: i === 0 ? "left" : "center",
            });
        });
        doc
          .lineWidth(0.5)
          .strokeColor(colors.tableBorder)
          .rect(50, currentY, 495, rowHeight)
          .stroke();
        currentY += rowHeight;
      });

      return currentY;
    };

    // Función auxiliar para sumar anchos de columnas
    const sumWidths = (widths, start, end) => {
      return widths.slice(start, end).reduce((sum, w) => sum + w, 0);
    };

    // Título principal
    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(20)
      .text(`Informe de Orden #${report.order_number || report.id}`, {
        align: "center",
      });
    doc.moveDown(2);

    // Sección: Detalles de la Orden
    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(14)
      .text("Detalles de la Orden", { align: "center" });
    doc.moveDown(0.5);

    const statusVariant =
      report.status === "En Proceso"
        ? "inProcess"
        : report.status === "Pendiente"
        ? "pending"
        : report.status === "Finalizado" || report.status === "Facturado"
        ? "completed"
        : "default";
    const statusStyle = statusColors[statusVariant] || statusColors.default;

    const orderDetails = [
      { label: "ID:", value: report.id },
      { label: "Número de Pedido:", value: report.order_number || "N/A" },
      {
        label: "Estado:",
        value: report.status,
        isStatus: true,
        backgroundColor: statusStyle.background,
        textColor: statusStyle.text,
      },
      { label: "Tipo:", value: report.type },
      {
        label: "Creado:",
        value: new Date(report.created_at).toLocaleDateString(),
      },
      {
        label: "Finalizado:",
        value: report.finalized_at
          ? new Date(report.finalized_at).toLocaleDateString()
          : "N/A",
      },
    ];

    let currentY = doc.y;
    orderDetails.forEach((item, index) => {
      const x = 50 + (index % 3) * 180;
      const y = currentY + Math.floor(index / 3) * 40;
      doc
        .font("Bold")
        .fontSize(10)
        .fillColor("#000000")
        .text(item.label, x, y, { width: 80 });
      if (item.isStatus) {
        doc
          .fillColor(item.backgroundColor)
          .roundedRect(x + 80, y, 90, 15, 7.5)
          .fill()
          .font("Regular")
          .fontSize(10)
          .fillColor(item.textColor)
          .text(item.value, x + 85, y + 3, { width: 80, align: "center" });
      } else {
        doc
          .font("Regular")
          .fontSize(10)
          .fillColor(colors.backgroundDark)
          .text(item.value, x + 80, y, { width: 80 });
      }
    });
    doc.y = currentY + Math.ceil(orderDetails.length / 3) * 40;
    doc.moveDown();

    doc.font("Bold").fontSize(10).text("Descripción:", 50, doc.y);
    doc
      .font("Regular")
      .fillColor(colors.backgroundDark)
      .text(report.description, 130, doc.y - 10, { width: 400 });
    doc.moveDown();
    doc.font("Bold").fontSize(10).text("Diagnóstico:", 50, doc.y);
    doc
      .font("Regular")
      .fillColor(colors.backgroundDark)
      .text(report.initial_diagnosis || "N/A", 130, doc.y - 10, { width: 400 });
    doc.moveDown();
    doc.font("Bold").fontSize(10).text("Tareas:", 50, doc.y);
    doc
      .font("Regular")
      .fillColor(colors.backgroundDark)
      .text(report.tasks || "N/A", 130, doc.y - 10, { width: 400 });
    doc.moveDown(2);

    // Sección: Vehículo
    const pageWidth = doc.page.width;
    const textWidth = doc.widthOfString("Vehículo");

    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(14)
      .text("Vehículo", (pageWidth - textWidth) / 2, doc.y);
    doc.moveDown(0.5);

    const vehicleDetails = [
      { label: "Número Económico:", value: report.economic_number },
      { label: "Marca:", value: report.brand },
      { label: "Modelo:", value: report.model },
      { label: "Año:", value: report.year },
      { label: "Sucursal:", value: report.branch },
      { label: "Placa:", value: report.plate },
      { label: "VIN:", value: report.vin },
      { label: "Kilometraje:", value: report.mileage },
    ];

    currentY = doc.y;
    vehicleDetails.forEach((item, index) => {
      const x = 50 + (index % 4) * 135;
      const y = currentY + Math.floor(index / 4) * 40;
      doc
        .font("Bold")
        .fontSize(10)
        .fillColor("#000000")
        .text(item.label, x, y, { width: 60 });
      doc
        .font("Regular")
        .fillColor(colors.backgroundDark)
        .text(item.value, x + 60, y, { width: 70 });
    });
    doc.y = currentY + Math.ceil(vehicleDetails.length / 4) * 40;
    doc.moveDown(2);

    // Sección: Facturación
    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(14)
      .text("Facturación", 50, doc.y);
    doc.moveDown(0.5);

    const billingDetails = [
      { label: "Número de Factura:", value: report.invoice_number || "N/A" },
      {
        label: "Número de Albarán:",
        value: report.delivery_note_number || "N/A",
      },
      {
        label: "Total:",
        value: report.total ? report.total.toFixed(2) : "N/A",
      },
      {
        label: "Emitido por:",
        value: report.issued_by_first_name
          ? `${report.issued_by_first_name} ${report.issued_by_last_name}`
          : "N/A",
      },
      {
        label: "Fecha de Emisión:",
        value: report.issued_at
          ? new Date(report.issued_at).toLocaleDateString()
          : "N/A",
      },
    ];

    currentY = doc.y;
    billingDetails.forEach((item, index) => {
      const x = 50 + (index % 3) * 180;
      const y = currentY + Math.floor(index / 3) * 40;
      doc
        .font("Bold")
        .fontSize(10)
        .fillColor("#000000")
        .text(item.label, x, y, { width: 80 });
      doc
        .font("Regular")
        .fillColor(colors.backgroundDark)
        .text(item.value, x + 80, y, { width: 90 });
    });
    doc.y = currentY + Math.ceil(billingDetails.length / 3) * 40;
    doc.moveDown(2);

    // Sección: Repuestos
    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(14)
      .text("Repuestos", 50, doc.y);
    doc.moveDown(0.5);

    if (report.parts && report.parts.length > 0 && report.parts[0].part_id) {
      const partHeaders = [
        "Nombre",
        "Cantidad",
        "Precio",
        "Estado",
        "Solicitado por",
        "Autorizado por",
      ];
      const partRows = report.parts.map((part) => [
        part.name,
        part.quantity.toString(),
        part.price ? part.price.toFixed(2) : "N/A",
        part.status,
        part.requested_by || "N/A",
        part.authorized_by || "N/A",
      ]);
      const partColumnWidths = [150, 60, 60, 80, 80, 80];
      currentY = drawTable(doc.y, partHeaders, partRows, partColumnWidths);
    } else {
      doc
        .font("Regular")
        .fontSize(10)
        .fillColor(colors.backgroundDark)
        .text("No hay repuestos registrados.", 50, doc.y);
      currentY = doc.y + 20;
    }
    doc.y = currentY;
    doc.moveDown(2);

    // Sección: Notificaciones
    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(14)
      .text("Notificaciones", 50, doc.y);
    doc.moveDown(0.5);

    if (
      report.notifications &&
      report.notifications.length > 0 &&
      report.notifications[0].message
    ) {
      const notificationHeaders = ["Mensaje", "Fecha", "De", "Para"];
      const notificationRows = report.notifications.map((notification) => [
        notification.message.substring(0, 50) +
          (notification.message.length > 50 ? "..." : ""),
        new Date(notification.created_at).toLocaleDateString(),
        notification.from_user || "N/A",
        notification.to_user || "N/A",
      ]);
      const notificationColumnWidths = [230, 80, 80, 80];
      currentY = drawTable(
        doc.y,
        notificationHeaders,
        notificationRows,
        notificationColumnWidths
      );
    } else {
      doc
        .font("Regular")
        .fontSize(10)
        .fillColor(colors.backgroundDark)
        .text("No hay notificaciones registradas.", 50, doc.y);
      currentY = doc.y + 20;
    }
    doc.y = currentY;
    doc.moveDown(2);

    // Sección: Historial
    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(14)
      .text("Historial", 50, doc.y);
    doc.moveDown(0.5);

    if (
      report.history &&
      report.history.length > 0 &&
      report.history[0].description
    ) {
      const historyHeaders = ["Descripción", "Fecha", "Estado"];
      const historyRows = report.history.map((entry) => [
        entry.description.substring(0, 50) +
          (entry.description.length > 50 ? "..." : ""),
        new Date(entry.date).toLocaleDateString(),
        entry.status,
      ]);
      const historyColumnWidths = [280, 80, 80];
      currentY = drawTable(
        doc.y,
        historyHeaders,
        historyRows,
        historyColumnWidths
      );
    } else {
      doc
        .font("Regular")
        .fontSize(10)
        .fillColor(colors.backgroundDark)
        .text("No hay historial registrado.", 50, doc.y);
      currentY = doc.y + 20;
    }
    doc.y = currentY;
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
