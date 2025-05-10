require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET,
  db: {
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "masimtaller_db",
    password: process.env.DB_PASSWORD || "admin123",
    port: process.env.DB_PORT || 5432,
  },
};
