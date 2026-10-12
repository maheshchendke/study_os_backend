import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config/database.js";
import { parseAssistantResponse, AI_SYSTEM_PROMPT } from "../src/services/ai.js";

test.after(async () => pool.end());

test("plain Markdown answer preserves multiline code and is not forced into JSON", () => {
  const answer = "Here is Java.\n\n```java\nclass Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hi\");\n    }\n}\n```";
  assert.deepEqual(parseAssistantResponse(answer), { message: answer, action: null });
  assert.match(parseAssistantResponse(answer).message, /\n    public static/);
});

test("trailing StudyOS action metadata is removed and validated", () => {
  const answer = "I’ll add that task.\n\n```studyos-action\n{\"type\":\"createTask\",\"data\":{\"title\":\"Finish DSA sheet\",\"subject\":\"DSA\",\"due_date\":\"2026-10-10\"}}\n```";
  const parsed = parseAssistantResponse(answer);
  assert.equal(parsed.message, "I’ll add that task.");
  assert.equal(parsed.action.type, "createTask");
  assert.throws(() => parseAssistantResponse("```studyos-action\n{\"type\":\"unknown\",\"data\":{}}\n```"), /invalid workspace action/);
});

test("prompt supports general questions and relevant-only personal context", () => {
  assert.match(AI_SYSTEM_PROMPT, /general-purpose assistant/);
  assert.match(AI_SYSTEM_PROMPT, /only when the user asks about their progress or plans/);
});

test("unconfigured AI service throws structured ApiError 503 rather than ReferenceError", async () => {
  const { env } = await import("../src/config/env.js");
  const originalKey = env.ai.apiKey;
  try {
    env.ai.apiKey = "";
    const { chat } = await import("../src/services/ai.js");
    await assert.rejects(
      async () => {
        await chat("00000000-0000-0000-0000-000000000000", { message: "Hello AI" });
      },
      (err) => {
        assert.notEqual(err.name, "ReferenceError");
        return err.code === "AI_NOT_CONFIGURED" && err.status === 503;
      }
    );
  } finally {
    env.ai.apiKey = originalKey;
  }
});
