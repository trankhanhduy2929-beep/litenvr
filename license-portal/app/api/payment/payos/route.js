import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { logLicenseEvent } from "@/lib/license";
import { settlePayosOrder } from "@/lib/orders";
import { verifyPayosWebhook } from "@/lib/payos";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "JSON không hợp lệ" }, { status: 400 });
  }
  const data = payload?.data;
  if (!payload?.success || String(payload?.code) !== "00" || !data) {
    return NextResponse.json({ success: false, error: "Thanh toán chưa thành công" }, { status: 400 });
  }
  if (!verifyPayosWebhook({ ...data, signature: payload.signature })) {
    return NextResponse.json({ success: false, error: "Sai chữ ký webhook" }, { status: 401 });
  }

  const orderCode = String(data.orderCode || "").replace(/\D/g, "");
  if (!orderCode) {
    return NextResponse.json({ success: false, error: "Thiếu orderCode" }, { status: 400 });
  }

  try {
    const result = await settlePayosOrder({
      orderCode,
      amount: data.amount,
      rawPayload: payload,
    });
    if (result.status === "missing") {
      // PayOS gửi đơn mẫu khi xác thực webhook URL; trả 2xx để xác nhận endpoint hoạt động.
      return NextResponse.json({ success: true, ignored: true });
    }
    if (result.status === "amount_mismatch") {
      return NextResponse.json({ success: false, error: "Số tiền không khớp" }, { status: 400 });
    }
    if (result.status === "duplicate") {
      return NextResponse.json({ success: true, duplicate: true });
    }
    await logLicenseEvent(result.licenseKey, "purchase", "", "", "", `payos ${orderCode}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("payos webhook error", error);
    return NextResponse.json({ success: false, error: "Lỗi xử lý thanh toán" }, { status: 500 });
  }
}

export async function GET() {
  const cutoff = new Date(Date.now() - 86400000);
  const rows = await query(
    "SELECT COUNT(*) AS count FROM orders WHERE status = 'pending' AND created_at > ?",
    [cutoff],
  );
  return NextResponse.json({ status: "ok", pending_orders: rows[0]?.count || 0 });
}
