import { pool } from "../config/database.js";

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export async function getAnalytics(userId, days = 7) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 7));
  const [events] = await pool.execute(
    `SELECT event_type, entity_type, entity_id, metadata, created_at
     FROM analytics_events
     WHERE user_id = ? AND created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)
     ORDER BY created_at DESC`,
    [userId, safeDays]
  );
  const activity = events.map((event) => ({ ...event, metadata: parseJson(event.metadata) }));
  const byDay = new Map();
  for (const event of activity) {
    const date = String(event.created_at).slice(0, 10);
    const entry = byDay.get(date) || { date, tasks: 0, studyMinutes: 0, pomodoros: 0, events: 0 };
    entry.events += 1;
    if (event.event_type === "TASK_COMPLETED") entry.tasks += 1;
    if (event.event_type === "POMODORO_COMPLETED") {
      entry.pomodoros += 1;
      entry.studyMinutes += Number(event.metadata.duration || 0);
    }
    if (event.event_type === "STUDY_SESSION_COMPLETED") entry.studyMinutes += Number(event.metadata.duration_minutes || 0);
    byDay.set(date, entry);
  }
  const [taskRows] = await pool.execute(
    "SELECT COUNT(*) AS total, SUM(status = 'Completed') AS completed FROM tasks WHERE user_id = ?",
    [userId]
  );
  const [studyRows] = await pool.execute(
    `SELECT COALESCE(SUM(duration),0) AS minutes, COUNT(*) AS sessions
     FROM pomodoro_sessions WHERE user_id = ? AND session_type = 'focus' AND status = 'completed'
     AND completed_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)`,
    [userId, safeDays]
  );
  const [habitRows] = await pool.execute(
    "SELECT COALESCE(MAX(streak),0) AS bestStreak FROM habits WHERE user_id = ?",
    [userId]
  );
  return {
    rangeDays: safeDays,
    tasks: { total: Number(taskRows[0].total || 0), completed: Number(taskRows[0].completed || 0) },
    study: { minutes: Number(studyRows[0].minutes || 0), sessions: Number(studyRows[0].sessions || 0) },
    streak: Number(habitRows[0].bestStreak || 0),
    activity: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recentActivity: activity.slice(0, 30),
  };
}

export async function getLeaderboard(userId, period = "all") {
  const days = period === "week" ? 7 : period === "month" ? 30 : null;
  // The time filter belongs inside the ON clause of the LEFT JOIN, not in WHERE.
  // Placing it in WHERE would turn the outer join into an inner join and exclude
  // students who have zero events in the selected period.
  const joinTimeFilter = days
    ? "AND e.created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)"
    : "";
  const params = days ? [days] : [];
  const [rows] = await pool.execute(
    `SELECT u.id, u.name,
       COALESCE(SUM(CASE e.event_type
         WHEN 'TASK_COMPLETED' THEN 10
         WHEN 'STUDY_SESSION_COMPLETED' THEN 8
         WHEN 'POMODORO_COMPLETED' THEN 5
         WHEN 'HABIT_COMPLETED' THEN 4
         WHEN 'PLACEMENT_TOPIC_COMPLETED' THEN 6
         ELSE 0 END),0) AS xp
     FROM users u
     LEFT JOIN analytics_events e ON e.user_id = u.id ${joinTimeFilter}
     WHERE u.role = 'student'
     GROUP BY u.id, u.name
     ORDER BY xp DESC, u.name ASC
     LIMIT 100`,
    params
  );
  return rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    xp: Number(row.xp),
    rank: index + 1,
    isCurrentUser: row.id === userId,
  }));
}

