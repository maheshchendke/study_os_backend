import { pool } from "../config/database.js";
import { getAnalytics } from "./analytics.js";
import { listEntities } from "./entities.js";

export async function getDashboard(userId) {
  const [subjects] = await pool.execute("SELECT COUNT(*) AS count FROM subjects WHERE user_id = ?", [userId]);
  const [tasks] = await pool.execute(
    "SELECT COUNT(*) AS total, SUM(status = 'Completed') AS completed FROM tasks WHERE user_id = ?",
    [userId]
  );
  const [goals] = await pool.execute("SELECT COUNT(*) AS count FROM goals WHERE user_id = ? AND status <> 'Completed'", [userId]);
  const [pomodoros] = await pool.execute(
    `SELECT COUNT(*) AS count, COALESCE(SUM(duration),0) AS minutes
     FROM pomodoro_sessions WHERE user_id = ? AND session_type = 'focus' AND status = 'completed'
     AND completed_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)`,
    [userId]
  );
  const [xpRows] = await pool.execute(
    `SELECT COALESCE(SUM(CASE event_type WHEN 'TASK_COMPLETED' THEN 10 WHEN 'STUDY_SESSION_COMPLETED' THEN 8
      WHEN 'POMODORO_COMPLETED' THEN 5 WHEN 'HABIT_COMPLETED' THEN 4 WHEN 'PLACEMENT_TOPIC_COMPLETED' THEN 6 ELSE 0 END),0) AS xp
     FROM analytics_events WHERE user_id = ?`,
    [userId]
  );
  const [todayTasks] = await pool.execute(
    "SELECT * FROM tasks WHERE user_id = ? AND due_date = CURRENT_DATE() ORDER BY due_time, created_at LIMIT 20",
    [userId]
  );
  const [upcoming] = await pool.execute(
    `SELECT * FROM tasks WHERE user_id = ? AND status <> 'Completed' AND due_date >= CURRENT_DATE()
     ORDER BY due_date, due_time LIMIT 10`,
    [userId]
  );
  const [activity] = await pool.execute(
    "SELECT event_type, entity_type, entity_id, metadata, created_at FROM analytics_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
    [userId]
  );
  const subjectsData = await listEntities("subjects", userId);
  const analytics = await getAnalytics(userId, 7);
  const subjectNames = new Map(subjectsData.map((subject) => [String(subject.id), subject.name]));
  const taskRows = (rows) => rows.map((row) => ({
    ...row, id: String(row.id), subject: row.subject || subjectNames.get(String(row.subject_id)) || "",
    due_date: row.due_date, due_time: row.due_time ? String(row.due_time).slice(0, 5) : "",
  }));
  const parse = (value) => {
    if (!value) return {};
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return {}; }
  };
  const xp = Number(xpRows[0].xp || 0);
  return {
    stats: {
      subjects: Number(subjects[0].count),
      tasksDone: Number(tasks[0].completed || 0),
      activeGoals: Number(goals[0].count),
      studyHoursThisWeek: Math.round(Number(pomodoros[0].minutes) / 60 * 10) / 10,
      pomodoroSessions: Number(pomodoros[0].count),
      level: Math.floor(xp / 100) + 1,
      xp,
      streak: analytics.streak,
    },
    todayTasks: taskRows(todayTasks),
    upcomingDeadlines: taskRows(upcoming),
    activeGoals: await listEntities("goals", userId),
    recentActivity: activity.map((event) => ({ ...event, metadata: parse(event.metadata) })),
  };
}
