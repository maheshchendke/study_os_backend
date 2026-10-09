import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { pool } from "../config/database.js";
import { asyncHandler, ApiError, objectBody, sendSuccess } from "../utils/http.js";
import { entityRoutes } from "./entityRoutes.js";
import { entityController } from "../controllers/entities.js";
import { getEntity, listEntities, createEntity, updateEntity, deleteEntity } from "../services/entities.js";
import { createTopic, deleteTopic, getTopic, listTopics, updateTopic } from "../services/topics.js";
import { getAnalytics, getLeaderboard } from "../services/analytics.js";
import { getDashboard } from "../services/dashboard.js";
import { chat, streamChat } from "../services/ai.js";
import { cancelPomodoro, completePomodoro, deletePomodoro, importPomodoro, listPomodoros, startPomodoro } from "../services/pomodoros.js";
import { listNotifications, createNotification, markAllRead, markRead, removeNotification } from "../services/notifications.js";
import { listPlacementTopics, listRoadmaps, removePlacementTopic, savePlacementTopic } from "../services/placement.js";

const router = Router();
const aiChatLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user.id), message: { success: false, message: "AI requests are limited. Please try again shortly.", code: "AI_RATE_LIMITED", error: "AI_RATE_LIMITED" } });

router.get("/subjects", asyncHandler(async (req, res) => sendSuccess(res, await listEntities("subjects", req.user.id))));
router.get("/subjects/:id", asyncHandler(async (req, res) => sendSuccess(res, await getEntity("subjects", req.user.id, req.params.id))));
router.post("/subjects", asyncHandler(async (req, res) => {
  const result = await createEntity("subjects", req.user.id, objectBody(req.body));
  return sendSuccess(res, result, "Subject created.");
}));
router.put("/subjects/:id", asyncHandler(async (req, res) => {
  const result = await updateEntity("subjects", req.user.id, req.params.id, objectBody(req.body));
  return sendSuccess(res, result, "Subject updated.");
}));
router.delete("/subjects/:id", asyncHandler(async (req, res) => {
  await deleteEntity("subjects", req.user.id, req.params.id);
  return res.json({ success: true, data: null, message: "Subject deleted." });
}));

router.get("/tasks/stats", asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total,
      SUM(status='Completed') AS complete,
      SUM(status='In Progress') AS inProgress,
      SUM(status='To Do') AS remaining,
      SUM(status<>'Completed' AND due_date<CURRENT_DATE()) AS overdue
     FROM tasks WHERE user_id = ?`,
    [req.user.id]
  );
  const row = rows[0];
  return sendSuccess(res, Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)])));
}));
router.use("/tasks", taskRouter());

router.use("/topics", topicRouter());
router.use("/notes", entityRoutes("notes"));
router.use("/goals", entityRoutes("goals"));
router.use("/habits", habitRouter());
router.use("/study-plans", studyPlanRouter());
router.use("/pomodoros", pomodoroRouter());
router.use("/notifications", notificationRouter());
router.use("/placement", placementRouter());
router.use("/analytics", analyticsRouter());
router.get("/dashboard", asyncHandler(async (req, res) => sendSuccess(res, await getDashboard(req.user.id))));
router.get("/leaderboard", asyncHandler(async (req, res) => {
  const period = ["week", "month", "all"].includes(req.query.period) ? req.query.period : "all";
  return sendSuccess(res, await getLeaderboard(req.user.id, period));
}));
router.post("/ai/chat", aiChatLimiter, asyncHandler(async (req, res) => sendSuccess(res, await chat(req.user.id, req.body), "AI response ready.")));
router.post("/ai/chat/stream", aiChatLimiter, asyncHandler(async (req, res) => {
  res.status(200);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  try {
    await streamChat(req.user.id, req.body, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`), controller.signal);
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: "error", message: error.message, status: error.status || 500, code: error.code || "AI_ERROR" })}\n\n`);
  } finally { res.end(); }
}));

router.get("/profile", asyncHandler(async (req, res) => {
  const [rows] = await pool.execute("SELECT id,name,email,role,created_at,updated_at FROM users WHERE id=?", [req.user.id]);
  if (!rows.length) throw new ApiError(404, "User not found.", "NOT_FOUND");
  return sendSuccess(res, rows[0]);
}));
router.put("/profile", asyncHandler(async (req, res) => {
  const input = objectBody(req.body);
  const name = String(input.name || "").trim();
  if (!name || name.length > 100) throw new ApiError(400, "name is required.", "VALIDATION_ERROR");
  if (Object.hasOwn(input, "email")) {
    const email = input.email == null || input.email === "" ? null : String(input.email).trim();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new ApiError(400, "email is invalid.", "VALIDATION_ERROR");
    await pool.execute("UPDATE users SET name=?, email=? WHERE id=?", [name, email, req.user.id]);
  } else {
    await pool.execute("UPDATE users SET name=? WHERE id=?", [name, req.user.id]);
  }
  const [rows] = await pool.execute("SELECT id,name,email,role,created_at,updated_at FROM users WHERE id=?", [req.user.id]);
  return sendSuccess(res, rows[0], "Profile updated.");
}));
router.delete("/data", asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const table of [
      "tasks", "pomodoro_sessions", "study_plans", "notes", "goals", "habits",
      "placement_topics", "placement_roadmaps", "notifications", "analytics_events",
      "ai_actions", "topics", "subjects",
    ]) {
      await connection.execute(`DELETE FROM \`${table}\` WHERE user_id = ?`, [req.user.id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return sendSuccess(res, null, "Study data cleared.");
}));

