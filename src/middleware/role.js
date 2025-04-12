const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "No tienes permiso para realizar esta acción" });
    }
    next();
  };
};

module.exports = { restrictTo };
