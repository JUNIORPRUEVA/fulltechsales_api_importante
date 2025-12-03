// src/db.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl:
    process.env.PG_SSLMODE === "require"
      ? { rejectUnauthorized: false }
      : false,
});

// helper para usar como query('SELECT ...', [params])
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  pool,
  query,
};
