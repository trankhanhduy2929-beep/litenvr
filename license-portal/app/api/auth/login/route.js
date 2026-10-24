import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hitRateLimit, rateBucket } from "@/lib/rate-limit";
import {
  findAccountByIdentifier,
  normalizeIdentifier,
  publicAccount,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  if (await hitRateLimit(rateBucket(request, "login"), 30, 900)) {
    return NextResponse.json({ error: "Quá nhiều lần đăng nhập, thử lại sau 15 phút" }, { status: 429 });
  }

  const identifier = normalizeIdentifier(body.identifier || body.email || body.phone);
  const password = String(body.password || "");
  if (!identifier || !password) {
    return NextResponse.json({ error: "Nhập email/số điện thoại và mật khẩu" }, { status: 400 });
  }
  if (await hitRateLimit(`login-id:${identifier.email || identifier.phone}`, 10, 900)) {
    return NextResponse.json({ error: "Quá nhiều lần đăng nhập, thử lại sau 15 phút" }, { status: 429 });
  }

  try {
    const account = await findAccountByIdentifier(identifier);
    if (!account || account.status !== "active" || !verifyPassword(password, account.password_hash)) {
      return NextResponse.json({ error: "Sai email/số điện thoại hoặc mật khẩu" }, { status: 401 });
    }

    await query("UPDATE accounts SET last_login = ? WHERE id = ?", [new Date(), account.id]);
    const response = NextResponse.json({ status: "ok", account: publicAccount(account) });
    setSessionCookie(response, account);
    return response;
  } catch (error) {
    console.error("login error", error);
    return NextResponse.json({ error: "Không đăng nhập được" }, { status: 500 });
  }
}
