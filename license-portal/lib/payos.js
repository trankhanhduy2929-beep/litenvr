import crypto from "node:crypto";

const PAYOS_API = "https://api-merchant.payos.vn/v2/payment-requests";

export function payosConfigured() {
  return Boolean(process.env.PAYOS_CLIENT_ID && process.env.PAYOS_API_KEY && process.env.PAYOS_CHECKSUM_KEY);
}

export async function createPayosLink({ orderCode, amount, description, returnUrl, cancelUrl }) {
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
  const signatureData = [
    `amount=${amount}`,
    `cancelUrl=${cancelUrl}`,
    `description=${description}`,
    `orderCode=${orderCode}`,
    `returnUrl=${returnUrl}`,
  ].join("&");
  const signature = crypto.createHmac("sha256", checksumKey).update(signatureData).digest("hex");

  const response = await fetch(PAYOS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": process.env.PAYOS_CLIENT_ID,
      "x-api-key": process.env.PAYOS_API_KEY,
      "User-Agent": "LiteNVR-License/1.0",
    },
    body: JSON.stringify({
      orderCode,
      amount,
      description,
      returnUrl,
      cancelUrl,
      signature,
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== "00") {
    throw new Error(data.desc || "PayOS từ chối tạo thanh toán");
  }
  return data.data;
}

export function verifyPayosWebhook(data) {
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
  if (!checksumKey || !data?.signature) return false;
  const sorted = Object.keys(data)
    .filter((key) => key !== "signature")
    .sort()
    .map((key) => `${key}=${data[key] ?? ""}`)
    .join("&");
  const expected = crypto.createHmac("sha256", checksumKey).update(sorted).digest("hex");
  const actual = String(data.signature);
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
