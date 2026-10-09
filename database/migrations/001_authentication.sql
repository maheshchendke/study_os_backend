USE studyos;

-- Additive, repeatable migration. Existing users and study data remain untouched.
SET @has_password_hash = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'
);
SET @add_password_hash = IF(
  @has_password_hash = 0,
  'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email',
  'SELECT 1'
);
PREPARE auth_migration_stmt FROM @add_password_hash;
EXECUTE auth_migration_stmt;
DEALLOCATE PREPARE auth_migration_stmt;

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_sessions_user_expiry (user_id, expires_at),
  KEY idx_user_sessions_expiry (expires_at),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
