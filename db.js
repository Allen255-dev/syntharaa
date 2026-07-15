// ============================================================================
// Synthara — database layer (libSQL)
//
// Same code runs two ways, picked automatically by environment variables:
//  - No TURSO_DATABASE_URL set  -> writes to a local file (data/synthara.db).
//    Zero setup — this is what local dev and hosts with a real disk
//    (Railway, Render, a VPS) use.
//  - TURSO_DATABASE_URL set     -> talks to a hosted Turso (libSQL) database
//    over HTTP. This is what makes it work on Vercel, whose functions have
//    a read-only filesystem and can't keep a local SQLite file around.
//
// libSQL speaks the same SQL dialect as SQLite, so the schema/queries below
// are unchanged from a plain-SQLite version — only the client is async now.
// ============================================================================

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

let client;
if (process.env.TURSO_DATABASE_URL) {
  client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
} else if (process.env.VERCEL) {
  // Vercel's filesystem is read-only outside /tmp, and /tmp doesn't persist
  // between requests — a local SQLite file would silently lose all data.
  // Fail immediately and clearly instead of limping along.
  throw new Error(
    "TURSO_DATABASE_URL is not set. On Vercel, Synthara needs a hosted libSQL/Turso database " +
      "(a local SQLite file won't persist between requests). Set TURSO_DATABASE_URL and " +
      "TURSO_AUTH_TOKEN in your Vercel project's environment variables — see the README."
  );
} else {
  const dataDir = path.join(__dirname, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  client = createClient({ url: `file:${path.join(dataDir, "synthara.db")}` });
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS threads (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    messages   TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id);

  CREATE TABLE IF NOT EXISTS shares (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    messages   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`;

// Schema setup happens once per warm instance; every exported function
// awaits this first, so cold starts on serverless are always safe.
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = client.executeMultiple(`PRAGMA foreign_keys = ON;\n${SCHEMA_SQL}`);
  }
  return readyPromise;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function newId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

async function get(sql, args = []) {
  await ready();
  const rs = await client.execute({ sql, args });
  return rs.rows[0] || null;
}
async function all(sql, args = []) {
  await ready();
  const rs = await client.execute({ sql, args });
  return rs.rows;
}
async function run(sql, args = []) {
  await ready();
  const rs = await client.execute({ sql, args });
  return { changes: Number(rs.rowsAffected || 0) };
}

function rowToThread(row) {
  return {
    id: row.id,
    title: row.title,
    pinned: !!row.pinned,
    messages: JSON.parse(row.messages),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Best-effort periodic cleanup of expired sessions (no-op serverless-side —
// harmless there since each warm instance just skips it after one run).
setInterval(() => {
  run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]).catch(() => {});
}, 60 * 60 * 1000).unref?.();

module.exports = {
  SESSION_TTL_MS,

  async createUser({ email, passwordHash, displayName }) {
    const id = newId();
    await run("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)", [
      id,
      email,
      passwordHash,
      displayName,
      Date.now(),
    ]);
    return this.findUserById(id);
  },
  findUserByEmail(email) {
    return get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
  },
  findUserById(id) {
    return get("SELECT * FROM users WHERE id = ?", [id]);
  },
  async updateDisplayName(userId, displayName) {
    await run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, userId]);
  },
  async deleteUser(userId) {
    await run("DELETE FROM users WHERE id = ?", [userId]); // cascades to sessions/threads/shares
  },

  async createSession(userId) {
    const id = newId(24);
    const now = Date.now();
    await run("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", [
      id,
      userId,
      now,
      now + SESSION_TTL_MS,
    ]);
    return id;
  },
  async getSession(id) {
    const s = await get("SELECT * FROM sessions WHERE id = ?", [id]);
    if (!s) return null;
    if (s.expires_at < Date.now()) {
      await run("DELETE FROM sessions WHERE id = ?", [id]);
      return null;
    }
    return s;
  },
  async deleteSession(id) {
    await run("DELETE FROM sessions WHERE id = ?", [id]);
  },
  async deleteAllSessionsForUser(userId) {
    await run("DELETE FROM sessions WHERE user_id = ?", [userId]);
  },

  async createThread({ userId, title, pinned, messages }) {
    const id = newId();
    const now = Date.now();
    await run(
      "INSERT INTO threads (id, user_id, title, pinned, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, userId, title, pinned ? 1 : 0, JSON.stringify(messages || []), now, now]
    );
    return this.getThread(id, userId);
  },
  async listThreads(userId) {
    const rows = await all("SELECT * FROM threads WHERE user_id = ? ORDER BY updated_at DESC", [userId]);
    return rows.map(rowToThread);
  },
  async getThread(id, userId) {
    const row = await get("SELECT * FROM threads WHERE id = ? AND user_id = ?", [id, userId]);
    return row ? rowToThread(row) : null;
  },
  async updateThread(id, userId, { title, pinned, messages }) {
    const existing = await get("SELECT * FROM threads WHERE id = ? AND user_id = ?", [id, userId]);
    if (!existing) return null;
    await run("UPDATE threads SET title = ?, pinned = ?, messages = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
      title ?? existing.title,
      pinned === undefined ? existing.pinned : pinned ? 1 : 0,
      messages === undefined ? existing.messages : JSON.stringify(messages),
      Date.now(),
      id,
      userId,
    ]);
    return this.getThread(id, userId);
  },
  async deleteThread(id, userId) {
    await run("DELETE FROM threads WHERE id = ? AND user_id = ?", [id, userId]);
  },
  async deleteAllThreads(userId) {
    await run("DELETE FROM threads WHERE user_id = ?", [userId]);
  },

  async createShare({ userId, title, messages }) {
    const id = newId(12);
    await run("INSERT INTO shares (id, user_id, title, messages, created_at) VALUES (?, ?, ?, ?, ?)", [
      id,
      userId,
      title,
      JSON.stringify(messages),
      Date.now(),
    ]);
    return { id, title, createdAt: Date.now() };
  },
  async getShare(id) {
    const row = await get("SELECT * FROM shares WHERE id = ?", [id]);
    if (!row) return null;
    return { ...row, messages: JSON.parse(row.messages) };
  },
  listSharesForUser(userId) {
    return all("SELECT id, title, created_at FROM shares WHERE user_id = ? ORDER BY created_at DESC", [userId]);
  },
  async deleteShare(id, userId) {
    const info = await run("DELETE FROM shares WHERE id = ? AND user_id = ?", [id, userId]);
    return info.changes > 0;
  },
};
