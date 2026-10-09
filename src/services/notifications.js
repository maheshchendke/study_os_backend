import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { ApiError, objectBody, optionalText, requiredText } from "../utils/http.js";

function parseData(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function toNotification(row) {
  return {
    ...parseData(row.data),
    id: String(row.id),
    type: row.type,
    title: row.title,
    message: row.message,
    text: row.message,
    read: Boolean(row.read_at),
    read_at: row.read_at,
    createdAt: row.created_at,
    time: row.created_at,
    related_entity_type: row.related_entity_type,
    related_entity_id: row.related_entity_id,
  };
}

export async function listNotifications(userId) {
  const [rows] = await pool.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 500", [userId]);
  return rows.map(toNotification);
}

export async function createNotification(userId, body) {
  const input = objectBody(body);
  const id = input.id == null ? randomUUID() : String(input.id);
  if (!/^[\w-]{1,64}$/.test(id)) throw new ApiError(400, "id is invalid.", "VALIDATION_ERROR");
  const type = requiredText(input.type || "general", "type", 48);
  const title = requiredText(input.title, "title", 180);
  const message = requiredText(input.message || input.text, "message", 2000);
  const relatedType = optionalText(input.related_entity_type, "related_entity_type", 40);
  const relatedId = input.related_entity_id == null ? null : String(input.related_entity_id);
  const data = JSON.stringify(input);
  const [existing] = await pool.execute("SELECT id FROM notifications WHERE id = ? AND user_id = ?", [id, userId]);
  if (existing.length) {
    await pool.execute(
      `UPDATE notifications SET type=?, title=?, message=?, related_entity_type=?, related_entity_id=?, data=?
       WHERE id=? AND user_id=?`,
      [type, title, message, relatedType, relatedId, data, id, userId]
    );
  } else {
    try {
      await pool.execute(
        `INSERT INTO notifications (id, user_id, type, title, message, read_at, related_entity_type, related_entity_id, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, type, title, message, input.read ? (input.read_at || new Date()) : null,
          relatedType, relatedId, data]
      );
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") throw new ApiError(409, "A notification with that ID already exists.", "CONFLICT");
      throw error;
    }
  }
  const [rows] = await pool.execute("SELECT * FROM notifications WHERE id = ? AND user_id = ?", [id, userId]);
  return toNotification(rows[0]);
}

export async function markRead(userId, id) {
  const [result] = await pool.execute("UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?", [id, userId]);
  if (!result.affectedRows) throw new ApiError(404, "Notification not found.", "NOT_FOUND");
}

export async function markAllRead(userId) {
  await pool.execute("UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL", [userId]);
}

export async function removeNotification(userId, id) {
  const [result] = await pool.execute("DELETE FROM notifications WHERE id = ? AND user_id = ?", [id, userId]);
  if (!result.affectedRows) throw new ApiError(404, "Notification not found.", "NOT_FOUND");
}
