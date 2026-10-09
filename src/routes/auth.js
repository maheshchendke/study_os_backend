import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../config/database.js";
import { asyncHandler, ApiError, objectBody, sendSuccess } from "../utils/http.js";
import { clearSessionCookie, createSession, findSessionUser, hashPassword, newUserId, readSessionCookie, revokeSession, verifyPassword } from "../services/auth.js";

const router = Router();
const GENERIC_LOGIN_ERROR = new ApiError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS");
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12).max(128);
const loginSchema = z.object({ email: emailSchema, password: passwordSchema, rememberMe: z.boolean().optional() }).strict();
const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
}).strict();

function parseAuthBody(schema, body, status) {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const errors = Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0] || "form", issue.message]));
  throw new ApiError(status, status === 422 ? "Please check the highlighted fields." : "Some details are not valid. Please check and try again.", "VALIDATION_ERROR", errors);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator(req) {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return ipKeyGenerator(req.ip || "unknown") + ":" + email;
  },
  handler(req, res) {
    const retrySeconds = Math.max(1, Math.ceil(((req.rateLimit?.resetTime?.getTime?.() || Date.now() + 900000) - Date.now()) / 1000));
    res.set("Retry-After", String(retrySeconds));
    return res.status(429).json({ success: false, message: "Too many attempts. Please wait before trying again.", code: "RATE_LIMITED", error: "RATE_LIMITED" });
  },
});

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

router.post("/register", asyncHandler(async (req, res) => {
  const { name, email, password } = parseAuthBody(registerSchema, objectBody(req.body), 422);
  const passwordHash = await hashPassword(password);
  const id = newUserId();
  try {
    await pool.execute(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'student')",
      [id, name, email, passwordHash]
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw new ApiError(409, "An account with that email already exists.", "EMAIL_IN_USE");
    throw error;
  }
  await createSession(id, res);
  res.set("Cache-Control", "no-store");
  res.status(201);
  return sendSuccess(res, { user: { id, name, email, role: "student" } }, "Account created.");
}));

router.post("/login", loginLimiter, asyncHandler(async (req, res) => {
  const input = parseAuthBody(loginSchema, objectBody(req.body), 400);
  const { email } = input;
  const [rows] = await pool.execute(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  if (!rows.length || !rows[0].password_hash) {
    await hashPassword(input.password);
    throw GENERIC_LOGIN_ERROR;
  }
  if (!(await verifyPassword(input.password, rows[0].password_hash))) {
    throw GENERIC_LOGIN_ERROR;
  }
  await createSession(rows[0].id, res, input.rememberMe === true);
  res.set("Cache-Control", "no-store");
  return sendSuccess(res, { user: publicUser(rows[0]) }, "Signed in.");
}));

router.post("/logout", asyncHandler(async (req, res) => {
  await revokeSession(readSessionCookie(req));
  clearSessionCookie(res);
  res.set("Cache-Control", "no-store");
  return sendSuccess(res, null, "Signed out.");
}));

router.get("/me", asyncHandler(async (req, res) => {
  const user = await findSessionUser(readSessionCookie(req));
  res.set("Cache-Control", "no-store");
  if (!user) {
    clearSessionCookie(res);
    throw new ApiError(401, "Please sign in to continue.", "AUTH_REQUIRED");
  }
  return sendSuccess(res, { user }, "Session restored.");
}));

export default router;