function taskRouter() {
  const child = Router();
  const controller = entityController("tasks");
  child.get("/", asyncHandler(controller.list));
  child.get("/:id", asyncHandler(controller.get));
  child.post("/", asyncHandler(controller.create));
  child.put("/:id", asyncHandler(controller.update));
  child.delete("/:id", asyncHandler(controller.remove));
  return child;
}

function topicRouter() {
  const child = Router();
  child.get("/", asyncHandler(async (req, res) => sendSuccess(res, await listTopics(req.user.id))));
  child.get("/:id", asyncHandler(async (req, res) => sendSuccess(res, await getTopic(req.user.id, req.params.id))));
  child.post("/", asyncHandler(async (req, res) => sendSuccess(res, await createTopic(req.user.id, req.body), "Topic created.")));
  child.put("/:id", asyncHandler(async (req, res) => sendSuccess(res, await updateTopic(req.user.id, req.params.id, req.body), "Topic updated.")));
  child.delete("/:id", asyncHandler(async (req, res) => { await deleteTopic(req.user.id, req.params.id); res.json({ success: true, data: null, message: "Topic deleted." }); }));
  return child;
}

function habitRouter() {
  const child = entityRoutes("habits");
  child.post("/:id/complete", asyncHandler(async (req, res) => {
    const id = req.params.id;
    const [rows] = await pool.execute("SELECT * FROM habits WHERE id=? AND user_id=?", [id, req.user.id]);
    if (!rows.length) throw new ApiError(404, "Habit not found.", "NOT_FOUND");
    const current = typeof rows[0].data === "object" && rows[0].data ? rows[0].data : {};
    const today = new Date().toISOString().slice(0, 10);
    const completions = Array.isArray(current.completions) ? current.completions : [];
    if (!completions.includes(today)) completions.push(today);
    const updated = { ...current, name: rows[0].name, streak: Number(rows[0].streak || 0) + 1, last_completed: today, completions };
    const { updateEntity } = await import("../services/entities.js");
    const result = await updateEntity("habits", req.user.id, id, updated);
    const { recordEvent } = await import("../services/events.js");
    await recordEvent(req.user.id, "HABIT_COMPLETED", "habit", id, { name: rows[0].name });
    return sendSuccess(res, result, "Habit completed.");
  }));
  return child;
}

