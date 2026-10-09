import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { securityHeaders } from "../src/middleware/security.js";

test("securityHeaders middleware attaches strict headers to responses", async () => {
  const app = express();
  app.use(securityHeaders);
  app.get("/test", (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/test`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal(res.headers.get("content-security-policy"), "default-src 'none'");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

