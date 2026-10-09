import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { ApiError, dateValue, enumValue, numericValue, optionalText, requiredText, timeValue } from "../utils/http.js";
import { EVENT_FOR_RESOURCE, recordEvent } from "./events.js";

const common = ["id", "user_id", "data", "created_at", "updated_at"];
export const entityConfig = {
  subjects: {
    table: "subjects",
    fields: ["name", "code", "teacher", "credits", "semester", "color", "icon"],
    required: ["name", "code"],
    validate(input) {
      return {
        name: requiredText(input.name, "name", 160),
        code: requiredText(input.code, "code", 32),
        teacher: optionalText(input.teacher, "teacher", 160),
        credits: numericValue(input.credits, "credits", { max: 100 }),
        semester: optionalText(input.semester, "semester", 32),
        color: optionalText(input.color, "color", 32),
        icon: optionalText(input.icon, "icon", 64),
      };
    },
  },
  tasks: {
    table: "tasks",
    fields: ["title", "description", "subject_id", "topic_id", "subject", "priority", "status", "start_date", "due_date", "due_time", "duration_days", "estimated_minutes_per_day", "reminder_minutes", "completed_at"],
    required: ["title"],
    validate(input) {
      const status = enumValue(input.status, ["To Do", "In Progress", "Completed"], "status", "To Do");
      return {
        title: requiredText(input.title, "title"),
        description: optionalText(input.description, "description"),
        subject_id: optionalId(input.subject_id, "subject_id"),
        topic_id: optionalId(input.topic_id, "topic_id"),
        subject: optionalText(input.subject, "subject", 160),
        priority: enumValue(input.priority, ["Low", "Medium", "High"], "priority", "Medium"),
        status,
        start_date: dateValue(input.start_date, "start_date"),
        due_date: dateValue(input.due_date, "due_date"),
        due_time: timeValue(input.due_time, "due_time"),
        duration_days: numericValue(input.duration_days ?? 1, "duration_days", { min: 1, max: 3650, optional: false }) || 1,
        estimated_minutes_per_day: numericValue(input.estimated_minutes_per_day ?? 60, "estimated_minutes_per_day", { min: 1, max: 1440, optional: false }) || 60,
        reminder_minutes: numericValue(input.reminder_minutes, "reminder_minutes", { min: 0, max: 10080 }),
        completed_at: status === "Completed" ? (input.completed_at || new Date()) : null,
      };
    },
  },
  notes: {
    table: "notes",
    fields: ["title", "subject_id", "subject", "topic_id", "note_type", "content", "tags", "attachments", "favorite", "important", "archived", "deleted", "semester", "unit"],
    required: ["title"],
    validate(input) {
      return {
        title: requiredText(input.title, "title"),
        subject_id: optionalId(input.subject_id, "subject_id"),
        subject: optionalText(input.subject, "subject", 160),
        topic_id: optionalId(input.topic_id, "topic_id"),
        note_type: requiredText(input.note_type || input.type || "Class Notes", "note_type", 40),
        content: optionalText(input.content, "content", 2_000_000),
        tags: jsonArray(input.tags, "tags"),
        attachments: jsonArray(input.attachments, "attachments"),
        favorite: bool(input.favorite),
        important: bool(input.important),
        archived: bool(input.archived),
        deleted: bool(input.deleted),
        semester: optionalText(input.semester, "semester", 32),
        unit: optionalText(input.unit, "unit", 32),
      };
    },
  },
  goals: {
    table: "goals",
    fields: ["title", "description", "target", "progress", "deadline", "status", "category", "priority"],
    required: ["title"],
    validate(input) {
      const target = numericValue(input.targetValue ?? input.target, "target", { max: 1_000_000_000 });
      const progress = numericValue(input.progress ?? input.currentValue, "progress", { max: 1_000_000_000 }) ?? 0;
      return {
        title: requiredText(input.title, "title"),
        description: optionalText(input.description, "description"),
        target,
        progress,
        deadline: dateValue(input.deadline, "deadline"),
        status: requiredText(input.status || "Active", "status", 32),
        category: optionalText(input.category, "category", 80),
        priority: optionalText(input.priority, "priority", 32),
      };
    },
  },
  habits: {
    table: "habits",
    fields: ["name", "description", "frequency", "streak", "last_completed"],
    required: ["name"],
    validate(input) {
      return {
        name: requiredText(input.name, "name", 180),
        description: optionalText(input.description, "description"),
        frequency: requiredText(input.frequency || "Daily", "frequency", 40),
        streak: numericValue(input.streak, "streak", { min: 0, max: 100000, optional: false }) || 0,
        last_completed: dateValue(input.last_completed ?? input.lastCompleted, "last_completed"),
      };
    },
  },
  "study-plans": {
    table: "study_plans",
    fields: ["title", "subject_id", "topic_id", "plan_date", "start_time", "end_time", "duration_minutes", "status", "notes", "record_type"],
    required: ["title"],
    validate(input, recordType = "session") {
      return {
        title: requiredText(input.title || input.name || "Study session", "title"),
        subject_id: optionalId(input.subject_id, "subject_id"),
        topic_id: optionalId(input.topic_id, "topic_id"),
        plan_date: dateValue(input.plan_date ?? input.date ?? input.startDate, "plan_date"),
        start_time: timeValue(input.start_time ?? input.startTime, "start_time"),
        end_time: timeValue(input.end_time ?? input.endTime, "end_time"),
        duration_minutes: numericValue(input.duration_minutes ?? input.duration, "duration_minutes", { min: 0, max: 10080 }),
        status: requiredText(input.status || "Planned", "status", 32),
        notes: optionalText(input.notes, "notes"),
        record_type: recordType,
      };
    },
  },
  "placement-topics": {
    table: "placement_topics",
    fields: ["section", "name", "description", "status", "completed_at"],
    required: ["name", "section"],
    validate(input) {
      return {
        section: enumValue(input.section, ["dsa", "java", "core", "aptitude", "interview", "analytics"], "section"),
        name: requiredText(input.name, "name", 180),
        description: optionalText(input.description, "description"),
        status: requiredText(input.status || "Not Started", "status", 32),
        completed_at: input.completed ? (input.completed_at || new Date()) : (input.completed_at || null),
      };
    },
  },
  "placement-roadmaps": {
    table: "placement_roadmaps",
    fields: ["title", "description", "status", "target_date"],
    required: ["title"],
    validate(input) {
      return {
        title: requiredText(input.title, "title", 180),
        description: optionalText(input.description, "description"),
        status: requiredText(input.status || "Active", "status", 32),
        target_date: dateValue(input.target_date ?? input.targetDate, "target_date"),
      };
    },
  },
};

