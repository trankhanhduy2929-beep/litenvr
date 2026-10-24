import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, readSession, validatePassword, verifyPassword } from "@/lib/auth";

export async function PATCH(request) {
  const session = readSession(request);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const passwordError = validatePassword(body.new_password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const rows = await query(
    "SELECT id, password_hash, status FROM accounts WHERE id = ? LIMIT 1",
    [session.uid],
  );
  const account = rows[0];
  if (!account || account.status !== "active") {
    return NextResponse.json({ error: "Tài khoản không khả dụng" }, { status: 401 });
  }
  if (!verifyPassword(body.current_password, account.password_hash)) {
    return NextResponse.json({ error: "Mật khẩu hiện tại không đúng" }, { status: 400 });
  }

  await query("UPDATE accounts SET password_hash = ? WHERE id = ?", [
    hashPassword(body.new_password),
    account.id,
  ]);
  return NextResponse.json({ status: "ok" });
}
