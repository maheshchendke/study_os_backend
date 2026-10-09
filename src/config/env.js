import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const isProduction = process.env.NODE_ENV === "production";

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const clientUrl = required("CLIENT_URL", isProduction ? "" : "http://localhost:5173");
const allowedClientUrls = isProduction
  ? [clientUrl]
  : [...new Set([clientUrl, "http://localhost:5173", "http://192.168.1.5:5173"])];
const cookieSameSite = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
if (!["lax", "strict", "none"].includes(cookieSameSite)) {
  throw new Error("COOKIE_SAME_SITE must be lax, strict, or none.");
}
if (isProduction) {
  if (!process.env.PORT) throw new Error("Missing required environment variable: PORT");
  if (!process.env.DB_PASSWORD) throw new Error("Missing required environment variable: DB_PASSWORD");
  let parsedClientUrl;
  try {
    parsedClientUrl = new URL(clientUrl);
  } catch {
    throw new Error("CLIENT_URL must be the deployed frontend HTTPS origin.");
  }
  if (parsedClientUrl.protocol !== "https:" || parsedClientUrl.origin !== clientUrl) {
    throw new Error("CLIENT_URL must be the deployed frontend HTTPS origin.");
  }
  if (cookieSameSite === "none" && parsedClientUrl.protocol !== "https:") {
    throw new Error("Secure cookies require an HTTPS frontend.");
  }
}

export const env = {
  port,
  clientUrl,
  allowedClientUrls,
  isProduction,
  cookieSameSite,
  database: {
    host: required("DB_HOST", isProduction ? "" : "localhost"),
    port: Number(process.env.DB_PORT || 3306),
    name: required("DB_NAME", isProduction ? "" : "studyos"),
    user: required("DB_USER", isProduction ? "" : "root"),
    password: process.env.DB_PASSWORD || "",
  },
  ai: {
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "",
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  },
};
