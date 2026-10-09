import { run } from "node:test";
import { spec } from "node:test/reporters";

const testFiles = [
  "./test/validation.test.js",
  "./test/ai-response.test.js",
  "./test/security.test.js",
  "./test/leaderboard.test.js",
  "./test/stream-safety.test.js",
];

const stream = run({ files: testFiles }).compose(new spec());
stream.pipe(process.stdout);

let hasFailures = false;
stream.on("test:fail", () => {
  hasFailures = true;
});

stream.on("end", () => {
  process.exit(hasFailures ? 1 : 0);
});

