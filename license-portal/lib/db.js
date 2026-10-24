import mysql from "mysql2/promise";
import { clearGuard, d1Batch, d1Enabled, d1Query, guard } from "./d1";

let pool;

function sslConfig() {
  const mode = String(process.env.DB_SSL || "required").toLowerCase();
  if (mode === "disabled" || mode === "off" || mode === "false") return undefined;
  const ca = process.env.DB_SSL_CA
    ? process.env.DB_SSL_CA.replace(/\\n/g, "\n")
    : undefined;
  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    ...(ca ? { ca } : {}),
  };
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || "litenvr",
      waitForConnections: true,
      connectionLimit: 5,
      timezone: "Z",
      charset: "utf8mb4",
      ssl: sslConfig(),
    });
  }
  return pool;
}

export async function query(sql, params = []) {
  if (d1Enabled()) return d1Query(sql, params);
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

export async function batch(statements) {
  if (d1Enabled()) return d1Batch(statements);
  throw new Error("Batch chỉ hỗ trợ D1");
}

export { clearGuard, d1Enabled, guard };
