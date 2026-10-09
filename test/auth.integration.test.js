import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
const { app } = await import("../src/server.js");
const { pool, closeDatabase } = await import("../src/config/database.js");

const origin = "http://localhost:5173";
const suffix = randomUUID().slice(0, 8);
const emailA = `studyos-auth-a-${suffix}@example.test`;
const emailB = `studyos-auth-b-${suffix}@example.test`;
const validationEmail = `studyos-auth-validation-${suffix}@example.test`;
const password = "correct horse study routine 73";
const notificationId = `isolation-${suffix}`;
const subjectId = `subject-${suffix}`;
let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.execute("DELETE FROM users WHERE email IN (?, ?, ?)", [emailA, emailB, validationEmail]);
  const [remaining] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE email IN (?, ?, ?)", [emailA, emailB, validationEmail]);
  assert.equal(Number(remaining[0].count), 0);
  await closeDatabase();
});

async function request(path, { method = "GET", body, cookie, originHeader = origin } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Origin: originHeader,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  const setCookie = response.headers.get("set-cookie");
  return {
    status: response.status,
    payload,
    cookie: setCookie ? setCookie.split(";", 1)[0] : cookie,
    setCookie,
    corsCredentials: response.headers.get("access-control-allow-credentials"),
    headers: { retryAfter: response.headers.get("retry-after") },
  };
}

test("auth validation, conflict, generic credentials, and rate limiting use the expected status codes", async () => {
  const invalidRegistration = await request("/auth/register", { method: "POST", body: { name: "", email: "bad", password: "short" } });
  assert.equal(invalidRegistration.status, 422);
  assert.ok(invalidRegistration.payload.errors?.email);

  const invalidLogin = await request("/auth/login", { method: "POST", body: { email: "bad", password: "short" } });
  assert.equal(invalidLogin.status, 400);

  const first = await request("/auth/register", { method: "POST", body: { name: "Conflict Check", email: validationEmail, password } });
  assert.equal(first.status, 201);
  const duplicate = await request("/auth/register", { method: "POST", body: { name: "Conflict Check", email: validationEmail, password } });
  assert.equal(duplicate.status, 409);

  const wrongLogin = await request("/auth/login", { method: "POST", body: { email: validationEmail, password: "wrong password value 123" } });
  assert.equal(wrongLogin.status, 401);
  assert.equal(wrongLogin.payload.message, "Email or password is incorrect.");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await request("/auth/login", { method: "POST", body: { email: validationEmail, password: "another wrong password 123" } });
  }
  const limited = await request("/auth/login", { method: "POST", body: { email: validationEmail, password: "another wrong password 123" } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers?.retryAfter || limited.payload?.retryAfter) >= 1);
});

