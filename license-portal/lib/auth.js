import crypto from "node:crypto";
import { query } from "./db";

export const SESSION_COOKIE = "litenvr_session";
const SESSION_TTL = 7 * 86400;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function sessionSecret() {
  const secret = process.env.AUTH_SECRET || process.env.LICENSE_SIGNING_SECRET;
  if (!secret) throw new Error("Thiếu AUTH_SECRET hoặc LICENSE_SIGNING_SECRET trên server");
  return secret;
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 32 || !/^[+\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("84")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^\d{9,10}$/.test(digits)) return null;
  return `+84${digits}`;
}

export function normalizeIdentifier(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.includes("@")) {
    const email = normalizeEmail(raw);
    return email ? { type: "email", value: email, email, phone: null } : null;
  }
  const phone = normalizePhone(raw);
  return phone ? { type: "phone", value: phone, email: null, phone } : null;
}

export function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8) return "Mật khẩu phải có ít nhất 8 ký tự";
  if (password.length > 128) return "Mật khẩu quá dài";
  return null;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const expected = Buffer.from(parts[2], "base64url");
    const actual = crypto.scryptSync(String(password), Buffer.from(parts[1], "base64url"), expected.length, SCRYPT);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function isDuplicateError(error) {
  return error?.code === "ER_DUP_ENTRY" || /unique|duplicate/i.test(String(error?.message || ""));
}

export function createSessionToken(account) {
  const payload = Buffer.from(JSON.stringify({
    uid: Number(account.id),
    role: account.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.uid || !Number.isFinite(Number(data.exp)) || Number(data.exp) <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { uid: Number(data.uid), role: data.role };
  } catch {
    return null;
  }
}

export function readSession(request) {
  return verifySessionToken(request.cookies?.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(response, account) {
  response.cookies.set(SESSION_COOKIE, createSessionToken(account), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.VERCEL === "1",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.VERCEL === "1",
    path: "/",
    maxAge: 0,
  });
}

export async function findAccountByIdentifier(identifier) {
  const column = identifier.type === "email" ? "email" : "phone";
  const rows = await query(
    `SELECT id, email, phone, password_hash, role, status FROM accounts WHERE ${column} = ? LIMIT 1`,
    [identifier.value],
  );
  return rows[0] || null;
}

export async function getAccountById(id) {
  const rows = await query(
    "SELECT id, email, phone, role, status, created_at FROM accounts WHERE id = ? LIMIT 1",
    [Number(id)],
  );
  return rows[0] || null;
}

export function publicAccount(account) {
  return {
    id: account.id,
    email: account.email || "",
    phone: account.phone || "",
    identifier: account.email || account.phone || "",
    role: account.role,
    status: account.status,
  };
}
