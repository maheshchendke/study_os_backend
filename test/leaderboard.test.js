import test from "node:test";
import assert from "node:assert/strict";
import { getLeaderboard } from "../src/services/analytics.js";
import { pool } from "../src/config/database.js";

test("getLeaderboard constructs multi-student query and assigns ranks and isCurrentUser flag", async () => {
  const originalExecute = pool.execute;
  let capturedSql = "";
  let capturedParams = [];

  pool.execute = async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;
    return [
      [
        { id: "user-1", name: "Alice", xp: 120 },
        { id: "user-2", name: "Bob", xp: 80 },
        { id: "user-3", name: "Charlie", xp: 40 },
      ],
    ];
  };

  try {
    const results = await getLeaderboard("user-2", "all");

    // Must not filter exclusively by u.id = ?
    assert.doesNotMatch(capturedSql, /AND u\.id = \?/);
    assert.match(capturedSql, /WHERE u\.role = 'student'/);
    assert.deepEqual(capturedParams, []);

    // Check rank and user identification
    assert.equal(results.length, 3);
    assert.equal(results[0].rank, 1);
    assert.equal(results[0].isCurrentUser, false);
    assert.equal(results[1].rank, 2);
    assert.equal(results[1].isCurrentUser, true);
    assert.equal(results[2].rank, 3);
    assert.equal(results[2].isCurrentUser, false);

    // Testing period parameter (week)
    await getLeaderboard("user-2", "week");
    assert.deepEqual(capturedParams, [7]);
    assert.match(capturedSql, /AND e\.created_at >= DATE_SUB\(CURRENT_DATE\(\), INTERVAL \? DAY\)/);
  } finally {
    pool.execute = originalExecute;
  }
});
