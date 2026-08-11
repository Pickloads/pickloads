#!/usr/bin/env node
/**
 * Run a command with `.env.e2e` loaded.
 *
 *   node scripts/with-e2e-env.mjs npm run build
 *   node scripts/with-e2e-env.mjs npx playwright test
 *
 * WHY A SCRIPT RATHER THAN `.env.local`. `.env.local` is developer-owned and
 * gitignored; committing e2e values there would collide with whatever a
 * developer has configured locally, and Next loads it for every command. This
 * loads the e2e values for exactly the two commands that want them, so a
 * normal `npm run build` still fails loudly on missing production config.
 *
 * WHY NOT `node --env-file`. It exists, but it would have to wrap `next` and
 * `playwright` binaries directly and it silently ignores a missing file. A
 * missing `.env.e2e` here is a hard error: a suite that quietly runs with no
 * configuration is exactly the failure this file was written to end.
 *
 * PRECEDENCE. Values already in the environment WIN. CI can therefore point
 * the lane at a real staging project by exporting the variables, without
 * editing a committed file.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT, ".env.e2e");

let raw;
try {
  raw = readFileSync(ENV_FILE, "utf8");
} catch {
  console.error(
    `✖ ${ENV_FILE} not found.\n` +
      `  The e2e lane needs it. It is committed — restore it from git rather\n` +
      `  than inventing values, or the suite proves something else.`,
  );
  process.exit(1);
}

const loaded = [];
for (const line of raw.split("\n")) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  // Quotes are stripped; nothing in this file needs them, but a future value
  // with a space would otherwise arrive with them attached.
  const value = trimmed
    .slice(eq + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
    loaded.push(key);
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-e2e-env.mjs <command> [args...]");
  process.exit(1);
}

console.log(`▸ e2e env: ${loaded.length} value(s) from .env.e2e — ${command} ${args.join(" ")}`);

const child = spawn(command, args, {
  stdio: "inherit",
  env: process.env,
  // `npm`/`npx` are .cmd shims on Windows; without a shell, spawn cannot find
  // them and the lane fails with a bare ENOENT that says nothing useful.
  shell: process.platform === "win32",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
