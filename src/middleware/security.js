import { env } from "../config/env.js";

// Security headers — applied before all other middleware.
// For a pure JSON REST API, strict CSP and no-sniff headers are safe and correct.
export function securityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  res.set("X-Content-Type-Options", "nosniff");
  // Deny embedding in frames/iframes (no frontend pages served by this API)
  res.set("X-Frame-Options", "DENY");
  // Block referrer header on cross-origin navigations
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Minimal CSP for a JSON API: no resources should load from this origin
  res.set("Content-Security-Policy", "default-src 'none'");
  // Only set HSTS in production (requires TLS to be meaningful)
  if (env.isProduction) {
    res.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return next();
}

