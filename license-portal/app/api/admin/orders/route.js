import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/license";

export async function GET(request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 401 });
  }
  const rows = await query(
    "SELECT order_code, plan, amount, email, status, license_key, provider, created_at, paid_at FROM orders ORDER BY id DESC LIMIT 200",
  );
  return NextResponse.json({ orders: rows });
}
