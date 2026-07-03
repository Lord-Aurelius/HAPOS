"use strict";

const { Pool } = require("pg");

const CONNECTION_KEYS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"];

let pool = null;

function getDatabaseUrl() {
  for (const key of CONNECTION_KEYS) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function getPool() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.POSTGRES_POOL_MAX || 20),
    });
  }
  return pool;
}

async function queryOne(authContext, sql, params = []) {
  const p = getPool();
  if (!p) {
    const err = new Error("Database not available");
    err.code = "42P01";
    throw err;
  }
  try {
    const result = await p.query(sql, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    throw error;
  }
}

async function queryRows(authContext, sql, params = []) {
  const p = getPool();
  if (!p) {
    const err = new Error("Database not available");
    err.code = "42P01";
    throw err;
  }
  try {
    const result = await p.query(sql, params);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

module.exports = { queryOne, queryRows };
