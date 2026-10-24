import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeKey, requireAdmin } from "@/lib/license";

export async function PATCH(request, { params }) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 401 });
  }
  const { key } = await params;
  const licenseKey = normalizeKey(key);
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  if (body.status && !["active", "revoked"].includes(body.status)) {
    return NextResponse.json({ error: "Trạng thái không hợp lệ" }, { status: 400 });
  }
  if (body.reset_installation) {
    await query(
      "UPDATE licenses SET installation_id = NULL, activated_at = NULL WHERE license_key = ?",
      [licenseKey],
    );
  }
  if (body.add_days) {
    const days = Math.max(0, Math.min(3650, Number(body.add_days)));
    const rows = await query("SELECT expires_at FROM licenses WHERE license_key = ? LIMIT 1", [licenseKey]);
    if (rows.length) {
      const current = rows[0].expires_at ? new Date(rows[0].expires_at).getTime() : Date.now();
      const base = Math.max(Date.now(), Number.isNaN(current) ? Date.now() : current);
      await query("UPDATE licenses SET expires_at = ? WHERE license_key = ?", [
        new Date(base + days * 86400000),
        licenseKey,
      ]);
    }
  }
  if (body.status) {
    await query("UPDATE licenses SET status = ? WHERE license_key = ?", [body.status, licenseKey]);
  }
  const rows = await query("SELECT license_key, plan, status, expires_at, installation_id FROM licenses WHERE license_key = ?", [licenseKey]);
  if (!rows.length) return NextResponse.json({ error: "Không tìm thấy license" }, { status: 404 });
  return NextResponse.json({ status: "ok", license: rows[0] });
}
