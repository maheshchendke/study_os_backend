import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function loadProductionCookieSameSite(override) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: "5000",
    CLIENT_URL: "https://study-os-ashy.vercel.app",
    DB_HOST: "db.invalid",
    DB_NAME: "studyos",
    DB_USER: "diagnostic-test",
    DB_PASSWORD: "diagnostic-test-only",
  };
  if (override === undefined) delete env.COOKIE_SAME_SITE;
  else env.COOKIE_SAME_SITE = override;

  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    'import { env } from "./src/config/env.js"; process.stdout.write(env.cookieSameSite);',
  ], { cwd: process.cwd(), env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("production defaults to cross-site cookies while honoring explicit configuration", () => {
  assert.equal(loadProductionCookieSameSite(), "none");
  assert.equal(loadProductionCookieSameSite("lax"), "lax");
});
