import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  findAccountByIdentifier,
  hashPassword,
  normalizeIdentifier,
  publicAccount,
  validatePassword,
} from "@/lib/auth";
import { requireAdmin } from "@/lib/license";

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

  const identifier = normalizeIdentifier(body.identifier || body.email || body.phone);
  if (!identifier) {
    return NextResponse.json({ error: "Email hoặc số điện thoại không hợp lệ" }, { status: 400 });
  }
  const passwordError = validatePassword(body.password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  const role = body.role === "admin" ? "admin" : "user";

  try {
    const existing = await findAccountByIdentifier(identifier);
    if (existing) {
      await query(
        "UPDATE accounts SET email = ?, phone = ?, password_hash = ?, role = ?, status = 'active' WHERE id = ?",
        [identifier.email, identifier.phone, hashPassword(body.password), role, existing.id],
      );
    } else {
      await query(
        "INSERT INTO accounts (email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, 'active')",
        [identifier.email, identifier.phone, hashPassword(body.password), role],
      );
    }
    const account = await findAccountByIdentifier(identifier);
    return NextResponse.json({ status: "ok", account: publicAccount(account) });
  } catch (error) {
    console.error("admin account error", error);
    return NextResponse.json({ error: "Không lưu được tài khoản" }, { status: 500 });
  }
}
