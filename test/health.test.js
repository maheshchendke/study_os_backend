import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.NODE_ENV = "test";
const { app } = await import("../src/server.js");
const { pool, closeDatabase } = await import("../src/config/database.js");

test.after(async () => closeDatabase());

test("liveness stays healthy without making a database connection", async () => {
  const originalGetConnection = pool.getConnection;
  pool.getConnection = async () => {
    throw Object.assign(new Error("database unavailable"), { code: "ENOTFOUND" });
  };
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health/live`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.status, "alive");
  } finally {
    pool.getConnection = originalGetConnection;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("readiness reports database failures as unavailable", async () => {
  const originalGetConnection = pool.getConnection;
  pool.getConnection = async () => {
    throw Object.assign(new Error("database unavailable"), { code: "ENOTFOUND" });
  };
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    for (const path of ["/api/health", "/api/health/ready"]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.equal(payload.code, "DATABASE_UNAVAILABLE");
    }
  } finally {
    pool.getConnection = originalGetConnection;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("readiness reports the database as connected when ping succeeds", async () => {
  const originalGetConnection = pool.getConnection;
  let released = false;
  pool.getConnection = async () => ({
    async ping() {},
    release() { released = true; },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health/ready`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.database, "connected");
    assert.equal(released, true);
  } finally {
    pool.getConnection = originalGetConnection;
    await new Promise((resolve) => server.close(resolve));
  }
});
