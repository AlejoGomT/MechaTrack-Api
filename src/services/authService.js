const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const config = require("../config/config");

const login = async (id, password) => {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  const user = result.rows[0];
  if (!user) {
    throw { status: 401, message: "Usuario no encontrado" };
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    throw { status: 401, message: "Contraseña incorrecta" };
  }

  const token = jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: "4h",
  });

  return {
    token,
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
    },
  };
};

const verifyToken = async (id) => {
  try {
    console.log("[authService] Buscando usuario con ID:", id);
    const result = await pool.query(
      "SELECT id, first_name, last_name, role FROM users WHERE id = $1",
      [id]
    );
    const user = result.rows[0];
    if (!user) {
      console.error("[authService] Usuario no encontrado:", id);
      throw { status: 401, message: "Usuario no encontrado" };
    }
    console.log("[authService] Usuario encontrado:", user);
    return user;
  } catch (error) {
    console.error("[authService] Error en verifyToken:", {
      message: error.message,
      stack: error.stack,
    });
    throw {
      status: error.status || 500,
      message: error.message || "Error verificando usuario",
    };
  }
};

module.exports = { login, verifyToken };
