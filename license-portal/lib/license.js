import crypto from "node:crypto";
import { readSession } from "./auth";
import { query } from "./db";

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateLicenseKey() {
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let part = "";
    for (let i = 0; i < 4; i += 1) {
      part += KEY_ALPHABET[crypto.randomInt(0, KEY_ALPHABET.length)];
    }
    groups.push(part);
  }
  return "LITE-" + groups.join("-");
}

export function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

export function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function licensePayload(license) {
  return {
    key: license.license_key,
    plan: license.plan,
    expires_at: isoDate(license.expires_at),
    installation_id: license.installation_id || "",
    issued_at: new Date().toISOString(),
  };
}

export function signToken(payload) {
  const secret = process.env.LICENSE_SIGNING_SECRET;
  if (!secret) throw new Error("Thiếu LICENSE_SIGNING_SECRET trên server");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export async function logLicenseEvent(licenseKey, action, installationId = "", version = "", ip = "", detail = "") {
  await query(
    "INSERT INTO license_events (license_key, action, installation_id, version, ip, detail) VALUES (?, ?, ?, ?, ?, ?)",
    [licenseKey, action, installationId, version, ip, String(detail).slice(0, 500)],
  ).catch(() => {});
}

export async function activateOrValidate({ key, installationId, version, ip, action }) {
  const licenseKey = normalizeKey(key);
  const machine = String(installationId || "").trim();
  if (!licenseKey || !machine) {
    return { status: 400, body: { valid: false, error: "Thiếu license key hoặc installation_id" } };
  }

  const rows = await query(
    "SELECT id, license_key, plan, status, expires_at, installation_id FROM licenses WHERE license_key = ? LIMIT 1",
    [licenseKey],
  );
  const license = rows[0];
  if (!license) {
    await logLicenseEvent(licenseKey, action, machine, version, ip, "not_found");
    return { status: 404, body: { valid: false, error: "License key không tồn tại" } };
  }
  if (license.status !== "active") {
    await logLicenseEvent(licenseKey, action, machine, version, ip, "revoked");
    return { status: 403, body: { valid: false, error: "License đã bị thu hồi" } };
  }
  const expires = license.expires_at ? new Date(license.expires_at) : null;
  if (expires && expires.getTime() <= Date.now()) {
    await logLicenseEvent(licenseKey, action, machine, version, ip, "expired");
    return { status: 403, body: { valid: false, error: "License đã hết hạn", expires_at: isoDate(expires) } };
  }
  if (license.installation_id && license.installation_id !== machine) {
    await logLicenseEvent(licenseKey, action, machine, version, ip, "machine_mismatch");
    return {
      status: 409,
      body: { valid: false, error: "License đã kích hoạt trên thiết bị khác. Liên hệ hỗ trợ để chuyển máy." },
    };
  }

  const now = new Date();
  await query(
    "UPDATE licenses SET installation_id = ?, activated_at = COALESCE(activated_at, ?), last_seen = ? WHERE id = ? AND (installation_id IS NULL OR installation_id = ?)",
    [machine, now, now, license.id, machine],
  );
  const current = (
    await query("SELECT installation_id FROM licenses WHERE id = ? LIMIT 1", [license.id])
  )[0];
  if (!current || current.installation_id !== machine) {
    await logLicenseEvent(licenseKey, action, machine, version, ip, "machine_mismatch");
    return {
      status: 409,
      body: { valid: false, error: "License đã kích hoạt trên thiết bị khác. Liên hệ hỗ trợ để chuyển máy." },
    };
  }

  const payload = licensePayload({ ...license, installation_id: license.installation_id || machine });
  const token = signToken(payload);
  await logLicenseEvent(licenseKey, action, machine, version, ip, "ok");
  return {
    status: 200,
    body: {
      valid: true,
      token,
      plan: license.plan,
      expires_at: payload.expires_at,
      installation_id: payload.installation_id,
    },
  };
}

export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || request.headers.get("x-real-ip") || "";
}

export function requireAdmin(request) {
  const session = readSession(request);
  if (session?.role === "admin") return true;
  const expected = process.env.ADMIN_TOKEN || "";
  const actual = request.headers.get("x-admin-token") || "";
  if (!expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
