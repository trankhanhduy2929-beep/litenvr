import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { generateLicenseKey, requireAdmin } from "@/lib/license";
import { getPlan } from "@/lib/plans";

export async function GET(request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));
  const rows = await query(
    "SELECT id, license_key, plan, status, expires_at, installation_id, activated_at, last_seen, note, created_at FROM licenses ORDER BY id DESC LIMIT ?",
    [limit],
  );
  return NextResponse.json({ licenses: rows });
}

export async function POST(request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  const plan = String(body.plan || "trial").trim().toLowerCase();
  const planInfo = getPlan(plan);
  const requestedDays = body.days === undefined || body.days === "" ? planInfo?.days : body.days;
  const days = planInfo?.lifetime ? 0 : Math.max(0, Math.min(3650, Number(requestedDays || 0)));
  const count = Math.max(1, Math.min(100, Number(body.count || 1)));
  const note = String(body.note || "").slice(0, 255);
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000) : null;
  const created = [];
  for (let i = 0; i < count; i += 1) {
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      const key = generateLicenseKey();
      try {
        await query(
          "INSERT INTO licenses (license_key, plan, expires_at, note) VALUES (?, ?, ?, ?)",
          [key, plan, expiresAt, note],
        );
        created.push(key);
        inserted = true;
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY") throw error;
      }
    }
  }
  return NextResponse.json({ status: "ok", keys: created, plan, expires_at: expiresAt });
}
