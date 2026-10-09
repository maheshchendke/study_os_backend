import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { ApiError, numericValue, optionalText, requiredText } from "../utils/http.js";
import { recordEvent } from "./events.js";

function topicId(input) {
  const id = input.id == null ? randomUUID() : String(input.id);
  if (!/^[\w-]{1,64}$/.test(id)) throw new ApiError(400, "id is invalid.", "VALIDATION_ERROR");
  return id;
}

function serialize(row) {
  const data = typeof row.data === "string" ? JSON.parse(row.data || "{}") : (row.data || {});
  return { ...data, id: String(row.id), user_id: row.user_id, subject_id: row.subject_id, unit: row.unit, name: row.name,
    description: row.description, completed: Boolean(row.completed), completed_at: row.completed_at, created_at: row.created_at, updated_at: row.updated_at };
}

async function validateSubject(userId, subjectId) {
  const [rows] = await pool.execute("SELECT id FROM subjects WHERE id = ? AND user_id = ?", [subjectId, userId]);
  if (!rows.length) throw new ApiError(400, "Select a subject that belongs to your account.", "INVALID_SUBJECT");
}

export async function listTopics(userId) {
  const [rows] = await pool.execute("SELECT * FROM topics WHERE user_id = ? ORDER BY created_at DESC", [userId]);
  return rows.map(serialize);
}

export async function getTopic(userId, id) {
  const [rows] = await pool.execute("SELECT * FROM topics WHERE id = ? AND user_id = ?", [id, userId]);
  if (!rows.length) throw new ApiError(404, "Topic not found.", "NOT_FOUND");
  return serialize(rows[0]);
}

export async function createTopic(userId, input) {
  const id = topicId(input);
  const subjectId = String(input.subject_id || input.subjectId || "");
  if (!subjectId) throw new ApiError(400, "subject_id is required.", "VALIDATION_ERROR");
  await validateSubject(userId, subjectId);
  const name = requiredText(input.name, "name", 180);
  const unit = numericValue(input.unit, "unit", { min: 1, max: 100, optional: false });
  await pool.execute(
    `INSERT INTO topics (id, user_id, subject_id, unit, name, description, completed, completed_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, subjectId, unit || 1, name, optionalText(input.description, "description"), Boolean(input.completed),
      input.completed ? (input.completed_at || new Date()) : null, JSON.stringify(input)]
  );
  return getTopic(userId, id);
}

export async function updateTopic(userId, id, input) {
  const current = await getTopic(userId, id);
  const merged = { ...current, ...input };
  const name = requiredText(merged.name, "name", 180);
  const subjectId = String(merged.subject_id || merged.subjectId || "");
  await validateSubject(userId, subjectId);
  const wasCompleted = current.completed;
  const completed = Boolean(merged.completed);
  await pool.execute(
    `UPDATE topics SET subject_id = ?, unit = ?, name = ?, description = ?, completed = ?, completed_at = ?, data = ?
     WHERE id = ? AND user_id = ?`,
    [subjectId, numericValue(merged.unit, "unit", { min: 1, max: 100, optional: false }) || 1, name,
      optionalText(merged.description, "description"), completed, completed ? (merged.completed_at || new Date()) : null,
      JSON.stringify(merged), id, userId]
  );
  if (!wasCompleted && completed) await recordEvent(userId, "PLACEMENT_TOPIC_COMPLETED", "topic", id, { name });
  return getTopic(userId, id);
}

export async function deleteTopic(userId, id) {
  await getTopic(userId, id);
  await pool.execute("DELETE FROM topics WHERE id = ? AND user_id = ?", [id, userId]);
}
