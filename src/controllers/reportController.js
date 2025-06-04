const reportService = require("../services/reportService");
const PDFDocument = require("pdfkit");
const XMLBuilder = require("xmlbuilder");
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

exports.getOrdersReportPdf = async (req, res) => {
  try {
    const { startDate, endDate, branch, status, orderNumber, economicNumber } =
      req.query;

    const orders = await reportService.getOrdersReport({
      startDate,
      endDate,
      branch,
      status,
      orderNumber,
      economicNumber,
    });

    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();
    doc.pipe(stream);

    doc.registerFont("Bold", "Helvetica-Bold");
    doc.registerFont("Regular", "Helvetica");

    doc.on("error", (err) => {
      console.error("[getOrdersReportPdf] Error en PDFDocument:", err);
      res.status(500).end();
    });

    // Función para dibujar tablas
    const drawTable = (y, headers, rows, columnWidths) => {
      const rowHeight = 20;
      const headerHeight = 25;
      const pageHeight = doc.page.height - doc.page.margins.bottom;
      let currentY = y;

      const checkPageBreak = (requiredHeight) => {
        if (currentY + requiredHeight > pageHeight) {
          doc.addPage();
          currentY = doc.page.margins.top;
        }
      };

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

      rows.forEach((row) => {
        checkPageBreak(rowHeight);
        row.forEach((cell, i) => {
          doc
            .font("Regular")
            .fontSize(10)
            .fillColor("#000000")
            .text(cell, 55 + sumWidths(columnWidths, 0, i), currentY + 3, {
              width: columnWidths[i],
              height: rowHeight - 5,
              align: i === 0 ? "left" : "center",
              ellipsis: true,
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

    const sumWidths = (widths, start, end) => {
      return widths.slice(start, end).reduce((sum, w) => sum + w, 0);
    };

    if (orders.length === 0) {
      doc
        .font("Regular")
        .fontSize(10)
        .fillColor(colors.backgroundDark)
        .text(
          "No se encontraron órdenes con los filtros aplicados.",
          50,
          doc.y
        );
      doc.end();
      return;
    }

    // Procesar cada orden
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const report = await reportService.getOrderReport(order.id);

      // Eliminar duplicados en partes
      const uniqueParts = report.parts
        ? Array.from(
            new Map(report.parts.map((part) => [part.part_id, part])).values()
          )
        : [];
      report.parts = uniqueParts;

      if (i > 0) {
        doc.addPage();
      }

      // Título de la orden
      doc
        .fillColor(colors.backgroundDark)
        .font("Bold")
        .fontSize(20)
        .text(`Informe de Orden #${report.order_number || report.id}`, {
          align: "center",
        });
      doc.moveDown(2);

      // Detalles de la Orden
      doc
        .fillColor(colors.backgroundDark)
        .font("Bold")
        .fontSize(14)
        .text("Detalles de la Orden", 50, doc.y);
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
        .text(report.initial_diagnosis || "N/A", 130, doc.y - 10, {
          width: 400,
        });
      doc.moveDown();
      doc.font("Bold").fontSize(10).text("Tareas:", 50, doc.y);
      doc
        .font("Regular")
        .fillColor(colors.backgroundDark)
        .text(report.tasks || "N/A", 130, doc.y - 10, { width: 400 });
      doc.moveDown(2);

      // Vehículo
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
          .fontSize(10)
          .fillColor(colors.backgroundDark)
          .text(item.value, x + 60, y, { width: 70 });
      });
      doc.y = currentY + Math.ceil(vehicleDetails.length / 4) * 40;
      doc.moveDown(2);

      // Facturación
      doc
        .fillColor(colors.backgroundDark)
        .font("Bold")
        .fontSize(14)
        .text("Facturación", 50, doc.y);
      doc.moveDown(0.5);

      const calculateSubtotal = () => {
        return uniqueParts
          .filter((part) => part.status === "Aprobado")
          .reduce((sum, part) => sum + part.quantity * (part.price || 0), 0)
          .toFixed(2);
      };

      const IVA_RATE = 0.16;
      const subtotal = parseFloat(calculateSubtotal());
      const iva = (subtotal * IVA_RATE).toFixed(2);
      const totalWithIva = (subtotal + parseFloat(iva)).toFixed(2);

      const billingDetails = [
        { label: "Número de Factura:", value: report.invoice_number || "N/A" },
        {
          label: "Número de Albarán:",
          value: report.delivery_note_number || "N/A",
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
        { label: "Subtotal:", value: `$${subtotal}` },
        { label: "IVA 16%:", value: `$${iva}` },
        { label: "Total + IVA:", value: `$${totalWithIva}` },
      ];

      currentY = doc.y;
      billingDetails.forEach((item, index) => {
        const x = 50 + (index % 4) * 135;
        const y = currentY + Math.floor(index / 4) * 40;
        doc
          .font("Bold")
          .fontSize(10)
          .fillColor("#000000")
          .text(item.label, x, y, { width: 80 });
        doc
          .font("Regular")
          .fontSize(10)
          .fillColor(colors.backgroundDark)
          .text(item.value, x + 80, y, { width: 90 });
      });
      doc.y = currentY + Math.ceil(billingDetails.length / 4) * 40;
      doc.moveDown(2);

      // Repuestos
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
          part.price ? part.price : "N/A",
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

      // Historial
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
    }

    doc.end();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=informe_ordenes.pdf"
    );
    stream.pipe(res);
  } catch (error) {
    console.error("[getOrdersReportPdf] Error:", error);
    res
      .status(500)
      .json({ message: `Error al generar el PDF: ${error.message}` });
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
    report.parts = uniqueParts;

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
            .text(cell, 55 + sumWidths(columnWidths, 0, i), currentY + 3, {
              width: columnWidths[i],
              height: rowHeight - 5,
              align: i === 0 ? "left" : "center",
              ellipsis: true,
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
      .text("Detalles de la Orden", 50, doc.y);
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
        .fontSize(10)
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

    const calculateSubtotal = () => {
      return uniqueParts
        .filter((part) => part.status === "Aprobado")
        .reduce((sum, part) => sum + part.quantity * (part.price || 0), 0)
        .toFixed(2);
    };

    const IVA_RATE = 0.16;
    const subtotal = parseFloat(calculateSubtotal());
    const iva = (subtotal * IVA_RATE).toFixed(2);
    const totalWithIva = (subtotal + parseFloat(iva)).toFixed(2);

    const billingDetails = [
      { label: "Número de Factura:", value: report.invoice_number || "N/A" },
      {
        label: "Número de Albarán:",
        value: report.delivery_note_number || "N/A",
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
      { label: "Subtotal:", value: `$${subtotal}` },
      { label: "IVA 16%:", value: `$${iva}` },
      { label: "Total + IVA:", value: `$${totalWithIva}` },
    ];

    currentY = doc.y;
    billingDetails.forEach((item, index) => {
      const x = 50 + (index % 4) * 135;
      const y = currentY + Math.floor(index / 4) * 40;
      doc
        .font("Bold")
        .fontSize(10)
        .fillColor("#000000")
        .text(item.label, x, y, { width: 80 });
      doc
        .font("Regular")
        .fontSize(10)
        .fillColor(colors.backgroundDark)
        .text(item.value, x + 80, y, { width: 90 });
    });
    doc.y = currentY + Math.ceil(billingDetails.length / 4) * 40;
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
        part.price ? part.price : "N/A",
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

exports.getPartsReport = async (req, res) => {
  try {
    const { branch, partName } = req.query;
    const reports = await reportService.getPartsReport({ branch, partName });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranches = async (req, res) => {
  try {
    const branches = await reportService.getBranches();
    res.json(branches.map((branch) => ({ value: branch, label: branch })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getPartsReportPdf = async (req, res) => {
  try {
    const { branch, partName } = req.query;
    const reports = await reportService.getPartsReport({ branch, partName });

    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();
    doc.pipe(stream);

    doc.registerFont("Bold", "Helvetica-Bold");
    doc.registerFont("Regular", "Helvetica");

    // Manejo de errores en el documento
    doc.on("error", (err) => {
      console.error("[getPartsReportPdf] Error en PDFDocument:", err);
      res.status(500).json({ message: "Error al generar el PDF" });
    });

    // Función para dibujar tablas
    const drawTable = (y, headers, rows, columnWidths) => {
      const rowHeight = 20;
      const headerHeight = 25;
      const pageHeight = doc.page.height - doc.page.margins.bottom; // Corrección: doc.page.height
      let currentY = y;

      const checkPageBreak = (requiredHeight) => {
        if (currentY + requiredHeight > pageHeight) {
          doc.addPage();
          currentY = doc.page.margins.top;
        }
      };

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

      rows.forEach((row) => {
        checkPageBreak(rowHeight);
        row.forEach((cell, i) => {
          doc
            .font("Regular")
            .fontSize(10)
            .fillColor("#000000")
            .text(cell, 55 + sumWidths(columnWidths, 0, i), currentY + 3, {
              width: columnWidths[i],
              height: rowHeight - 5,
              align: i === 0 ? "left" : "center",
              ellipsis: true,
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

    const sumWidths = (widths, start, end) =>
      widths.slice(start, end).reduce((sum, w) => sum + w, 0);

    // Título del informe
    doc
      .fillColor(colors.backgroundDark)
      .font("Bold")
      .fontSize(20)
      .text("Informe de Repuestos por Sucursal", { align: "center" });
    doc.moveDown(2);

    // Filtros aplicados
    doc
      .font("Regular")
      .fontSize(10)
      .fillColor(colors.backgroundDark)
      .text(`Sucursal: ${branch || "Todas"}`, 50, doc.y);
    doc
      .font("Regular")
      .fontSize(10)
      .fillColor(colors.backgroundDark)
      .text(`Repuesto: ${partName || "Todos"}`, 50, doc.y);
    doc.moveDown(2);

    if (reports.length === 0) {
      doc
        .font("Regular")
        .fontSize(10)
        .fillColor(colors.backgroundDark)
        .text("No se encontraron datos con los filtros aplicados.", 50, doc.y);
      doc.end();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=informe_repuestos.pdf"
      );
      stream.pipe(res);
      return;
    }

    let currentY = doc.y;
    reports.forEach((report, index) => {
      if (
        index > 0 &&
        currentY + 50 > doc.page.height - doc.page.margins.bottom
      ) {
        doc.addPage();
        currentY = doc.page.margins.top;
      }

      doc
        .fillColor(colors.backgroundDark)
        .font("Bold")
        .fontSize(14)
        .text(`Sucursal: ${report.branch}`, 50, currentY);
      currentY += 20;

      const headers = ["Repuesto", "Cantidad", "Vehículos"];
      const rows = [
        [
          report.part_name,
          report.total_quantity.toString(),
          report.vehicles
            .map((v) => `${v.economic_number} (${v.brand} ${v.model})`)
            .join(", ") || "N/A",
        ],
      ];
      const columnWidths = [200, 100, 195];
      currentY = drawTable(currentY, headers, rows, columnWidths);
      currentY += 20;
    });

    doc.end();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=informe_repuestos.pdf"
    );
    stream.pipe(res);
  } catch (error) {
    console.error("[getPartsReportPdf] Error:", error);
    res
      .status(500)
      .json({ message: `Error al generar el PDF: ${error.message}` });
  }
};

exports.getPartsReportXml = async (req, res) => {
  try {
    const { branch, partName } = req.query;
    const reports = await reportService.getPartsReport({ branch, partName });

    const xml = XMLBuilder.create("PartsReport");
    reports.forEach((report) => {
      const branchNode = xml.ele("Branch", { name: report.branch });
      const partNode = branchNode.ele("Part");
      partNode.ele("Name", report.part_name);
      partNode.ele("Quantity", report.total_quantity);
      const vehiclesNode = partNode.ele("Vehicles");
      report.vehicles.forEach((vehicle) => {
        const vehicleNode = vehiclesNode.ele("Vehicle");
        vehicleNode.ele("EconomicNumber", vehicle.economic_number);
        vehicleNode.ele("Brand", vehicle.brand);
        vehicleNode.ele("Model", vehicle.model);
      });
    });

    const xmlString = xml.end({ pretty: true });
    res.setHeader("Content-Type", "application/xml");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=informe_repuestos.xml"
    );
    res.send(xmlString);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Error al generar el XML: ${error.message}` });
  }
};
