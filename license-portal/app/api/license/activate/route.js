import { NextResponse } from "next/server";
import { activateOrValidate, clientIp } from "@/lib/license";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, error: "JSON không hợp lệ" }, { status: 400 });
  }
  try {
    const result = await activateOrValidate({
      key: body.key,
      installationId: body.installation_id,
      version: body.version,
      ip: clientIp(request),
      action: "activate",
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("license activate error", error);
    return NextResponse.json({ valid: false, error: "Lỗi máy chủ license" }, { status: 500 });
  }
}
