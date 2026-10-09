import { ApiError, asyncHandler } from "../utils/http.js";
import { env } from "../config/env.js";
import { clearSessionCookie, findSessionUser, readSessionCookie } from "../services/auth.js";

export const authenticate = asyncHandler(async (req, res, next) => {
  const user = await findSessionUser(readSessionCookie(req));
  if (!user) {
    clearSessionCookie(res);
    throw new ApiError(401, "Please sign in to continue.", "AUTH_REQUIRED");
  }
  req.user = user;
  req.userId = user.id;
  return next();
});

export function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin && !env.allowedClientUrls.includes(origin)) {
    return next(new ApiError(403, "This request origin is not allowed.", "ORIGIN_NOT_ALLOWED"));
  }
  return next();
}
