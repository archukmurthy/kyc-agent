#!/usr/bin/env node
/*
 * PROC-2: runs straight after Claude Code edits a file.
 *
 * Lint the edited file, then run the tests that cover it - so a slip surfaces
 * in seconds instead of at review. Exits 2 with the failure on stderr, which is
 * how a PostToolUse hook feeds the problem back.
 *
 * Deliberately narrow: it only ever checks the ONE file that was edited and the
 * one test file that covers it. The full suite stays where it belongs, before a
 * pull request. Wired up in .claude/settings.json.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SKIP = /node_modules|[\\/]build[\\/]|[\\/]coverage[\\/]|\.min\./;

function readHookInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** The test file that covers `file`, or null. Convention over configuration:
 *  a sibling __tests__ or tests/ directory holding <name>.<kind>. */
function findCoveringTest(file) {
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.(jsx?|mjs|cjs)$/, "");
  const candidates = [];
  for (const testDir of [path.join(dir, "__tests__"), path.join(dir, "tests")]) {
    for (const suffix of [".nodetest.js", ".test.js", ".test.jsx", ".render.test.jsx"]) {
      candidates.push(path.join(testDir, base + suffix));
    }
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function run(cmd, args, label) {
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: "pipe", timeout: 120000 });
    return null;
  } catch (err) {
    const out = `${err.stdout || ""}${err.stderr || ""}`.trim();
    return `${label} failed:\n${out.slice(0, 4000)}`;
  }
}

const input = readHookInput();
const file = input && input.tool_input && input.tool_input.file_path;
if (!file || !/\.(jsx?|mjs|cjs)$/.test(file) || SKIP.test(file)) process.exit(0);

const rel = path.relative(ROOT, file);
if (rel.startsWith("..") || !fs.existsSync(file)) process.exit(0);

const problems = [];

const lint = run(process.execPath, [path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js"), rel], `Lint (${rel})`);
if (lint) problems.push(lint);

const test = findCoveringTest(file);
if (test) {
  const relTest = path.relative(ROOT, test);
  const result = relTest.includes(".nodetest.")
    ? run(process.execPath, ["--test", relTest], `Test (${relTest})`)
    : run(
        process.execPath,
        [path.join(ROOT, "node_modules", "react-scripts", "bin", "react-scripts.js"), "test", relTest, "--watchAll=false"],
        `Test (${relTest})`
      );
  if (result) problems.push(result);
}

if (problems.length) {
  console.error(problems.join("\n\n"));
  process.exit(2);
}
