const pool = require("../config/database");
const bcrypt = require("bcrypt");

const generateUserId = async () => {
  const result = await pool.query(
    "SELECT id FROM users ORDER BY id DESC LIMIT 1"
  );
  if (result.rows.length === 0) {
    return "U001";
  }
  const lastId = result.rows[0].id;
  const number = parseInt(lastId.slice(1)) + 1;
  return `U${number.toString().padStart(3, "0")}`;
};

const getUsers = async ({
  userId,
  name,
  role,
  page = 1,
  limit = 20,
  excludeAdmin = false,
}) => {
  try {
    let query =
      "SELECT id, first_name, last_name, email, role FROM users WHERE 1=1";
    const values = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND id = $${paramIndex}`;
      values.push(userId);
      paramIndex++;
    }
    if (name && name.trim()) {
      query += ` AND (first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex})`;
      values.push(`%${name.trim()}%`);
      paramIndex++;
    }
    if (role && role.trim()) {
      const roles = role.split(",");
      query += ` AND role = ANY($${paramIndex})`;
      values.push(roles);
      paramIndex++;
    }
    if (excludeAdmin) {
      query += ` AND role != 'admin'`;
    }

    const countValues = [...values];
    const offset = (page - 1) * limit;
    query += ` ORDER BY id ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(limit, offset);
    const countQuery = query
      .replace(
        "SELECT id, first_name, last_name, email, role",
        "SELECT COUNT(*)"
      )
      .replace(/ORDER BY id ASC LIMIT \$\d+ OFFSET \$\d+/, "");

    const countResult = await pool.query(countQuery, countValues);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const result = await pool.query(query, values);
    return {
      users: result.rows,
      total,
      totalPages,
    };
  } catch (error) {
    throw new Error(`Error al obtener usuarios: ${error.message}`);
  }
};

const createUser = async (userData) => {
  try {
    const { first_name, last_name, email, password, role } = userData;
    const id = await generateUserId();
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (id, first_name, last_name, email, password, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, first_name, last_name, email, hashedPassword, role]
    );
    return result.rows[0];
  } catch (error) {
    throw new Error(`Error al crear usuario: ${error.message}`);
  }
};

const updateUser = async (userId, userData) => {
  try {
    const { first_name, last_name, email, password, role } = userData;
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (first_name) {
      fields.push(`first_name = $${paramIndex}`);
      values.push(first_name);
      paramIndex++;
    }
    if (last_name) {
      fields.push(`last_name = $${paramIndex}`);
      values.push(last_name);
      paramIndex++;
    }
    if (email) {
      fields.push(`email = $${paramIndex}`);
      values.push(email);
      paramIndex++;
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      fields.push(`password = $${paramIndex}`);
      values.push(hashedPassword);
      paramIndex++;
    }
    if (role) {
      fields.push(`role = $${paramIndex}`);
      values.push(role);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new Error("No se proporcionaron datos para actualizar");
    }

    values.push(userId);
    const query = `UPDATE users SET ${fields.join(
      ", "
    )} WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error("Usuario no encontrado");
    }
    return result.rows[0];
  } catch (error) {
    throw new Error(`Error al actualizar usuario: ${error.message}`);
  }
};

const deleteUser = async (userId) => {
  try {
    const result = await pool.query(
      "DELETE FROM users WHERE id = $1 RETURNING *",
      [userId]
    );
    if (result.rows.length === 0) {
      throw new Error("Usuario no encontrado");
    }
    return result.rows[0];
  } catch (error) {
    throw new Error(`Error al eliminar usuario: ${error.message}`);
  }
};

const getUserById = async (userId) => {
  try {
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, role, password FROM users WHERE id = $1",
      [userId]
    );
    if (result.rows.length === 0) {
      throw new Error("Usuario no encontrado");
    }
    return result.rows[0];
  } catch (error) {
    throw new Error(`Error al obtener usuario: ${error.message}`);
  }
};

const getUserByRole = async (role) => {
  try {
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, role FROM users WHERE role = $1 LIMIT 1",
      [role]
    );
    if (result.rows.length === 0) {
      throw new Error(`No se encontró usuario con rol ${role}`);
    }
    return result.rows[0];
  } catch (error) {
    throw new Error(`Error al obtener usuario por rol: ${error.message}`);
  }
};

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserById,
  getUserByRole,
};
