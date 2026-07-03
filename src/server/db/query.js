"use strict";

const { getPool } = require("./client");

async function queryOne(authContext, sql, params = []) {
  const pool = getPool();
  if (!pool) {
    const err = new Error("Database not available");
    err.code = "42P01";
    throw err;
  }
  try {
    const result = await pool.query(sql, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    throw error;
  }
}

async function queryRows(authContext, sql, params = []) {
  const pool = getPool();
  if (!pool) {
    const err = new Error("Database not available");
    err.code = "42P01";
    throw err;
  }
  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

module.exports = { queryOne, queryRows };
