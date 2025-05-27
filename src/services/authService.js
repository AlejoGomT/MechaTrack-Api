const bcrypt = require("bcrypt");
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
  const result = await pool.query(
    "SELECT id, first_name, last_name, role FROM users WHERE id = $1",
    [id]
  );
  const user = result.rows[0];
  if (!user) {
    throw { status: 401, message: "Usuario no encontrado" };
  }
  return user;
};

module.exports = { login, verifyToken };
