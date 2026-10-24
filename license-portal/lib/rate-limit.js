import { clientIp } from "./license";
import { query } from "./db";

export function rateBucket(request, action) {
  return `${action}:${clientIp(request) || "unknown"}`;
}

export async function hitRateLimit(bucket, limit, windowSec) {
  const since = new Date(Date.now() - windowSec * 1000);
  const rows = await query(
    "SELECT COUNT(*) AS n FROM auth_events WHERE bucket = ? AND created_at >= ?",
    [bucket, since],
  );
  if (Number(rows[0]?.n || 0) >= limit) return true;
  await query("INSERT INTO auth_events (bucket, created_at) VALUES (?, ?)", [bucket, new Date()]);
  if (Math.random() < 0.02) {
    query("DELETE FROM auth_events WHERE created_at < ?", [new Date(Date.now() - 86400000)]).catch(() => {});
  }
  return false;
}
