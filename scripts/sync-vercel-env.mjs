/**
 * Sync non-empty variables from .env to Vercel via REST API (fast).
 * Usage: node scripts/sync-vercel-env.mjs
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_KEYS = new Set(["HOST", "PORT"]);
const TARGETS = ["production", "preview", "development"];

/** @returns {Record<string, string>} */
function parseEnvFile(content) {
  /** @type {Record<string, string>} */
  const vars = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || SKIP_KEYS.has(key) || !value) continue;
    vars[key] = value;
  }
  return vars;
}

function loadVercelAuthToken() {
  const authPath = join(homedir(), "AppData", "Roaming", "xdg.data", "com.vercel.cli", "auth.json");
  const auth = JSON.parse(readFileSync(authPath, "utf8"));
  if (!auth?.token) throw new Error("Geen Vercel token gevonden. Run: npx vercel login");
  return auth.token;
}

const project = JSON.parse(readFileSync(join(root, ".vercel", "project.json"), "utf8"));
const token = loadVercelAuthToken();
const vars = parseEnvFile(readFileSync(join(root, ".env"), "utf8"));
const entries = Object.entries(vars);

const body = entries.map(([key, value]) => ({
  key,
  value,
  type: "encrypted",
  target: TARGETS,
}));

const url = new URL(`https://api.vercel.com/v10/projects/${project.projectId}/env`);
url.searchParams.set("upsert", "true");
if (project.orgId) url.searchParams.set("teamId", project.orgId);

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`Vercel env sync mislukt (${response.status}): ${detail}`);
}

const result = await response.json();
const created = Array.isArray(result?.created) ? result.created.length : entries.length;
console.log(`Synced ${created} environment variables to ${TARGETS.join(", ")}.`);
