# OpenClaw Todo App: The Open-Source Linear Alternative for SaaS

[![GitHub stars](https://img.shields.io/github/stars/clawnify/open-todo?style=social)](https://github.com/clawnify/open-todo/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw Ecosystem](https://img.shields.io/badge/Ecosystem-OpenClaw-blue)](https://github.com/openclaw/openclaw)

A Linear-inspired issue tracker for building project management tools, bug trackers, and task management SaaS apps. Part of the [OpenClaw](https://github.com/openclaw/openclaw) ecosystem. Zero cloud dependencies — runs locally with SQLite.

Built with **Preact + Hono + SQLite**. Ships with a dual-mode UI: one for humans (click-to-edit, inline forms) and one for AI agents (explicit buttons, large targets).

![Clawnify Todo App — Issues grouped by status](https://github.com/clawnify/open-todo/raw/main/docs/screenshot.png)
*Issues grouped by status with priority indicators, colored labels, and project tags.*

## What Is It?

Clawnify Todo App is a production-ready issue tracker framework designed for the OpenClaw community. Think of it as an open-source Linear alternative — a project management UI you can self-host, customize, and embed in any SaaS product.

Unlike Linear or Jira, this runs entirely on your own infrastructure with no API keys, no vendor lock-in, and no per-seat pricing. Track issues with status workflows, organize into projects, tag with colored labels, and comment for collaboration — all out of the box. It is the perfect foundation for building internal tools, headless project dashboards, or task-heavy admin panels.

## Features

- **Issue tracking** — create, edit, delete issues with auto-generated identifiers (TASK-1, TASK-2, ...)
- **Status workflow** — backlog → todo → in progress → done / cancelled, with visual status icons
- **Priority levels** — urgent, high, medium, low, none — with bar-style priority indicators
- **Projects** — group issues into projects with progress tracking (% done)
- **Colored labels** — create labels with custom colors, tag issues with multiple labels
- **Comments** — add comments to issues for collaboration and activity tracking
- **Grouped list view** — issues grouped by status with collapsible sections (like Linear)
- **Issue detail view** — full detail panel with right sidebar for metadata, inline title/description editing
- **Search** — real-time debounced search across issue titles and identifiers
- **Pagination** — configurable across all views
- **Dual-mode UI** — human-optimized + AI-agent-optimized (`?agent`)
- **SQLite persistence** — auto-creates schema on first run, zero config

## Quickstart

```bash
git clone https://github.com/clawnify/open-todo.git
cd open-todo
pnpm install
pnpm run dev
```

Open `http://localhost:5174` in your browser. Data persists in `data.db`.

### Agent Mode (for OpenClaw / Browser-Use)

Append `?agent` to the URL:

```
http://localhost:5174/?agent
```

This activates an agent-friendly UI with:
- Explicit "Delete" buttons always visible (no hover-only actions)
- Larger click targets for reliable browser automation
- Comment delete buttons always shown
- All interactive elements have `aria-label` attributes

The human UI stays unchanged — click titles to edit, hover to reveal actions, collapsible status groups.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Preact, TypeScript, Vite |
| **Backend** | Hono, Node.js |
| **Database** | SQLite (better-sqlite3) |
| **Icons** | Lucide |

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)

## Architecture

```
src/
  server/
    schema.sql  — SQLite schema (issues, projects, labels, comments, issue_labels, _meta)
    db.ts       — SQLite wrapper with async interface (D1-compatible)
    dev.ts      — Dev server (@hono/node-server)
    index.ts    — Hono REST API (17 endpoints)
  client/
    app.tsx           — Root component + agent mode detection
    context.tsx       — Preact context for app state
    hooks/use-app.ts  — Full state management (CRUD, pagination, search, detail)
    components/
      sidebar.tsx         — Linear-style sidebar nav (My Issues, Projects)
      issue-list.tsx      — Issue list grouped by status with collapsible sections
      issue-row.tsx       — Single issue row (priority, id, status, title, labels, project)
      issue-detail.tsx    — Full issue detail with right sidebar + comments
      project-list.tsx    — Projects table with inline editing + progress bars
      create-issue.tsx    — New issue form
      create-project.tsx  — New project form
      status-icon.tsx     — SVG status circles (dashed, outline, half-fill, check, slash)
      priority-icon.tsx   — SVG priority bars
      label-pill.tsx      — Colored label pills
      error-banner.tsx    — Toast error notifications
      pagination.tsx      — Page controls
```

### Data Model

Issues are the core entity, linked to projects (many-to-one) and labels (many-to-many). Identifiers auto-increment via a `_meta` table:

```sql
projects     (id, name, icon, description, status, priority, lead, dates)
labels       (id, name, color)
issues       (id, identifier, title, description, status, priority, project_id, due_date)
issue_labels (issue_id, label_id)  — many-to-many
comments     (id, issue_id, content, created_at)
_meta        (key, value)          — identifier counter + prefix
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Issue, project, label counts |
| GET | `/api/issues` | Paginated, searchable, grouped by status |
| POST | `/api/issues` | Create issue (auto-generates identifier) |
| GET | `/api/issues/:id` | Issue detail with labels + comments |
| PUT | `/api/issues/:id` | Update issue fields |
| DELETE | `/api/issues/:id` | Delete issue |
| POST | `/api/issues/:id/labels` | Add label to issue |
| DELETE | `/api/issues/:id/labels/:lid` | Remove label |
| GET | `/api/issues/:id/comments` | List comments |
| POST | `/api/issues/:id/comments` | Add comment |
| DELETE | `/api/comments/:cid` | Delete comment |
| GET | `/api/projects` | Paginated projects with progress % |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/labels` | All labels |
| POST | `/api/labels` | Create label |

## Community & Contributions

This project is part of the [OpenClaw](https://github.com/openclaw/openclaw) ecosystem. Contributions are welcome — open an issue or submit a PR.

## License

MIT
