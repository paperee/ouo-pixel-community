// 数据库：Node 内置 node:sqlite（零原生依赖，单机够用）
// 所有建表用 IF NOT EXISTS；以后迁 PostgreSQL 时把本文件换成对应实现即可。
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(dir, "../data/pixel.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '未命名',
  canvas_w INTEGER NOT NULL,
  canvas_h INTEGER NOT NULL,
  layers_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS draft_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  layers_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  fork_from_id INTEGER REFERENCES artworks(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  frames INTEGER NOT NULL DEFAULT 1,
  palette_json TEXT NOT NULL DEFAULT '[]',
  png_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  license TEXT NOT NULL DEFAULT 'CC-BY-NC',
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, artwork_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES comments(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  ref_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  artwork_id INTEGER REFERENCES artworks(id),
  comment_id INTEGER REFERENCES comments(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- 公告板：单行（id=1），管理员编辑，所有人可见
CREATE TABLE IF NOT EXISTS board (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  meta TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_name_time ON events(name, created_at);
-- 高频查询列索引（画廊/评论/草稿/通知/版本全是这些 WHERE/ORDER 列，全表扫描随数据量变慢）
CREATE INDEX IF NOT EXISTS idx_artworks_status_id ON artworks(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_artwork ON comments(artwork_id, id);
CREATE INDEX IF NOT EXISTS idx_likes_artwork ON likes(artwork_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_draft_versions_draft ON draft_versions(draft_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
`);

// 轻量迁移：建表之后补列，老库也能跟上（列已存在则忽略报错）
for (const sql of [
  "ALTER TABLE drafts ADD COLUMN cover TEXT DEFAULT ''",
  "ALTER TABLE artworks ADD COLUMN layers_count INTEGER DEFAULT 1",
  "ALTER TABLE notifications ADD COLUMN actor_id INTEGER",
  "ALTER TABLE notifications ADD COLUMN extra TEXT DEFAULT ''",
  "ALTER TABLE artworks ADD COLUMN draft_id INTEGER",
  "ALTER TABLE artworks ADD COLUMN draft_version INTEGER DEFAULT 1",
  "ALTER TABLE artworks ADD COLUMN layers_json TEXT DEFAULT '[]'",
  "ALTER TABLE draft_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'",
  // 版权直选：可下载 / 可二创（老库 license='不可转载' 回填为双关）
  "ALTER TABLE artworks ADD COLUMN allow_download INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE artworks ADD COLUMN allow_remix INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE drafts ADD COLUMN fork_from_id INTEGER",
  "UPDATE artworks SET allow_download = 0, allow_remix = 0 WHERE license = '不可转载'",
  "ALTER TABLE users ADD COLUMN pet_artwork_id INTEGER",
  "ALTER TABLE users ADD COLUMN pet_flip INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN pet_kind TEXT NOT NULL DEFAULT 'artwork'",
  // follows / favorites 从未有任何读写（0 行），直接删表
  "DROP TABLE IF EXISTS follows",
  "DROP TABLE IF EXISTS favorites",
]) {
  try {
    db.exec(sql);
  } catch {
    /* 列已存在 */
  }
}
