import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { checkDatabase, closeDatabase } from "./config/database.js";
import { authenticate, requireSameOrigin } from "./middleware/authenticate.js";
import { securityHeaders } from "./middleware/security.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { asyncHandler, sendSuccess } from "./utils/http.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";

const app = express();

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
app.get("/api/health", asyncHandler(async (req, res) => {
  await checkDatabase();
  return sendSuccess(res, { database: "connected" }, "StudyOS API is running");
}));
app.use("/api", requireSameOrigin, authenticate, apiRoutes);
app.use(notFound);
app.use(errorHandler);

let server;
let shuttingDown = false;

async function start() {
  await checkDatabase();
  server = app.listen(env.port, "0.0.0.0", () => {
    console.log(`StudyOS API listening on port ${env.port}`);
  });
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
    const databaseCodes = new Set(["ECONNREFUSED", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"]);
    if (databaseCodes.has(error.code)) {
      console.error("StudyOS could not connect to MySQL. Check backend/.env values DB_PASSWORD, DB_HOST, and DB_NAME.", error.code);
    } else {
      console.error("StudyOS API startup failed:", error.code || error.name || "UNKNOWN");
    }
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
