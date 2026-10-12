import test from "node:test";
import assert from "node:assert/strict";
import { entityConfig } from "../src/services/entities.js";
import { ApiError, dateValue, objectBody, requiredText } from "../src/utils/http.js";
import { closeDatabase } from "../src/config/database.js";

test.after(async () => closeDatabase());

test("task validation keeps supported API fields and defaults", () => {
  const task = entityConfig.tasks.validate({
    title: "  Review arrays  ",
    status: "To Do",
    priority: "High",
    due_date: "2026-04-20",
  });

  assert.equal(task.title, "Review arrays");
  assert.equal(task.priority, "High");
  assert.equal(task.status, "To Do");
  assert.equal(task.due_date, "2026-04-20");
  assert.equal(task.duration_days, 1);
  assert.equal(task.estimated_minutes_per_day, 60);
});

test("task validation rejects unsupported status values", () => {
  assert.throws(
    () => entityConfig.tasks.validate({ title: "Review arrays", status: "Pending" }),
    (error) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
});

test("date validation rejects impossible calendar dates", () => {
  assert.throws(
    () => dateValue("2025-02-31", "due_date"),
    (error) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
});

test("request validators reject malformed bodies and blank required text", () => {
  assert.throws(
    () => objectBody([]),
    (error) => error instanceof ApiError && error.code === "INVALID_BODY",
  );
  assert.throws(
    () => requiredText("  ", "title"),
    (error) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
});
