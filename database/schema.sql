CREATE DATABASE IF NOT EXISTS studyos
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE studyos;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL DEFAULT 'Student',
  email VARCHAR(254) NULL,
  password_hash VARCHAR(255) NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'student',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_sessions_user_expiry (user_id, expires_at),
  KEY idx_user_sessions_expiry (expires_at),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  code VARCHAR(32) NOT NULL,
  teacher VARCHAR(160) NULL,
  credits DECIMAL(5,2) NULL,
  semester VARCHAR(32) NULL,
  color VARCHAR(32) NULL,
  icon VARCHAR(64) NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subject_user_id (user_id, id),
  UNIQUE KEY uq_subject_user_code (user_id, code),
  KEY idx_subjects_user_semester (user_id, semester),
  CONSTRAINT fk_subjects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS topics (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  subject_id VARCHAR(64) NOT NULL,
  unit INT NOT NULL DEFAULT 1,
  name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at DATETIME NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_topic_user_id (user_id, id),
  KEY idx_topics_user_subject (user_id, subject_id),
  CONSTRAINT fk_topics_subject FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NULL,
  subject_id VARCHAR(64) NULL,
  topic_id VARCHAR(64) NULL,
  subject VARCHAR(160) NULL,
  priority ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  status ENUM('To Do','In Progress','Completed') NOT NULL DEFAULT 'To Do',
  start_date DATE NULL,
  due_date DATE NULL,
  due_time TIME NULL,
  duration_days INT UNSIGNED NOT NULL DEFAULT 1,
  estimated_minutes_per_day INT UNSIGNED NOT NULL DEFAULT 60,
  reminder_minutes INT NULL,
  completed_at DATETIME NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tasks_user_id (user_id, id),
  KEY idx_tasks_user_due (user_id, due_date, status),
  KEY idx_tasks_user_status (user_id, status, created_at),
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_subject FOREIGN KEY (subject_id)
    REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_topic FOREIGN KEY (topic_id)
    REFERENCES topics(id) ON DELETE SET NULL,
  CONSTRAINT chk_tasks_duration CHECK (duration_days > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notes (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  subject_id VARCHAR(64) NULL,
  subject VARCHAR(160) NULL,
  topic_id VARCHAR(64) NULL,
  note_type VARCHAR(40) NOT NULL DEFAULT 'Class Notes',
  content LONGTEXT NULL,
  tags JSON NULL,
  attachments JSON NULL,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  important BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  semester VARCHAR(32) NULL,
  unit VARCHAR(32) NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notes_user_id (user_id, id),
  KEY idx_notes_user_updated (user_id, updated_at),
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS goals (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NULL,
  target DECIMAL(12,2) NULL,
  progress DECIMAL(12,2) NOT NULL DEFAULT 0,
  deadline DATE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Active',
  category VARCHAR(80) NULL,
  priority VARCHAR(32) NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_goals_user_id (user_id, id),
  KEY idx_goals_user_status_deadline (user_id, status, deadline),
  CONSTRAINT fk_goals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS habits (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  frequency VARCHAR(40) NOT NULL DEFAULT 'Daily',
  streak INT UNSIGNED NOT NULL DEFAULT 0,
  last_completed DATE NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_habits_user_id (user_id, id),
  KEY idx_habits_user_name (user_id, name),
  CONSTRAINT fk_habits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS study_plans (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  subject_id VARCHAR(64) NULL,
  topic_id VARCHAR(64) NULL,
  plan_date DATE NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  duration_minutes INT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Planned',
  notes TEXT NULL,
  record_type ENUM('session','plan','timetable') NOT NULL DEFAULT 'session',
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_study_plans_user_id (user_id, id),
  KEY idx_study_plans_user_date (user_id, record_type, plan_date),
  CONSTRAINT fk_study_plans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  task_id VARCHAR(64) NULL,
  subject_id VARCHAR(64) NULL,
  topic_id VARCHAR(64) NULL,
  duration INT UNSIGNED NOT NULL,
  session_type ENUM('focus','short_break','long_break') NOT NULL,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  status ENUM('running','completed','cancelled') NOT NULL DEFAULT 'running',
  notes TEXT NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pomodoro_user_id (user_id, id),
  KEY idx_pomodoro_user_started (user_id, started_at, status),
  CONSTRAINT fk_pomodoro_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(48) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  read_at DATETIME NULL,
  related_entity_type VARCHAR(40) NULL,
  related_entity_id VARCHAR(64) NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_user_id (user_id, id),
  KEY idx_notifications_user_read_created (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS placement_topics (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  section VARCHAR(48) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Not Started',
  completed_at DATETIME NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_placement_topics_user_id (user_id, id),
  KEY idx_placement_topics_user_section (user_id, section, status),
  CONSTRAINT fk_placement_topics_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS placement_roadmaps (
  id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Active',
  target_date DATE NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_placement_roadmaps_user_id (user_id, id),
  KEY idx_placement_roadmaps_user_status (user_id, status),
  CONSTRAINT fk_placement_roadmaps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  entity_type VARCHAR(48) NULL,
  entity_id VARCHAR(64) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_analytics_user_type_created (user_id, event_type, created_at),
  KEY idx_analytics_user_created (user_id, created_at),
  CONSTRAINT fk_analytics_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_actions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  request TEXT NOT NULL,
  structured_action JSON NULL,
  status ENUM('pending_confirmation','completed','rejected','failed') NOT NULL,
  result JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_actions_user_created (user_id, created_at),
  CONSTRAINT fk_ai_actions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