function studyPlanRouter() {
  const child = Router();
  const getType = (req) => req.query.type || "session";
  for (const type of ["sessions", "plans", "timetable"]) {
    const recordType = type === "sessions" ? "session" : type === "plans" ? "plan" : "timetable";
    child.put(`/${type}/:id`, asyncHandler(async (req, res) => sendSuccess(res, await updateEntity("study-plans", req.user.id, req.params.id, req.body, { recordType }), "Study plan record updated.")));
    child.delete(`/${type}/:id`, asyncHandler(async (req, res) => { await deleteEntity("study-plans", req.user.id, req.params.id, { recordType }); return sendSuccess(res, null, "Study plan record deleted."); }));
  }
  child.get("/sessions/:id", asyncHandler(async (req, res) => sendSuccess(res, await getEntity("study-plans", req.user.id, req.params.id, { recordType: "session" }))));
  child.get("/plans/:id", asyncHandler(async (req, res) => sendSuccess(res, await getEntity("study-plans", req.user.id, req.params.id, { recordType: "plan" }))));
  child.get("/timetable/:id", asyncHandler(async (req, res) => sendSuccess(res, await getEntity("study-plans", req.user.id, req.params.id, { recordType: "timetable" }))));
  child.get("/", asyncHandler(async (req, res) => sendSuccess(res, await listEntities("study-plans", req.user.id, { recordType: req.query.type || undefined }))));
  child.get("/sessions", asyncHandler(async (req, res) => sendSuccess(res, await listEntities("study-plans", req.user.id, { recordType: "session" }))));
  child.get("/plans", asyncHandler(async (req, res) => sendSuccess(res, await listEntities("study-plans", req.user.id, { recordType: "plan" }))));
  child.get("/timetable", asyncHandler(async (req, res) => sendSuccess(res, await listEntities("study-plans", req.user.id, { recordType: "timetable" }))));
  child.post("/sessions", asyncHandler(async (req, res) => {
    const { createEntity } = await import("../services/entities.js");
    return sendSuccess(res, await createEntity("study-plans", req.user.id, req.body, { recordType: "session" }), "Study session created.");
  }));
  child.post("/plans", asyncHandler(async (req, res) => {
    const { createEntity } = await import("../services/entities.js");
    return sendSuccess(res, await createEntity("study-plans", req.user.id, req.body, { recordType: "plan" }), "Study plan created.");
  }));
  child.post("/timetable", asyncHandler(async (req, res) => {
    return sendSuccess(res, await createEntity("study-plans", req.user.id, req.body, { recordType: "timetable" }), "Timetable entry created.");
  }));
  child.get("/:id", asyncHandler(async (req, res) => sendSuccess(res, await getEntity("study-plans", req.user.id, req.params.id, { recordType: getType(req) }))));
  child.post("/", asyncHandler(async (req, res) => {
    return sendSuccess(res, await createEntity("study-plans", req.user.id, req.body, { recordType: getType(req) }), "Study plan record created.");
  }));
  child.put("/:id", asyncHandler(async (req, res) => sendSuccess(res, await updateEntity("study-plans", req.user.id, req.params.id, req.body, { recordType: getType(req) }), "Study plan record updated.")));
  child.delete("/:id", asyncHandler(async (req, res) => {
    await deleteEntity("study-plans", req.user.id, req.params.id, { recordType: getType(req) });
    res.json({ success: true, data: null, message: "Study plan record deleted." });
  }));
  return child;
}

