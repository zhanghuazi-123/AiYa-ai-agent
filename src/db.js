import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'aiya.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function getDB() { return db; }

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      from_id TEXT NOT NULL DEFAULT '',
      to_id TEXT DEFAULT '',
      content TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'web',
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp);

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'knowledge',
      content TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      title TEXT DEFAULT '',
      mem_id TEXT,
      entities TEXT DEFAULT '[]',
      concepts TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      links TEXT DEFAULT '[]',
      source_ref TEXT,
      timestamp TEXT NOT NULL,
      parent_id INTEGER REFERENCES memories(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mem_timestamp ON memories(timestamp);
    CREATE INDEX IF NOT EXISTS idx_mem_parent ON memories(parent_id);

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      label TEXT,
      last_seen TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      tool TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      risk TEXT NOT NULL DEFAULT 'medium',
      args_json TEXT NOT NULL DEFAULT '{}',
      result_preview TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'ID:000001',
      due_at TEXT NOT NULL,
      task TEXT NOT NULL,
      system_message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      recurrence_type TEXT,
      recurrence_config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fired_at TEXT,
      cancelled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rem_due ON reminders(status, due_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, detail, entities, concepts, tags,
      content='memories', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS mem_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, detail, entities, concepts, tags)
      VALUES (new.id, new.content, new.detail, new.entities, new.concepts, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS mem_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, detail, entities, concepts, tags)
      VALUES ('delete', old.id, old.content, old.detail, old.entities, old.concepts, old.tags);
    END;
  `);
}

// === Config ===
export function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(key, String(value));
}

// === Conversations ===
export function insertConversation({ role, fromId, toId, content, channel, timestamp }) {
  return db.prepare(
    'INSERT INTO conversations (role, from_id, to_id, content, channel, timestamp) VALUES (?,?,?,?,?,?)'
  ).run(role, fromId || '', toId || '', content, channel, timestamp);
}
export function getConversations(limit = 60) {
  return db.prepare(
    'SELECT * FROM conversations ORDER BY timestamp ASC LIMIT ?'
  ).all(limit);
}
export function getRecentConversationTimeline(hours = 168) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  return db.prepare(
    "SELECT * FROM conversations WHERE timestamp >= ? ORDER BY timestamp ASC"
  ).all(since);
}

// === Memories ===
export function insertMemory({ type, content, detail, title, memId, entities, concepts, tags, links, sourceRef, timestamp, parentId }) {
  return db.prepare(`
    INSERT INTO memories (type, content, detail, title, mem_id, entities, concepts, tags, links, source_ref, timestamp, parent_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(type, content, detail, title || '', memId || null,
    JSON.stringify(entities || []), JSON.stringify(concepts || []),
    JSON.stringify(tags || []), JSON.stringify(links || []),
    sourceRef || null, timestamp, parentId || null);
}

export function upsertMemoryByMemId(memId, data) {
  const existing = db.prepare('SELECT id FROM memories WHERE mem_id = ?').get(memId);
  if (existing) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        sets.push(`${k} = ?`);
        vals.push(typeof v === 'object' ? JSON.stringify(v) : v);
      }
    }
    if (sets.length > 0) {
      vals.push(existing.id);
      db.prepare(`UPDATE memories SET ${sets.join(',')} WHERE id = ?`).run(...vals);
    }
    return existing.id;
  }
  return insertMemory({
    type: data.type || 'knowledge',
    content: data.content || '',
    detail: data.detail || '',
    title: data.title || '',
    memId,
    entities: data.entities,
    concepts: data.concepts,
    tags: data.tags,
    links: data.links,
    sourceRef: data.sourceRef,
    timestamp: data.timestamp || new Date().toISOString(),
    parentId: data.parentId,
  }).lastInsertRowid;
}

export function getMemories(limit = 20) {
  return db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function getMemoriesByEntity(entityId) {
  return db.prepare(
    "SELECT * FROM memories WHERE entities LIKE ? ORDER BY created_at DESC LIMIT 20"
  ).all(`%${entityId}%`);
}

export function searchMemories(keyword, limit = 10) {
  if (!keyword || !keyword.trim()) return getMemories(limit);
  try {
    return db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts fts ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(keyword.replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).join(' OR '), limit);
  } catch {
    return db.prepare(
      'SELECT * FROM memories WHERE content LIKE ? OR detail LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).all(`%${keyword}%`, `%${keyword}%`, limit);
  }
}

export function searchMemoriesByKeywords(keywords, limit = 20) {
  const results = new Map();
  for (const kw of keywords) {
    const rows = searchMemories(kw, 5);
    for (const r of rows) {
      if (!results.has(r.id)) results.set(r.id, { ...r, matched_by: [kw] });
      else results.get(r.id).matched_by.push(kw);
    }
  }
  return [...results.values()].slice(0, limit);
}

export function getMemoryCount() {
  return db.prepare('SELECT COUNT(*) as cnt FROM memories').get().cnt;
}

export function getPersonMemory(entityId) {
  return db.prepare(
    "SELECT * FROM memories WHERE type = 'person' AND (mem_id = ? OR entities LIKE ?) ORDER BY created_at DESC LIMIT 5"
  ).all(`person_${entityId}`, `%${entityId}%`);
}

export function deleteMemory(id) {
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
}

export function updateMemory(id, data) {
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length > 0) {
    vals.push(id);
    db.prepare(`UPDATE memories SET ${sets.join(',')} WHERE id = ?`).run(...vals);
  }
}

// === Entities ===
export function upsertEntity(id, label) {
  db.prepare(
    'INSERT OR REPLACE INTO entities (id, label, last_seen) VALUES (?, ?, datetime(\'now\'))'
  ).run(id, label || id);
}

// === Action Logs ===
export function insertActionLog({ tool, summary, detail, status, risk, argsJson, resultPreview, error, durationMs }) {
  return db.prepare(`
    INSERT INTO action_logs (timestamp, tool, summary, detail, status, risk, args_json, result_preview, error, duration_ms)
    VALUES (datetime('now'),?,?,?,?,?,?,?,?,?)
  `).run(tool, summary, detail || '', status, risk, JSON.stringify(argsJson || {}), resultPreview || '', error || '', durationMs || 0);
}

// === Reminders ===
export function getDueReminders() {
  return db.prepare(
    "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= datetime('now')"
  ).all();
}
export function insertReminder({ userId, dueAt, task, systemMessage, recurrenceType, recurrenceConfig }) {
  return db.prepare(`
    INSERT INTO reminders (user_id, due_at, task, system_message, recurrence_type, recurrence_config)
    VALUES (?,?,?,?,?,?)
  `).run(userId, dueAt, task, systemMessage, recurrenceType || null, recurrenceConfig || null);
}
export function fireReminder(id) {
  db.prepare("UPDATE reminders SET status = 'fired', fired_at = datetime('now') WHERE id = ?").run(id);
}
export function cancelReminder(id) {
  db.prepare("UPDATE reminders SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").run(id);
}

export default db;
