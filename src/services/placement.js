import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { ApiError, objectBody, optionalText, requiredText } from "../utils/http.js";
import { recordEvent } from "./events.js";

function idFor(input) {
  const id = input.id == null ? randomUUID() : String(input.id);
  if (!/^[\w-]{1,64}$/.test(id)) throw new ApiError(400, "id is invalid.", "VALIDATION_ERROR");
  return id;
}

function json(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export async function listPlacementTopics(userId) {
  const [rows] = await pool.execute("SELECT * FROM placement_topics WHERE user_id = ? ORDER BY section, created_at", [userId]);
  return rows.map((row) => ({ ...json(row.data), id: String(row.id), section: row.section, name: row.name, description: row.description, status: row.status, completed: row.status === "Completed", completed_at: row.completed_at }));
}

export async function savePlacementTopic(userId, input, id = null) {
  const body = objectBody(input);
  const topicId = id || idFor(body);
  const section = String(body.section || "").toLowerCase();
  if (!["dsa", "java", "core", "aptitude", "interview", "analytics"].includes(section)) {
    throw new ApiError(400, "section must identify a Placement Hub area.", "VALIDATION_ERROR");
  }
  const name = requiredText(body.name, "name", 180);
  const status = requiredText(body.status || (body.completed ? "Completed" : "Not Started"), "status", 32);
  const completedAt = status === "Completed" ? (body.completed_at || new Date()) : null;
  const [existing] = await pool.execute("SELECT status FROM placement_topics WHERE id = ? AND user_id = ?", [topicId, userId]);
  const params = [topicId, userId, section, name, optionalText(body.description, "description"), status, completedAt, JSON.stringify(body)];
  if (existing.length) {
    await pool.execute(
      `UPDATE placement_topics SET section=?, name=?, description=?, status=?, completed_at=?, data=?
       WHERE id=? AND user_id=?`,
      [...params.slice(2), topicId, userId]
    );
  } else {
    await pool.execute(
      "INSERT INTO placement_topics (id,user_id,section,name,description,status,completed_at,data) VALUES (?,?,?,?,?,?,?,?)",
      params
    );
  }
  if ((!existing.length || existing[0].status !== "Completed") && status === "Completed") {
    await recordEvent(userId, "PLACEMENT_TOPIC_COMPLETED", "placement-topic", topicId, { name, section });
  }
  return { ...body, id: topicId, section, name, status, completed: status === "Completed", completed_at: completedAt };
}

export async function removePlacementTopic(userId, id) {
  const [result] = await pool.execute("DELETE FROM placement_topics WHERE id = ? AND user_id = ?", [id, userId]);
  if (!result.affectedRows) throw new ApiError(404, "Placement topic not found.", "NOT_FOUND");
}

export async function listRoadmaps(userId) {
  const [rows] = await pool.execute("SELECT * FROM placement_roadmaps WHERE user_id = ? ORDER BY created_at DESC", [userId]);
  return rows.map((row) => ({ ...json(row.data), id: String(row.id), title: row.title, description: row.description, status: row.status, target_date: row.target_date }));
}
