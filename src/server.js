import express from "express";
import cors from "cors";
import { timingSafeEqual } from "node:crypto";
import { env } from "./config/env.js";
import { checkDatabase, closeDatabase, pool } from "./config/database.js";
import { authenticate, requireSameOrigin } from "./middleware/authenticate.js";
import { securityHeaders } from "./middleware/security.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { asyncHandler, sendSuccess } from "./utils/http.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";

const app = express();

function timingSafeTokenEqual(supplied, expected) {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.allowedClientUrls.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "2mb" }));
app.locals.clientUrl = env.clientUrl;
app.use("/api/auth", requireSameOrigin, authRoutes);
app.get("/api/health/live", (req, res) => sendSuccess(res, { status: "alive" }, "StudyOS API process is running."));
const readinessHandler = asyncHandler(async (req, res) => {
  const token = process.env.HEALTH_DIAGNOSTIC_TOKEN;
  const suppliedToken = req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];

  // The diagnostic is opt-in and requires a separate secret. Never expose
  // database metadata through the ordinary public health check.
  if (token && suppliedToken && timingSafeTokenEqual(suppliedToken, token)) {
    const [identityRows] = await pool.execute(
      `SELECT DATABASE() AS databaseName,
        @@hostname AS serverHostname,
        @@port AS serverPort,
        @@version AS serverVersion`
    );
    const [tableRows] = await pool.execute(
      `SELECT TABLE_NAME AS tableName
       FROM information_schema.tables
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users', 'user_sessions')`
    );
    const existingTables = new Set(tableRows.map((row) => row.tableName));
    return sendSuccess(res, {
      database: identityRows[0]?.databaseName ?? null,
      server: {
        hostname: identityRows[0]?.serverHostname ?? null,
        port: identityRows[0]?.serverPort ?? null,
        version: identityRows[0]?.serverVersion ?? null,
      },
      tables: {
        users: existingTables.has("users"),
        user_sessions: existingTables.has("user_sessions"),
      },
    }, "Database diagnostic.");
  }

  try {
    await checkDatabase();
    return sendSuccess(res, { database: "connected" }, "StudyOS API is ready.");
  } catch (error) {
    logDatabaseFailure("readiness", error);
    return res.status(503).json({ success: false, message: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE", error: "DATABASE_UNAVAILABLE" });
  }
});
app.get("/api/health", readinessHandler);
app.get("/api/health/ready", readinessHandler);
app.use("/api", requireSameOrigin, authenticate, apiRoutes);
app.use(notFound);
app.use(errorHandler);

let server;
let shuttingDown = false;

const RETRYABLE_DATABASE_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "PROTOCOL_CONNECTION_LOST"]);

function logDatabaseFailure(stage, error) {
  const code = error?.code || "UNKNOWN";
  const category = code === "ENOTFOUND" || code === "EAI_AGAIN"
    ? "dns"
    : ["ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR"].includes(code)
      ? "database_configuration_or_access"
      : "connection";
  console.error("StudyOS MySQL connection failed:", JSON.stringify({
    stage,
    category,
    code,
    host: env.database.host,
    port: env.database.port,
  }));
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function connectWithBoundedRetries() {
  const retryDelays = [1000, 3000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await checkDatabase();
      console.log("StudyOS MySQL connection is ready.");
      return;
    } catch (error) {
      logDatabaseFailure(`startup_attempt_${attempt + 1}`, error);
      const waitMs = retryDelays[attempt];
      if (!RETRYABLE_DATABASE_CODES.has(error?.code) || waitMs === undefined) return;
      await delay(waitMs);
    }
  }
}

async function start() {
  await new Promise((resolve, reject) => {
    server = app.listen(env.port, "0.0.0.0", () => {
      console.log(`StudyOS API listening on port ${env.port}`);
      resolve();
    });
    server.once("error", reject);
  });
  await connectWithBoundedRetries();
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing StudyOS API.`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDatabase();
}

process.on("SIGINT", () => shutdown("SIGINT").then(() => process.exit(0)));
process.on("SIGTERM", () => shutdown("SIGTERM").then(() => process.exit(0)));

if (process.env.NODE_ENV !== "test") {
  start().catch(async (error) => {
    console.error("StudyOS API failed to start:", error.code || error.name || "UNKNOWN");
    await closeDatabase().catch(() => {});
    process.exitCode = 1;
  });
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled StudyOS backend rejection:", error?.code || error?.name || "UNKNOWN");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught StudyOS backend exception:", error?.code || error?.name || "UNKNOWN");
  process.exitCode = 1;
  shutdown("uncaughtException").finally(() => process.exit(1));
});

export { app };
