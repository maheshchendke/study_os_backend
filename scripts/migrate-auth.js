import { pool, closeDatabase } from "../src/config/database.js";

try {
  const [columns] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'`
  );
  if (Number(columns[0].count) === 0) {
    await pool.execute("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email");
  }
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_sessions_user_expiry (user_id, expires_at),
      KEY idx_user_sessions_expiry (expires_at),
      CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );
  console.log("Authentication schema migration applied.");
} catch (error) {
  console.error("Authentication schema migration failed:", error.code || error.name || "UNKNOWN");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
