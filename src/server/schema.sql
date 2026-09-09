-- Projects group issues
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📋',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  priority TEXT NOT NULL DEFAULT 'none',
  lead TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  target_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Colored labels
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Issues (core entity)
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'none',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  due_date TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Many-to-many: issues <-> labels
CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);

-- Comments on issues
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Auto-incrementing identifier counter
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Defaults for issue_counter / identifier_prefix are seeded by the app on the
-- first request (see ensureSeeded in src/server/index.ts). This file is applied
-- as DDL only: an INSERT here fails the whole deploy.

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issue_labels_issue ON issue_labels(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_labels_label ON issue_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id);
