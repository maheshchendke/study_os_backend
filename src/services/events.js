import { pool } from "../config/database.js";

export async function recordEvent(userId, eventType, entityType = null, entityId = null, metadata = {}) {
  await pool.execute(
    `INSERT INTO analytics_events (user_id, event_type, entity_type, entity_id, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, eventType, entityType, entityId == null ? null : String(entityId), JSON.stringify(metadata)]
  );
}

export const EVENT_FOR_RESOURCE = {
  tasks: { create: "TASK_CREATED", delete: "TASK_DELETED" },
  notes: { create: "NOTE_CREATED" },
  goals: { create: "GOAL_CREATED" },
};
