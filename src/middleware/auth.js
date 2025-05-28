const jwt = require("jsonwebtoken");
const config = require("../config/config");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    console.error("[authMiddleware] Token no proporcionado");
    return res.status(401).json({ message: "Acceso denegado" });
  }
  console.log("[authMiddleware] Verificando token:", token);
  jwt.verify(token, config.jwtSecret, (err, user) => {
    if (err) {
      console.error("[authMiddleware] Error verificando token:", err.message);
      return res.status(401).json({ message: "Token inválido" });
    }
    console.log("[authMiddleware] Token verificado, usuario:", user);
    req.user = user;
    next();
  });
};
module.exports = authenticateToken;
