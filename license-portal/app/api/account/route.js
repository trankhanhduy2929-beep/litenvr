import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAccountById, publicAccount, readSession } from "@/lib/auth";

export async function GET(request) {
  const session = readSession(request);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const account = await getAccountById(session.uid);
  if (!account || account.status !== "active") {
    return NextResponse.json({ error: "Tài khoản không khả dụng" }, { status: 401 });
  }

  const orders = await query(
    `SELECT o.order_code, o.plan, o.amount, o.status, o.license_key, o.created_at, o.paid_at,
            l.expires_at, l.installation_id, l.status AS license_status
       FROM orders o
       LEFT JOIN licenses l ON l.license_key = o.license_key
      WHERE o.account_id = ?
      ORDER BY o.id DESC
      LIMIT 100`,
    [session.uid],
  );

  return NextResponse.json({ account: publicAccount(account), orders });
}
