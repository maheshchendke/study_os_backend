import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { pool } from "../config/database.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const REMEMBERED_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE = "studyos_session";

function sessionCookieOptions(maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.cookieSameSite,
    path: "/api",
    maxAge: maxAgeSeconds * 1000,
  };
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(res) {
  const options = sessionCookieOptions();
  delete options.maxAge;
  res.clearCookie(SESSION_COOKIE, options);
}

export function readSessionCookie(req) {
  const prefix = `${SESSION_COOKIE}=`;
  for (const part of (req.headers.cookie || "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      try { return decodeURIComponent(value.slice(prefix.length)); } catch { return ""; }
    }
  }
  return "";
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, hashText] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || n !== "32768" || r !== "8" || p !== "1" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, "base64url"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    }));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function createSession(userId, res, rememberMe = false) {
  const token = randomBytes(32).toString("base64url");
  const maxAgeSeconds = rememberMe ? REMEMBERED_SESSION_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  await pool.execute(
    "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [tokenHash(token), userId, expiresAt]
  );
  await pool.execute("DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP");
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(maxAgeSeconds));
}

export async function revokeSession(token) {
  if (!token) return;
  await pool.execute("DELETE FROM user_sessions WHERE token_hash = ?", [tokenHash(token)]);
}

export async function findSessionUser(token) {
  if (!token) return null;
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.email, u.role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [tokenHash(token)]
  );
  return rows[0] || null;
}

export function newUserId() {
  return randomUUID();
}
