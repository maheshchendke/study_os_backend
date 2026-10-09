import mysql from "mysql2/promise";
import { env } from "./env.js";

export const pool = mysql.createPool({
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 5,
  idleTimeout: 60_000,
  queueLimit: 0,
  enableKeepAlive: true,
  dateStrings: true,
});

pool.on("connection", (connection) => {
  connection.on("error", (error) => {
    console.error("MySQL connection error:", error.code || "UNKNOWN");
  });
});

export async function checkDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

export async function closeDatabase() {
  await pool.end();
}
