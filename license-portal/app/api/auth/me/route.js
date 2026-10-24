import { NextResponse } from "next/server";
import { getAccountById, publicAccount, readSession } from "@/lib/auth";

export async function GET(request) {
  const session = readSession(request);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const account = await getAccountById(session.uid);
  if (!account || account.status !== "active") {
    return NextResponse.json({ error: "Tài khoản không khả dụng" }, { status: 401 });
  }
  return NextResponse.json({ account: publicAccount(account) });
}
