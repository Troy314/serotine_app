#!/usr/bin/env node
/**
 * check-sql-backticks.js — catches the exact bug that hit this codebase
 * twice: a stray backtick inside a SQL `-- comment` that lives inside a
 * JS template literal (`db.exec(\`...\`)`, `db.prepare(\`...\`)`)
 * prematurely closes the JS string, breaking the file at runtime with a
 * confusing "missing ) after argument list" error nowhere near the real
 * cause. SQL comments never legitimately need a backtick (use '...' for
 * an inline code reference instead) — so any `-- ...` line containing one
 * is always the bug, never a false positive.
 *
 * Run: node scripts/check-sql-backticks.js  (or `npm run lint:sql`)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SERVER_DIR = join(import.meta.dirname, "..", "server");
let failed = false;

for (const file of readdirSync(SERVER_DIR)) {
  if (!file.endsWith(".js")) continue;
  const path = join(SERVER_DIR, file);
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("--") && trimmed.includes("`")) {
      console.error(`${file}:${i + 1}: backtick inside a SQL comment — this will close the enclosing JS template literal early:`);
      console.error(`  ${trimmed}`);
      failed = true;
    }
  });
}

if (failed) {
  console.error("\nFix: use single quotes ('...') for inline code references in SQL comments, not backticks.");
  process.exit(1);
} else {
  console.log("check-sql-backticks: OK — no stray backticks in SQL comments.");
}
