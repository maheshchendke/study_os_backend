export class ApiError extends Error {
  constructor(status, message, code, errors) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function sendSuccess(res, data, message = "Request completed.") {
  return res.json({ success: true, data, message });
}

export function safeInteger(value, label = "id") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new ApiError(400, `A valid ${label} is required.`, "INVALID_ID");
  }
  return number;
}

export function objectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Request body must be a JSON object.", "INVALID_BODY");
  }
  return body;
}

export function requiredText(value, field, maxLength = 240) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new ApiError(400, `${field} is required and must be at most ${maxLength} characters.`, "VALIDATION_ERROR");
  }
  return value.trim();
}

export function optionalText(value, field, maxLength = 10000) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ApiError(400, `${field} must be text no longer than ${maxLength} characters.`, "VALIDATION_ERROR");
  }
  return value.trim();
}

export function enumValue(value, allowed, field, fallback) {
  const actual = value == null || value === "" ? fallback : value;
  if (!allowed.includes(actual)) {
    throw new ApiError(400, `${field} is invalid.`, "VALIDATION_ERROR");
  }
  return actual;
}

export function numericValue(value, field, { min = 0, max = 100000000, optional = true } = {}) {
  if ((value == null || value === "") && optional) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, `${field} must be between ${min} and ${max}.`, "VALIDATION_ERROR");
  }
  return number;
}

export function dateValue(value, field, optional = true) {
  if ((value == null || value === "") && optional) return null;
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, `${field} must use YYYY-MM-DD format.`, "VALIDATION_ERROR");
  }
  return value;
}

export function timeValue(value, field, optional = true) {
  if ((value == null || value === "") && optional) return null;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    throw new ApiError(400, `${field} must use HH:MM format.`, "VALIDATION_ERROR");
  }
  return value.length === 5 ? `${value}:00` : value;
}
