import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'admin-helper.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// --- Schema ---
// ============================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    page_url TEXT,
    page_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    page_context TEXT,
    has_screenshot INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
`);

// ============================================================
// --- Prepared Statements ---
// ============================================================

const stmts = {
  createSession: db.prepare(
    'INSERT INTO sessions (id, page_url, page_path) VALUES (?, ?, ?)',
  ),
  updateSession: db.prepare(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
  ),
  insertMessage: db.prepare(
    'INSERT INTO messages (session_id, role, content, page_context, has_screenshot) VALUES (?, ?, ?, ?, ?)',
  ),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  listSessions: db.prepare(`
    SELECT s.*, COUNT(m.id) as message_count
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT ? OFFSET ?
  `),
  getMessages: db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
  ),
  countSessions: db.prepare('SELECT COUNT(*) as count FROM sessions'),
};

// ============================================================
// --- API ---
// ============================================================

function generateId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function createSession(id, pageUrl, pagePath) {
  const sessionId = id || generateId();
  stmts.createSession.run(sessionId, pageUrl || null, pagePath || null);
  return sessionId;
}

export function saveMessage(sessionId, role, content, pageContext, hasScreenshot) {
  const contextJson = pageContext ? JSON.stringify(pageContext) : null;
  stmts.insertMessage.run(sessionId, role, content, contextJson, hasScreenshot ? 1 : 0);
  stmts.updateSession.run(sessionId);
}

export function getSession(id) {
  return stmts.getSession.get(id);
}

export function listSessions(limit = 50, offset = 0) {
  const total = stmts.countSessions.get().count;
  const sessions = stmts.listSessions.all(limit, offset);
  return { sessions, total };
}

export function getMessages(sessionId) {
  return stmts.getMessages.all(sessionId);
}

export { db };