function bool(value) {
  return value === true || value === 1 || value === "1";
}

function optionalId(value, field) {
  if (value == null || value === "") return null;
  const id = String(value);
  if (id.length > 64 || !/^[\w-]+$/.test(id)) {
    throw new ApiError(400, `${field} is invalid.`, "VALIDATION_ERROR");
  }
  return id;
}

function jsonArray(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 1000) {
    throw new ApiError(400, `${field} must be an array.`, "VALIDATION_ERROR");
  }
  return value;
}

export async function validateOwnedStudyReferences(userId, subjectId, topicId) {
  if (subjectId) {
    const [subjects] = await pool.execute("SELECT id FROM subjects WHERE id = ? AND user_id = ?", [subjectId, userId]);
    if (!subjects.length) throw new ApiError(400, "Select a subject that belongs to your account.", "INVALID_SUBJECT");
  }
  if (topicId) {
    const [topics] = await pool.execute("SELECT subject_id FROM topics WHERE id = ? AND user_id = ?", [topicId, userId]);
    if (!topics.length || (subjectId && String(topics[0].subject_id) !== String(subjectId))) {
      throw new ApiError(400, "Select a topic that belongs to your account and subject.", "INVALID_TOPIC");
    }
  }
}

function recordId(input) {
  const id = input.id == null ? randomUUID() : String(input.id);
  if (!/^[\w-]{1,64}$/.test(id)) throw new ApiError(400, "id is invalid.", "VALIDATION_ERROR");
  return id;
}

