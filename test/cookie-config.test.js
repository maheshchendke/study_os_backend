import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runProductionEnv(override, outputExpression = "env.cookieSameSite") {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: "5000",
    CLIENT_URL: "https://study-osproject.vercel.app",
    DB_HOST: "db.invalid",
    DB_NAME: "studyos",
    DB_USER: "diagnostic-test",
    DB_PASSWORD: "diagnostic-test-only",
  };
  if (override === undefined) delete env.COOKIE_SAME_SITE;
  else if (typeof override === "string") env.COOKIE_SAME_SITE = override;
  else Object.assign(env, override);

  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import { env } from "./src/config/env.js"; process.stdout.write(${outputExpression});`,
  ], { cwd: process.cwd(), env, encoding: "utf8" });
  return result;
}

function loadProductionCookieSameSite(override) {
  const result = runProductionEnv(override);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("production defaults to cross-site cookies while honoring explicit configuration", () => {
  assert.equal(loadProductionCookieSameSite(), "none");
  assert.equal(loadProductionCookieSameSite("lax"), "lax");
});

test("production requires a hostname-only DB_HOST and does not load local defaults", () => {
  const missingHost = runProductionEnv({ DB_HOST: undefined }, "env.database.host");
  assert.notEqual(missingHost.status, 0);
  assert.match(missingHost.stderr, /Missing required environment variable: DB_HOST/);

  const urlHost = runProductionEnv({ DB_HOST: "mysql://user@db.example:3306" }, "env.database.host");
  assert.notEqual(urlHost.status, 0);
  assert.match(urlHost.stderr, /DB_HOST must be a hostname or IP address only/);
});
