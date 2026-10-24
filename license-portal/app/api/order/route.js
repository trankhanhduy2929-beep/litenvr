import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(request) {
  const code = String(new URL(request.url).searchParams.get("code") || "").replace(/\D/g, "");
  if (!code) return NextResponse.json({ error: "Thiếu mã đơn" }, { status: 400 });
  const rows = await query(
    "SELECT order_code, plan, amount, status, license_key, paid_at FROM orders WHERE order_code = ? LIMIT 1",
    [code],
  );
  if (!rows.length) return NextResponse.json({ error: "Không tìm thấy đơn" }, { status: 404 });
  const order = rows[0];
  return NextResponse.json({
    order_code: String(order.order_code),
    plan: order.plan,
    amount: order.amount,
    status: order.status,
    license_key: order.status === "paid" ? order.license_key : null,
    paid_at: order.paid_at,
  });
}
