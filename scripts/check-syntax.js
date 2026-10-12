import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(filePath);
    return entry.isFile() && filePath.endsWith(".js") ? [filePath] : [];
  }));
  return nested.flat();
}

const files = (await Promise.all(["src", "test", "scripts"].map(javascriptFiles)))
  .flat()
  .sort();
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.error) {
    console.error(`Could not check ${file}: ${result.error.message}`);
    failed = true;
  } else if (result.status !== 0) {
    failed = true;
  }
}

if (failed) process.exitCode = 1;
else console.log(`Syntax OK: ${files.length} JavaScript files checked.`);
