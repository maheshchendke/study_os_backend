import { ApiError } from "../utils/http.js";

export function notFound(req, res) {
  res.status(404).json({ success: false, message: "We could not find what you asked for.", code: "NOT_FOUND", error: "NOT_FOUND" });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code, error: error.code, ...(error.errors ? { errors: error.errors } : {}) });
  }
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ success: false, message: "Request body must contain valid JSON.", code: "INVALID_JSON", error: "INVALID_JSON" });
  }
  const unavailableCodes = new Set(["ECONNREFUSED", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "PROTOCOL_CONNECTION_LOST", "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR"]);
  if (unavailableCodes.has(error.code)) {
    console.error("StudyOS database is unavailable. Check backend/.env values DB_PASSWORD, DB_HOST, and DB_NAME.", error.code);
    return res.status(503).json({ success: false, message: "Service temporarily unavailable. Please try again in a moment.", code: "SERVICE_UNAVAILABLE", error: "SERVICE_UNAVAILABLE" });
  }
  console.error("API request failed:", error.code || error.name || "UNKNOWN");
  const status = error.code === "ER_DUP_ENTRY" ? 409 : 500;
  const message = status === 409 ? "A record with those details already exists." : "Something went wrong. Please try again.";
  const code = status === 409 ? "CONFLICT" : "INTERNAL_ERROR";
  return res.status(status).json({ success: false, message, code, error: code });
}
