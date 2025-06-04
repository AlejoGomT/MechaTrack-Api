const { Pool } = require("pg");
require("dotenv").config();
const config = require("./config");

const pool = new Pool(config.db);

/*const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});*/

module.exports = pool;
