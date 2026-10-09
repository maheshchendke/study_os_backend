import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { ApiError, enumValue, numericValue, objectBody, optionalText } from "../utils/http.js";
import { recordEvent } from "./events.js";
import { createNotification } from "./notifications.js";
import { validateOwnedStudyReferences } from "./entities.js";

function toSession(row) {
  const data = typeof row.data === "object" && row.data ? row.data : {};
  return { ...data, id: String(row.id), task_id: row.task_id, subject_id: row.subject_id, topic_id: row.topic_id,
    duration: Number(row.duration), session_type: row.session_type, started_at: row.started_at, completed_at: row.completed_at,
    status: row.status, notes: row.notes, created_at: row.created_at };
}

async function getSession(userId, id) {
  const [rows] = await pool.execute("SELECT * FROM pomodoro_sessions WHERE id = ? AND user_id = ?", [id, userId]);
  if (!rows.length) throw new ApiError(404, "Pomodoro session not found.", "NOT_FOUND");
  return rows[0];
}

async function validateTask(userId, taskId) {
  if (!taskId) return;
  const [rows] = await pool.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", [String(taskId), userId]);
  if (!rows.length) throw new ApiError(400, "Task not found for this account.", "INVALID_TASK");
}

export async function listPomodoros(userId) {
  const [rows] = await pool.execute("SELECT * FROM pomodoro_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 500", [userId]);
  return rows.map(toSession);
}

export async function startPomodoro(userId, body) {
  const input = objectBody(body);
  const id = input.id == null ? randomUUID() : String(input.id);
  if (!/^[\w-]{1,64}$/.test(id)) throw new ApiError(400, "id is invalid.", "VALIDATION_ERROR");
  const duration = numericValue(input.duration, "duration", { min: 1, max: 1440, optional: false });
  const sessionType = enumValue(input.session_type || input.sessionType || "focus", ["focus", "short_break", "long_break"], "session_type");
  const taskId = input.task_id == null ? null : String(input.task_id);
  await validateTask(userId, taskId);
  await validateOwnedStudyReferences(userId, input.subject_id == null ? null : String(input.subject_id), input.topic_id == null ? null : String(input.topic_id));
  await pool.execute(
    `INSERT INTO pomodoro_sessions (id, user_id, task_id, subject_id, topic_id, duration, session_type, started_at, status, notes, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    [id, userId, taskId, input.subject_id == null ? null : String(input.subject_id), input.topic_id == null ? null : String(input.topic_id),
      duration, sessionType, input.started_at || new Date(), optionalText(input.notes, "notes"), JSON.stringify(input)]
  );
  return toSession(await getSession(userId, id));
}

export async function importPomodoro(userId, body) {
  const input = objectBody(body);
  const id = input.id == null ? randomUUID() : String(input.id);
  if (!/^[\w-]{1,64}$/.test(id)) throw new ApiError(400, "id is invalid.", "VALIDATION_ERROR");
  const duration = numericValue(input.duration ?? input.durationMinutes, "duration", { min: 1, max: 1440, optional: false });
  const sessionType = enumValue(input.session_type || input.sessionType || "focus", ["focus", "short_break", "long_break"], "session_type");
  const status = input.status || (input.completed === false || input.interrupted ? "cancelled" : "completed");
  if (!["running", "completed", "cancelled"].includes(status)) throw new ApiError(400, "status is invalid.", "VALIDATION_ERROR");
  await validateTask(userId, input.task_id || input.taskId);
  await validateOwnedStudyReferences(userId, input.subject_id == null ? null : String(input.subject_id), input.topic_id == null ? null : String(input.topic_id));
  const [existing] = await pool.execute("SELECT id FROM pomodoro_sessions WHERE id=? AND user_id=?", [id, userId]);
  if (!existing.length) {
    await pool.execute(
      `INSERT INTO pomodoro_sessions (id,user_id,task_id,subject_id,topic_id,duration,session_type,started_at,completed_at,status,notes,data)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, userId, input.task_id || input.taskId || null, input.subject_id || null, input.topic_id || null, duration, sessionType,
        input.started_at || input.startTime || new Date(), status === "completed" ? (input.completed_at || input.endTime || new Date()) : null,
        status, optionalText(input.notes || input.note, "notes"), JSON.stringify(input)]
    );
    if (status === "completed" && sessionType === "focus") {
      await recordEvent(userId, "POMODORO_COMPLETED", "pomodoro", id, { duration });
    }
  }
  return toSession(await getSession(userId, id));
}

export async function completePomodoro(userId, id, body = {}) {
  const session = await getSession(userId, id);
  if (session.status !== "running") throw new ApiError(409, "Only a running session can be completed.", "SESSION_NOT_RUNNING");
  await pool.execute("UPDATE pomodoro_sessions SET status = 'completed', completed_at = NOW() WHERE id = ? AND user_id = ?", [id, userId]);
  if (session.session_type === "focus") {
    await recordEvent(userId, "POMODORO_COMPLETED", "pomodoro", id, { duration: Number(session.duration), ...objectBody(body) });
    await createNotification(userId, {
      id: `pomodoro-${id}`,
      type: "pomodoro",
      title: "Focus session complete",
      message: `You completed a ${session.duration}-minute focus session.`,
      related_entity_type: "pomodoro",
      related_entity_id: id,
    });
  }
  return toSession(await getSession(userId, id));
}

export async function cancelPomodoro(userId, id) {
  const session = await getSession(userId, id);
  if (session.status !== "running") throw new ApiError(409, "Only a running session can be cancelled.", "SESSION_NOT_RUNNING");
  await pool.execute("UPDATE pomodoro_sessions SET status = 'cancelled' WHERE id = ? AND user_id = ?", [id, userId]);
  return toSession(await getSession(userId, id));
}

export async function deletePomodoro(userId, id) {
  const session = await getSession(userId, id);
  if (session.status === "running") {
    await pool.execute("UPDATE pomodoro_sessions SET status='cancelled' WHERE id=? AND user_id=?", [id, userId]);
    return;
  }
  await pool.execute("DELETE FROM pomodoro_sessions WHERE id=? AND user_id=?", [id, userId]);
}
