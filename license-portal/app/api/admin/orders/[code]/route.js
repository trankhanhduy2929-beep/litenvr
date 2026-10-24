import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/license";
import { markOrderPaid } from "@/lib/orders";

export async function PATCH(request, { params }) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 401 });
  }
  const { code } = await params;
  const orderCode = String(code || "").replace(/\D/g, "");
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  if (orderCode.length < 6) {
    return NextResponse.json({ error: "Mã đơn không hợp lệ" }, { status: 400 });
  }

  if (body.action === "cancel") {
    await query("UPDATE orders SET status = 'cancelled' WHERE order_code = ?", [orderCode]);
    return NextResponse.json({ status: "ok", order_status: "cancelled" });
  }

  try {
    const result = await markOrderPaid(orderCode);
    if (result.status === "missing") {
      return NextResponse.json({ error: "Không tìm thấy đơn" }, { status: 404 });
    }
    return NextResponse.json({
      status: "ok",
      order_status: "paid",
      license_key: result.licenseKey,
    });
  } catch (error) {
    console.error("admin order update error", error);
    return NextResponse.json({ error: "Không cập nhật được đơn" }, { status: 500 });
  }
}