test("register, login, restore, logout, and isolate two users", async () => {
  assert.equal((await request("/auth/me")).status, 401);
  assert.equal((await request("/tasks")).status, 401);
  assert.equal((await request("/auth/register", {
    method: "POST",
    originHeader: "https://untrusted.example",
    body: { name: "Blocked Origin", email: `blocked-${suffix}@example.test`, password },
  })).status, 403);

  const registrationA = await request("/auth/register", {
    method: "POST",
    body: { name: "Auth Test A", email: emailA, password },
  });
  assert.equal(registrationA.status, 201);
  assert.equal(registrationA.payload.data.user.email, emailA);
  assert.equal(registrationA.corsCredentials, "true");
  assert.match(registrationA.setCookie, /HttpOnly/i);
  assert.match(registrationA.setCookie, /SameSite=Lax/i);
  let cookieA = registrationA.cookie;
  const userAId = registrationA.payload.data.user.id;
  const sessionToken = cookieA.slice(cookieA.indexOf("=") + 1);

  const [accountRows] = await pool.execute("SELECT password_hash FROM users WHERE id = ?", [userAId]);
  assert.match(accountRows[0].password_hash, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(accountRows[0].password_hash, password);
  const [sessionRows] = await pool.execute("SELECT token_hash FROM user_sessions WHERE user_id = ?", [userAId]);
  assert.equal(sessionRows.length, 1);
  assert.notEqual(sessionRows[0].token_hash, sessionToken);
  assert.match(sessionRows[0].token_hash, /^[a-f0-9]{64}$/);

  const restoredA = await request("/auth/me", { cookie: cookieA });
  assert.equal(restoredA.status, 200);
  assert.equal(restoredA.payload.data.user.id, userAId);

  const recordA = await request("/notifications", {
    method: "POST",
    cookie: cookieA,
    body: { id: notificationId, title: "Private A", message: "Only account A", user_id: "spoofed-id" },
  });
  assert.equal(recordA.status, 200);
  const subjectA = await request("/subjects", {
    method: "POST",
    cookie: cookieA,
    body: { id: subjectId, name: "Private subject A", code: `A${suffix}` },
  });
  assert.equal(subjectA.status, 200);
  assert.equal((await request("/topics", {
    method: "POST",
    cookie: cookieA,
    body: { id: `topic-${suffix}`, subject_id: subjectId, name: "Private topic A", unit: 1 },
  })).status, 200);
  const taskA = await request("/tasks", {
    method: "POST",
    cookie: cookieA,
    body: { id: `task-${suffix}`, title: "Private task A", subject_id: subjectId },
  });
  assert.equal(taskA.status, 200);
  const scopedResources = [
    ["notes", { id: `note-${suffix}`, title: "Private note A", content: "A only" }],
    ["goals", { id: `goal-${suffix}`, title: "Private goal A" }],
    ["habits", { id: `habit-${suffix}`, name: "Private habit A", streak: 0 }],
    ["study-plans/sessions", { id: `plan-${suffix}`, title: "Private plan A" }],
    ["pomodoros", { id: `pomodoro-${suffix}`, duration: 25, session_type: "focus" }],
    ["placement/topics", { id: `placement-${suffix}`, section: "dsa", name: "Private placement A" }],
    ["placement/roadmaps", { id: `roadmap-${suffix}`, title: "Private roadmap A" }],
  ];
  for (const [path, body] of scopedResources) {
    const createPath = path === "study-plans/sessions" ? "/study-plans/sessions" : `/${path}`;
    assert.equal((await request(createPath, { method: "POST", cookie: cookieA, body })).status, 200, `could not create ${path}`);
  }
  await pool.execute(
    "INSERT INTO ai_actions (id,user_id,action_type,request,structured_action,status) VALUES (?,?,?,? ,?,'pending_confirmation')",
    [`action-${suffix}`, userAId, "deleteTask", "test isolation", JSON.stringify({ type: "deleteTask", data: { id: `task-${suffix}` } })]
  );

  const logoutA = await request("/auth/logout", { method: "POST", cookie: cookieA });
  assert.equal(logoutA.status, 200);
  assert.equal((await request("/auth/me", { cookie: cookieA })).status, 401);

  const loginA = await request("/auth/login", {
    method: "POST",
    body: { email: emailA.toUpperCase(), password },
  });
  assert.equal(loginA.status, 200);
  cookieA = loginA.cookie;
  assert.equal((await request("/auth/login", { method: "POST", body: { email: emailA, password: "wrong password here" } })).status, 401);

  const registrationB = await request("/auth/register", {
    method: "POST",
    body: { name: "Auth Test B", email: emailB, password },
  });
  assert.equal(registrationB.status, 201);
  const cookieB = registrationB.cookie;
  const userBId = registrationB.payload.data.user.id;
  assert.notEqual(userBId, userAId);

  assert.equal((await request(`/subjects/${subjectId}`, { cookie: cookieB })).status, 404);
  const privateCollections = ["subjects", "topics", "tasks", "notes", "goals", "habits", "study-plans/sessions", "pomodoros", "notifications", "placement/topics", "placement/roadmaps"];
  for (const path of privateCollections) {
    const collection = await request(`/${path}`, { cookie: cookieB });
    assert.equal(collection.status, 200, `could not list ${path}`);
    assert.deepEqual(collection.payload.data, [], `${path} leaked account A data`);
  }
  assert.equal((await request("/analytics", { cookie: cookieB })).payload.data.tasks.total, 0);
  assert.equal((await request("/analytics", { cookie: cookieA })).payload.data.tasks.total, 1);
  const crossUserAiConfirm = await request("/ai/chat", {
    method: "POST",
    cookie: cookieB,
    body: { message: "confirm", confirmationId: `action-${suffix}`, confirm: true },
  });
  assert.equal(crossUserAiConfirm.status, 404);
  const crossUserReference = await request("/tasks", {
    method: "POST",
    cookie: cookieB,
    body: { title: "Cross account reference", subject_id: subjectId },
  });
  assert.equal(crossUserReference.status, 400);
  assert.equal((await request(`/tasks/task-${suffix}`, {
    method: "PUT",
    cookie: cookieB,
    body: { title: "Unauthorized update" },
  })).status, 404);

  const listB = await request("/notifications", { cookie: cookieB });
  assert.equal(listB.status, 200);
  assert.deepEqual(listB.payload.data, []);
  const leaderboardB = await request("/leaderboard?period=all", { cookie: cookieB });
  assert.equal(leaderboardB.status, 200);
  assert.deepEqual(leaderboardB.payload.data.map((row) => row.id), [userBId]);

  const duplicateForeignId = await request("/notifications", {
    method: "POST",
    cookie: cookieB,
    body: { id: notificationId, title: "Attempted overwrite", message: "Must not replace account A" },
  });
  assert.equal(duplicateForeignId.status, 409);
  assert.equal((await request(`/notifications/${notificationId}/read`, { method: "PUT", cookie: cookieB })).status, 404);

  const crossUserDelete = await request(`/notifications/${notificationId}`, { method: "DELETE", cookie: cookieB });
  assert.equal(crossUserDelete.status, 404);
  const listA = await request("/notifications", { cookie: cookieA });
  assert.equal(listA.status, 200);
  assert.equal(listA.payload.data.some((item) => item.id === notificationId && item.title === "Private A"), true);

  const spoofedCreateB = await request("/notifications", {
    method: "POST",
    cookie: cookieB,
    body: { id: `spoof-${suffix}`, title: "Private B", message: "Owner comes from session", user_id: userAId },
  });
  assert.equal(spoofedCreateB.status, 200);
  const listBAfter = await request("/notifications", { cookie: cookieB });
  assert.equal(listBAfter.payload.data.some((item) => item.id === `spoof-${suffix}`), true);

  assert.equal((await request("/auth/logout", { method: "POST", cookie: cookieB })).status, 200);
  assert.equal((await request("/auth/me", { cookie: cookieB })).status, 401);
});
