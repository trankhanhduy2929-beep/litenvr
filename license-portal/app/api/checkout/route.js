import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAccountById, readSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { clientIp } from "@/lib/license";
import { markOrderPaid } from "@/lib/orders";
import { createPayosLink, payosConfigured } from "@/lib/payos";
import { getPlan } from "@/lib/plans";

const TRIAL_PER_IP = 3;

export async function POST(request) {
  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: "Vui lòng đăng nhập", code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const account = await getAccountById(session.uid);
  if (!account || account.status !== "active") {
    return NextResponse.json({ error: "Tài khoản không khả dụng", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  const plan = getPlan(body.plan);
  if (!plan) return NextResponse.json({ error: "Gói không hợp lệ" }, { status: 400 });

  const email = String(account.email || "").slice(0, 255);
  const orderCode = crypto.randomInt(100000000000, 999999999999);
  const ip = clientIp(request) || "unknown";

  if (plan.price <= 0) {
    const claimed = await query(
      "SELECT COUNT(*) AS n FROM trial_claims WHERE account_id = ?",
      [session.uid],
    );
    if (Number(claimed[0]?.n || 0) > 0) {
      return NextResponse.json({ error: "Tài khoản này đã dùng thử 1 ngày" }, { status: 409 });
    }
    const cutoff = new Date(Date.now() - 86400000);
    const recent = await query(
      "SELECT COUNT(*) AS n FROM trial_claims WHERE ip = ? AND created_at >= ?",
      [ip, cutoff],
    );
    if (Number(recent[0]?.n || 0) >= TRIAL_PER_IP) {
      return NextResponse.json({ error: "Đã đạt giới hạn dùng thử từ mạng này, vui lòng thử lại sau" }, { status: 429 });
    }

    await query(
      "INSERT INTO orders (order_code, plan, amount, email, account_id, status, provider) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [String(orderCode), plan.id, plan.price, email, session.uid, "trial"],
    );
    try {
      await query(
        "INSERT INTO trial_claims (account_id, ip, created_at) VALUES (?, ?, ?)",
        [session.uid, ip, new Date()],
      );
    } catch (error) {
      await query("UPDATE orders SET status = 'cancelled' WHERE order_code = ?", [String(orderCode)]);
      if (/unique|duplicate/i.test(String(error?.message || ""))) {
        return NextResponse.json({ error: "Tài khoản này đã dùng thử 1 ngày" }, { status: 409 });
      }
      throw error;
    }

    try {
      const paid = await markOrderPaid(String(orderCode));
      if (paid.status !== "paid" && paid.status !== "duplicate") {
        throw new Error("Không tạo được key dùng thử");
      }
      return NextResponse.json({
        status: "free",
        order_code: orderCode,
        license_key: paid.licenseKey,
        plan: plan.id,
        days: plan.days,
      });
    } catch (error) {
      await query("DELETE FROM trial_claims WHERE account_id = ?", [session.uid]);
      await query("UPDATE orders SET status = 'cancelled' WHERE order_code = ?", [String(orderCode)]);
      console.error("trial error", error);
      return NextResponse.json({ error: "Không tạo được key dùng thử" }, { status: 502 });
    }
  }

  await query(
    "INSERT INTO orders (order_code, plan, amount, email, account_id, status, provider) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    [String(orderCode), plan.id, plan.price, email, session.uid, payosConfigured() ? "payos" : "manual"],
  );

  if (!payosConfigured()) {
    return NextResponse.json({
      status: "manual",
      order_code: orderCode,
      amount: plan.price,
      bank: {
        name: process.env.NEXT_PUBLIC_BANK_NAME || "",
        account: process.env.NEXT_PUBLIC_BANK_ACCOUNT || "",
        owner: process.env.NEXT_PUBLIC_BANK_OWNER || "",
      },
      note: `LITE ${orderCode}`,
      support: process.env.NEXT_PUBLIC_SUPPORT_CONTACT || "",
    });
  }

  try {
    const base = new URL(request.url).origin;
    const payment = await createPayosLink({
      orderCode,
      amount: plan.price,
      description: `LiteNVR ${plan.name} ${orderCode}`.slice(0, 25),
      returnUrl: process.env.PAYOS_RETURN_URL || `${base}/success`,
      cancelUrl: process.env.PAYOS_CANCEL_URL || `${base}/?canceled=1`,
    });
    return NextResponse.json({
      status: "payos",
      order_code: orderCode,
      checkout_url: payment.checkoutUrl,
    });
  } catch (error) {
    console.error("checkout error", error);
    return NextResponse.json({ error: error.message || "Không tạo được thanh toán" }, { status: 502 });
  }
}
