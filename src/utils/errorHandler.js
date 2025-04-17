const errorHandler = (err, req, res, next) => {
  console.error("Error en el servidor:", err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Error interno del servidor",
  });
};

module.exports = errorHandler;
