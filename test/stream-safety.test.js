import test from "node:test";
import assert from "node:assert/strict";
import { streamChat } from "../src/services/ai.js";
import { env } from "../src/config/env.js";
import { pool } from "../src/config/database.js";

test("streamChat requires confirmation and blocks direct execution for delete actions", async () => {
  const originalFetch = globalThis.fetch;
  const originalExecute = pool.execute;
  const originalKey = env.ai.apiKey;
  const originalModel = env.ai.model;

  env.ai.apiKey = "test-key";
  env.ai.model = "test-model";

  let loggedActionStatus = null;
  let deletedExecuted = false;

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO ai_actions")) {
      loggedActionStatus = params[5]; // status column
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("DELETE FROM tasks")) {
      deletedExecuted = true;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("pomodoro_sessions") || sql.includes("habits") || sql.includes("tasks") || sql.includes("subjects") || sql.includes("goals") || sql.includes("analytics_events")) {
      if (sql.includes("SELECT COUNT") || sql.includes("SELECT COALESCE") || sql.includes("COALESCE(SUM")) {
        return [[{ count: 0, total: 0, completed: 0, minutes: 0, sessions: 0, bestStreak: 0, xp: 0 }], []];
      }
      return [[], []];
    }
    return [[], []];
  };

  const deleteActionPayload = JSON.stringify({
    type: "deleteTask",
    data: { id: "task-123" },
  });

  const deltaContent = `I am deleting that task.\n\n\`\`\`studyos-action\n${deleteActionPayload}\n\`\`\`\n`;
  const sseContent = `data: ${JSON.stringify({ choices: [{ delta: { content: deltaContent } }] })}\n\ndata: [DONE]\n\n`;

  globalThis.fetch = async () => {
    return new Response(sseContent, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const events = [];
    const response = await streamChat(
      "user-1",
      { message: "Delete task task-123" },
      (evt) => events.push(evt)
    );

    // Destructive actions must require confirmation
    assert.equal(response.confirmationRequired, true);
    assert.equal(typeof response.confirmationId, "string");
    assert.equal(response.action, "deleteTask");
    assert.equal(loggedActionStatus, "pending_confirmation");
    assert.equal(deletedExecuted, false, "Delete must NOT be executed immediately during streaming");
  } finally {
    globalThis.fetch = originalFetch;
    pool.execute = originalExecute;
    env.ai.apiKey = originalKey;
    env.ai.model = originalModel;
  }
});

test("streamChat cancels and aborts on stream timeout", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = env.ai.apiKey;
  const originalModel = env.ai.model;
  const originalTimeout = env.ai.streamTimeoutMs;

  env.ai.apiKey = "test-key";
  env.ai.model = "test-model";
  env.ai.streamTimeoutMs = 50; // short 50ms timeout for test

  globalThis.fetch = async (url, options) => {
    // Hang until signal aborted
    return new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  };

  try {
    await assert.rejects(
      async () => {
        await streamChat("user-1", { message: "Test timeout" }, () => {});
      },
      (err) => {
        return err.code === "AI_TIMEOUT" && err.status === 504;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    env.ai.apiKey = originalKey;
    env.ai.model = originalModel;
    env.ai.streamTimeoutMs = originalTimeout;
  }
});
