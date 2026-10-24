import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hitRateLimit, rateBucket } from "@/lib/rate-limit";
import {
  findAccountByIdentifier,
  hashPassword,
  isDuplicateError,
  normalizeIdentifier,
  publicAccount,
  setSessionCookie,
  validatePassword,
} from "@/lib/auth";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  if (await hitRateLimit(rateBucket(request, "register"), 10, 3600)) {
    return NextResponse.json({ error: "Quá nhiều lần đăng ký, thử lại sau 1 giờ" }, { status: 429 });
  }

  const identifier = normalizeIdentifier(body.identifier || body.email || body.phone);
  if (!identifier) {
    return NextResponse.json({ error: "Nhập email hoặc số điện thoại hợp lệ" }, { status: 400 });
  }
  const passwordError = validatePassword(body.password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  try {
    const existing = await findAccountByIdentifier(identifier);
    if (existing) {
      return NextResponse.json({ error: "Email hoặc số điện thoại đã được đăng ký" }, { status: 409 });
    }

    await query(
      "INSERT INTO accounts (email, phone, password_hash, role, status) VALUES (?, ?, ?, 'user', 'active')",
      [identifier.email, identifier.phone, hashPassword(body.password)],
    );
    const account = await findAccountByIdentifier(identifier);
    if (!account) throw new Error("Không tạo được tài khoản");

    const response = NextResponse.json({ status: "ok", account: publicAccount(account) });
    setSessionCookie(response, account);
    return response;
  } catch (error) {
    if (isDuplicateError(error)) {
      return NextResponse.json({ error: "Email hoặc số điện thoại đã được đăng ký" }, { status: 409 });
    }
    console.error("register error", error);
    return NextResponse.json({ error: "Không tạo được tài khoản" }, { status: 500 });
  }
}
