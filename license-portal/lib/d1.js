const GATEWAY_TIMEOUT_MS = 20000;

export class D1ConflictError extends Error {
  constructor() {
    super("transaction_conflict");
    this.code = "transaction_conflict";
  }
}

export function d1Enabled() {
  return process.env.DATABASE_PROVIDER === "d1" || Boolean(process.env.D1_GATEWAY_URL);
}

function normalizeParams(params = []) {
  return params.map((value) => (value instanceof Date ? value.toISOString() : value));
}

export async function d1Batch(statements) {
  const url = new URL(process.env.D1_GATEWAY_URL || "");
  const secret = process.env.D1_GATEWAY_SECRET || "";
  if (url.protocol !== "https:" || !secret) throw new Error("Thiếu cấu hình D1 gateway");
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "User-Agent": "LiteNVR-License/1.0",
    },
    body: JSON.stringify({
      statements: statements.map(({ sql, params }) => ({ sql, params: normalizeParams(params) })),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (payload.error === "transaction_conflict") throw new D1ConflictError();
    throw new Error(payload.error || "D1 không khả dụng");
  }
  return (await response.json()).results || [];
}

export async function d1Query(sql, params = []) {
  const results = await d1Batch([{ sql, params }]);
  return results[0]?.rows || [];
}

export function guard(condition, params = []) {
  return {
    sql: `INSERT INTO transaction_guard(value) VALUES(CASE WHEN (${condition}) THEN 1 ELSE 0 END)`,
    params,
  };
}

export const clearGuard = { sql: "DELETE FROM transaction_guard" };