function parseData(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function serialize(row) {
  const data = parseData(row.data);
  const result = { ...data };
  for (const key of common) {
    if (key !== "data" && row[key] != null) result[key] = row[key];
  }
  for (const [key, value] of Object.entries(row)) {
    if (common.includes(key) || value == null) continue;
    result[key] = value;
  }
  result.id = String(row.id);
  if (row.user_id) result.user_id = row.user_id;
  if (row.updated_at) result.updatedAt = row.updated_at;
  if (row.created_at) result.createdAt = row.created_at;
  if (row.note_type) result.type = row.note_type;
  if (row.plan_date) result.date = row.plan_date;
  if (row.start_time) result.startTime = String(row.start_time).slice(0, 5);
  if (row.end_time) result.endTime = String(row.end_time).slice(0, 5);
  return result;
}

export async function listEntities(resource, userId, { recordType, includeDeleted = false } = {}) {
  const config = entityConfig[resource];
  if (!config) throw new ApiError(404, "Resource not found.", "NOT_FOUND");
  const conditions = ["user_id = ?"];
  const params = [userId];
  if (resource === "study-plans" && recordType) {
    conditions.push("record_type = ?");
    params.push(recordType);
  }
  if (resource === "notes" && !includeDeleted) conditions.push("deleted = 0");
  const [rows] = await pool.execute(
    `SELECT * FROM \`${config.table}\` WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    params
  );
  const records = rows.map(serialize);
  if (resource === "subjects") {
    const ids = records.map((item) => item.id);
    if (ids.length) {
      const [topics] = await pool.execute(
        `SELECT * FROM topics WHERE user_id = ? AND subject_id IN (${ids.map(() => "?").join(",")}) ORDER BY unit, created_at`,
        [userId, ...ids]
      );
      const topicMap = new Map();
      for (const row of topics) {
        const topic = serialize(row);
        const items = topicMap.get(topic.subject_id) || [];
        items.push(topic);
        topicMap.set(topic.subject_id, items);
      }
      return records.map((subject) => ({ ...subject, topics: topicMap.get(subject.id) || [] }));
    }
  }
  return records;
}

export async function getEntity(resource, userId, id, { recordType } = {}) {
  const config = entityConfig[resource];
  if (!config) throw new ApiError(404, "Resource not found.", "NOT_FOUND");
  const extra = resource === "study-plans" && recordType ? " AND record_type = ?" : "";
  const params = resource === "study-plans" && recordType ? [id, userId, recordType] : [id, userId];
  const [rows] = await pool.execute(
    `SELECT * FROM \`${config.table}\` WHERE id = ? AND user_id = ?${extra} LIMIT 1`,
    params
  );
  if (!rows.length) throw new ApiError(404, "Record not found.", "NOT_FOUND");
  const record = serialize(rows[0]);
  if (resource === "subjects") {
    const [topics] = await pool.execute("SELECT * FROM topics WHERE subject_id = ? AND user_id = ? ORDER BY unit, created_at", [id, userId]);
    record.topics = topics.map(serialize);
  }
  return record;
}

async function replaceSubjectTopics(connection, userId, subjectId, topics) {
  if (!Array.isArray(topics)) return;
  const normalizedTopics = topics.filter((topic) => topic?.name).map((topic) => ({ ...topic, id: recordId(topic) }));
  const topicIds = normalizedTopics.map((topic) => topic.id);
  if (topicIds.length) {
    await connection.execute(
      `DELETE FROM topics WHERE user_id=? AND subject_id=? AND id NOT IN (${topicIds.map(() => "?").join(",")})`,
      [userId, subjectId, ...topicIds]
    );
  } else {
    await connection.execute("DELETE FROM topics WHERE user_id=? AND subject_id=?", [userId, subjectId]);
  }
  for (const topic of normalizedTopics) {
    const topicId = topic.id;
    await connection.execute(
      `INSERT INTO topics (id, user_id, subject_id, unit, name, description, completed, completed_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE unit=VALUES(unit), name=VALUES(name), description=VALUES(description),
       completed=VALUES(completed), completed_at=VALUES(completed_at), data=VALUES(data)`,
      [topicId, userId, subjectId, Number(topic.unit) || 1, requiredText(topic.name, "topic name", 180),
        optionalText(topic.description, "topic description"), bool(topic.completed), topic.completed ? (topic.completed_at || new Date()) : null, JSON.stringify(topic)]
    );
  }
}

export async function createEntity(resource, userId, input, { recordType } = {}) {
  const config = entityConfig[resource];
  if (!config) throw new ApiError(404, "Resource not found.", "NOT_FOUND");
  const id = recordId(input);
  const values = config.validate(input, recordType);
  if (["tasks", "notes", "study-plans"].includes(resource)) {
    await validateOwnedStudyReferences(userId, values.subject_id, values.topic_id);
  }
  const fields = config.fields;
  const extraFields = fields.filter((field) => field !== "data");
  const data = JSON.stringify(input);
  const placeholders = [...Array(2 + extraFields.length + 1)].map(() => "?").join(", ");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO \`${config.table}\` (id, user_id, ${extraFields.map((field) => `\`${field}\``).join(", ")}, data)
       VALUES (${placeholders})`,
      [id, userId, ...extraFields.map((field) => values[field] ?? null), data]
    );
    if (resource === "subjects") await replaceSubjectTopics(connection, userId, id, input.topics);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const event = EVENT_FOR_RESOURCE[resource]?.create;
  if (event) await recordEvent(userId, event, resource.slice(0, -1), id, { title: input.title || input.name });
  return getEntity(resource, userId, id, { recordType });
}

export async function updateEntity(resource, userId, id, input, { recordType } = {}) {
  const config = entityConfig[resource];
  if (!config) throw new ApiError(404, "Resource not found.", "NOT_FOUND");
  const current = await getEntity(resource, userId, id, { recordType });
  const merged = { ...current, ...input };
  const values = config.validate(merged, recordType || current.record_type);
  if (["tasks", "notes", "study-plans"].includes(resource)) {
    await validateOwnedStudyReferences(userId, values.subject_id, values.topic_id);
  }
  const fields = config.fields.filter((field) => field !== "data");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE \`${config.table}\` SET ${fields.map((field) => `\`${field}\` = ?`).join(", ")}, data = ?
       WHERE id = ? AND user_id = ?`,
      [...fields.map((field) => values[field] ?? null), JSON.stringify(merged), id, userId]
    );
    if (resource === "subjects" && Object.hasOwn(input, "topics")) {
      await replaceSubjectTopics(connection, userId, id, input.topics);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (resource === "tasks" && current.status !== "Completed" && merged.status === "Completed") {
    await recordEvent(userId, "TASK_COMPLETED", "task", id, { title: merged.title });
  }
  if (resource === "goals" && current.status !== "Completed" && merged.status === "Completed") {
    await recordEvent(userId, "GOAL_COMPLETED", "goal", id, { title: merged.title });
  }
  if (resource === "habits" && Array.isArray(merged.completedDates)) {
    const oldDates = new Set(Array.isArray(current.completedDates) ? current.completedDates : []);
    const completedDate = merged.completedDates.find((date) => !oldDates.has(date));
    if (completedDate) await recordEvent(userId, "HABIT_COMPLETED", "habit", id, { name: merged.name, date: completedDate });
  }
  if (resource === "study-plans" && !current.completed && merged.completed) {
    await recordEvent(userId, "STUDY_SESSION_COMPLETED", "study-session", id, { title: merged.title, duration_minutes: values.duration_minutes });
  }
  return getEntity(resource, userId, id, { recordType });
}

export async function deleteEntity(resource, userId, id, { recordType } = {}) {
  const config = entityConfig[resource];
  if (!config) throw new ApiError(404, "Resource not found.", "NOT_FOUND");
  const current = await getEntity(resource, userId, id, { recordType });
  await pool.execute(`DELETE FROM \`${config.table}\` WHERE id = ? AND user_id = ?`, [id, userId]);
  const event = EVENT_FOR_RESOURCE[resource]?.delete;
  if (event) await recordEvent(userId, event, resource.slice(0, -1), id, { title: current.title || current.name });
}

export async function insertEvent(userId, type, entity, id, metadata = {}) {
  await recordEvent(userId, type, entity, id, metadata);
}
