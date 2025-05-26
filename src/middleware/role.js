const restrictTo = (...roles) => {
  return (req, res, next) => {
    console.log("[role] Roles permitidos:", roles);
    console.log("[role] req.user:", req.user);
    if (!req.user || !req.user.role) {
      console.warn(
        "[role] Acceso denegado: req.user o req.user.role no definido"
      );
      return res
        .status(403)
        .json({ message: "No tienes permiso para realizar esta acción" });
    }
    const userRole = req.user.role.trim().toLowerCase();
    const normalizedRoles = roles.map((role) => role.trim().toLowerCase());
    console.log(
      "[role] Comparando userRole:",
      userRole,
      "con roles:",
      normalizedRoles
    );
    if (!normalizedRoles.includes(userRole)) {
      console.warn("[role] Acceso denegado, rol no permitido:", userRole);
      return res
        .status(403)
        .json({ message: "No tienes permiso para realizar esta acción" });
    }
    console.log("[role] Acceso permitido, rol:", userRole);
    next();
  };
};

module.exports = { restrictTo };