function pomodoroRouter() {
  const child = Router();
  child.get("/", asyncHandler(async (req, res) => sendSuccess(res, await listPomodoros(req.user.id))));
  child.post("/", asyncHandler(async (req, res) => sendSuccess(res, await importPomodoro(req.user.id, req.body), "Pomodoro session saved.")));
  child.post("/start", asyncHandler(async (req, res) => sendSuccess(res, await startPomodoro(req.user.id, req.body), "Pomodoro started.")));
  child.post("/:id/complete", asyncHandler(async (req, res) => sendSuccess(res, await completePomodoro(req.user.id, req.params.id, req.body), "Pomodoro completed.")));
  child.post("/:id/cancel", asyncHandler(async (req, res) => sendSuccess(res, await cancelPomodoro(req.user.id, req.params.id), "Pomodoro cancelled.")));
  child.put("/:id", asyncHandler(async (req, res) => sendSuccess(res, await importPomodoro(req.user.id, { ...req.body, id: req.params.id }), "Pomodoro session updated.")));
  child.delete("/:id", asyncHandler(async (req, res) => { await deletePomodoro(req.user.id, req.params.id); return sendSuccess(res, null, "Pomodoro removed."); }));
  child.get("/:id", asyncHandler(async (req, res) => {
    const [rows] = await pool.execute("SELECT * FROM pomodoro_sessions WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
    if (!rows.length) throw new ApiError(404, "Pomodoro session not found.", "NOT_FOUND");
    return sendSuccess(res, rows[0]);
  }));
  return child;
}

function notificationRouter() {
  const child = Router();
  child.get("/", asyncHandler(async (req, res) => sendSuccess(res, await listNotifications(req.user.id))));
  child.post("/", asyncHandler(async (req, res) => sendSuccess(res, await createNotification(req.user.id, req.body), "Notification created.")));
  child.put("/read-all", asyncHandler(async (req, res) => { await markAllRead(req.user.id); return sendSuccess(res, null, "Notifications marked as read."); }));
  child.put("/:id/read", asyncHandler(async (req, res) => { await markRead(req.user.id, req.params.id); return sendSuccess(res, null, "Notification marked as read."); }));
  child.put("/:id", asyncHandler(async (req, res) => {
    const body = objectBody(req.body);
    const [result] = await pool.execute(
      "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?",
      [body.read ? (body.read_at || new Date()) : null, req.params.id, req.user.id]
    );
    if (!result.affectedRows) throw new ApiError(404, "Notification not found.", "NOT_FOUND");
    return sendSuccess(res, null, "Notification updated.");
  }));
  child.delete("/:id", asyncHandler(async (req, res) => { await removeNotification(req.user.id, req.params.id); return sendSuccess(res, null, "Notification deleted."); }));
  return child;
}

function placementRouter() {
  const child = Router();
  child.get("/", asyncHandler(async (req, res) => sendSuccess(res, { topics: await listPlacementTopics(req.user.id), roadmaps: await listRoadmaps(req.user.id) })));
  child.get("/topics", asyncHandler(async (req, res) => sendSuccess(res, await listPlacementTopics(req.user.id))));
  child.post("/topics", asyncHandler(async (req, res) => sendSuccess(res, await savePlacementTopic(req.user.id, req.body), "Placement topic created.")));
  child.put("/topics/:id", asyncHandler(async (req, res) => sendSuccess(res, await savePlacementTopic(req.user.id, req.body, req.params.id), "Placement topic updated.")));
  child.post("/topics/:id/complete", asyncHandler(async (req, res) => sendSuccess(res, await savePlacementTopic(req.user.id, { ...req.body, id: req.params.id, status: "Completed", completed: true }, req.params.id), "Placement topic completed.")));
  child.delete("/topics/:id", asyncHandler(async (req, res) => { await removePlacementTopic(req.user.id, req.params.id); return sendSuccess(res, null, "Placement topic deleted."); }));
  child.get("/roadmaps", asyncHandler(async (req, res) => sendSuccess(res, await listRoadmaps(req.user.id))));
  child.post("/roadmaps", asyncHandler(async (req, res) => {
    return sendSuccess(res, await createEntity("placement-roadmaps", req.user.id, req.body), "Roadmap created.");
  }));
  child.put("/roadmaps/:id", asyncHandler(async (req, res) => {
    return sendSuccess(res, await updateEntity("placement-roadmaps", req.user.id, req.params.id, req.body), "Roadmap updated.");
  }));
  child.delete("/roadmaps/:id", asyncHandler(async (req, res) => {
    await deleteEntity("placement-roadmaps", req.user.id, req.params.id);
    return sendSuccess(res, null, "Roadmap deleted.");
  }));
  return child;
}

function analyticsRouter() {
  const child = Router();
  child.get("/", asyncHandler(async (req, res) => sendSuccess(res, await getAnalytics(req.user.id, req.query.days || 7))));
  child.get("/weekly", asyncHandler(async (req, res) => sendSuccess(res, await getAnalytics(req.user.id, 7))));
  child.get("/activity", asyncHandler(async (req, res) => sendSuccess(res, (await getAnalytics(req.user.id, req.query.days || 30)).recentActivity)));
  return child;
}

export default router;
