import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { query, get, run } from "./db";

const app = new OpenAPIHono();

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const LabelSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string(),
  created_at: z.string(),
}).openapi("Label");

const LabelRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string(),
}).openapi("LabelRef");

const CommentSchema = z.object({
  id: z.number().int(),
  issue_id: z.number().int(),
  content: z.string(),
  created_at: z.string(),
}).openapi("Comment");

const IssueSchema = z.object({
  id: z.number().int(),
  identifier: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  project_id: z.number().int().nullable(),
  due_date: z.string(),
  sort_order: z.number().int(),
  project_name: z.string().nullable().optional(),
  project_icon: z.string().nullable().optional(),
  labels: z.array(LabelRefSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Issue");

const ProjectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  icon: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  lead: z.string(),
  start_date: z.string(),
  target_date: z.string(),
  issue_count: z.number().int().optional(),
  done_count: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Project");

const IdParam = z.object({ id: z.string().openapi({ description: "Resource ID (integer)" }) });

// ── Helpers ────────────────────────────────────────────────────────

async function nextIdentifier(): Promise<string> {
  const prefix = await get<{ value: string }>("SELECT value FROM _meta WHERE key = 'identifier_prefix'");
  const counter = await get<{ value: string }>("SELECT value FROM _meta WHERE key = 'issue_counter'");
  const next = parseInt(counter?.value || "0", 10) + 1;
  await run("UPDATE _meta SET value = ? WHERE key = 'issue_counter'", String(next));
  return `${prefix?.value || "TASK"}-${next}`;
}

// ── Stats ──────────────────────────────────────────────────────────

const getStats = createRoute({
  method: "get",
  path: "/api/stats",
  tags: ["Stats"],
  summary: "Get dashboard statistics",
  responses: {
    200: {
      description: "Dashboard stats",
      content: { "application/json": { schema: z.object({
        issues: z.number().int(),
        projects: z.number().int(),
        labels: z.number().int(),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getStats, async (c) => {
  try {
    const issues = await get<{ count: number }>("SELECT COUNT(*) as count FROM issues");
    const projects = await get<{ count: number }>("SELECT COUNT(*) as count FROM projects");
    const labels = await get<{ count: number }>("SELECT COUNT(*) as count FROM labels");
    return c.json({
      issues: issues?.count || 0,
      projects: projects?.count || 0,
      labels: labels?.count || 0,
    }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Issues ─────────────────────────────────────────────────────────

const listIssues = createRoute({
  method: "get",
  path: "/api/issues",
  tags: ["Issues"],
  summary: "List issues with pagination, search, and filtering",
  request: {
    query: z.object({
      page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
      limit: z.string().optional().openapi({ description: "Items per page (default: 50, max: 100)" }),
      search: z.string().optional().openapi({ description: "Search by title or identifier" }),
      status: z.string().optional().openapi({ description: "Filter by status (todo, in_progress, done, backlog, cancelled)" }),
      project_id: z.string().optional().openapi({ description: "Filter by project ID" }),
    }),
  },
  responses: {
    200: {
      description: "Paginated issues with labels",
      content: { "application/json": { schema: z.object({
        issues: z.array(IssueSchema),
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listIssues, async (c) => {
  try {
    const q = c.req.valid("query");
    const page = Math.max(1, parseInt(q.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || "50", 10)));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const whereParams: unknown[] = [];

    if (q.search) {
      whereClauses.push("(i.title LIKE ? OR i.identifier LIKE ?)");
      whereParams.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.status) {
      whereClauses.push("i.status = ?");
      whereParams.push(q.status);
    }
    if (q.project_id) {
      whereClauses.push("i.project_id = ?");
      whereParams.push(parseInt(q.project_id, 10));
    }

    const whereSQL = whereClauses.length > 0 ? " WHERE " + whereClauses.join(" AND ") : "";

    const countResult = await get<{ total: number }>(
      "SELECT COUNT(*) as total FROM issues i" + whereSQL,
      ...whereParams,
    );
    const total = countResult?.total || 0;

    const issues = await query(
      `SELECT i.*, p.name as project_name, p.icon as project_icon
       FROM issues i
       LEFT JOIN projects p ON i.project_id = p.id
       ${whereSQL}
       ORDER BY
         CASE i.status
           WHEN 'in_progress' THEN 0
           WHEN 'todo' THEN 1
           WHEN 'backlog' THEN 2
           WHEN 'done' THEN 3
           WHEN 'cancelled' THEN 4
         END,
         CASE i.priority
           WHEN 'urgent' THEN 0
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
           WHEN 'none' THEN 4
         END,
         i.sort_order, i.id DESC
       LIMIT ? OFFSET ?`,
      ...whereParams, limit, offset,
    );

    const issueIds = (issues as { id: number }[]).map((i) => i.id);
    let issueLabels: { issue_id: number; label_id: number; name: string; color: string }[] = [];
    if (issueIds.length > 0) {
      issueLabels = await query(
        `SELECT il.issue_id, il.label_id, l.name, l.color
         FROM issue_labels il
         JOIN labels l ON il.label_id = l.id
         WHERE il.issue_id IN (${issueIds.map(() => "?").join(",")})`,
        ...issueIds,
      );
    }

    const labelMap = new Map<number, { id: number; name: string; color: string }[]>();
    for (const il of issueLabels) {
      if (!labelMap.has(il.issue_id)) labelMap.set(il.issue_id, []);
      labelMap.get(il.issue_id)!.push({ id: il.label_id, name: il.name, color: il.color });
    }

    const enriched = (issues as { id: number }[]).map((issue) => ({
      ...issue,
      labels: labelMap.get(issue.id) || [],
    }));

    return c.json({ issues: enriched, total, page, limit }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createIssue = createRoute({
  method: "post",
  path: "/api/issues",
  tags: ["Issues"],
  summary: "Create a new issue",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        project_id: z.number().int().nullable().optional(),
        due_date: z.string().optional(),
        sort_order: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created issue", content: { "application/json": { schema: z.object({ issue: IssueSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createIssue, async (c) => {
  try {
    const body = c.req.valid("json");
    const title = body.title.trim();
    if (!title) return c.json({ error: "Title is required" }, 400);

    const identifier = await nextIdentifier();

    await run(
      `INSERT INTO issues (identifier, title, description, status, priority, project_id, due_date, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      identifier, title, body.description || "", body.status || "todo",
      body.priority || "none", body.project_id || null, body.due_date || "", body.sort_order || 0,
    );

    const issue = await get("SELECT * FROM issues WHERE identifier = ?", identifier);
    return c.json({ issue }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const getIssue = createRoute({
  method: "get",
  path: "/api/issues/{id}",
  tags: ["Issues"],
  summary: "Get issue details with labels and comments",
  request: { params: IdParam },
  responses: {
    200: { description: "Issue with labels and comments", content: { "application/json": { schema: z.object({ issue: IssueSchema.extend({ comments: z.array(CommentSchema) }) }) } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getIssue, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const issue = await get(
      `SELECT i.*, p.name as project_name, p.icon as project_icon
       FROM issues i LEFT JOIN projects p ON i.project_id = p.id WHERE i.id = ?`,
      id,
    );
    if (!issue) return c.json({ error: "Issue not found" }, 404);

    const labels = await query(
      `SELECT l.id, l.name, l.color FROM issue_labels il JOIN labels l ON il.label_id = l.id WHERE il.issue_id = ?`,
      id,
    );
    const comments = await query("SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC", id);

    return c.json({ issue: { ...issue, labels, comments } }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateIssue = createRoute({
  method: "put",
  path: "/api/issues/{id}",
  tags: ["Issues"],
  summary: "Update an issue",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        project_id: z.number().int().nullable().optional(),
        due_date: z.string().optional(),
        sort_order: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated issue", content: { "application/json": { schema: z.object({ issue: IssueSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateIssue, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const body = c.req.valid("json");
    const setClauses: string[] = [];
    const setParams: unknown[] = [];

    if (body.title !== undefined) { setClauses.push("title = ?"); setParams.push(body.title); }
    if (body.description !== undefined) { setClauses.push("description = ?"); setParams.push(body.description); }
    if (body.status !== undefined) { setClauses.push("status = ?"); setParams.push(body.status); }
    if (body.priority !== undefined) { setClauses.push("priority = ?"); setParams.push(body.priority); }
    if (body.project_id !== undefined) { setClauses.push("project_id = ?"); setParams.push(body.project_id || null); }
    if (body.due_date !== undefined) { setClauses.push("due_date = ?"); setParams.push(body.due_date); }
    if (body.sort_order !== undefined) { setClauses.push("sort_order = ?"); setParams.push(body.sort_order); }

    if (setClauses.length === 0) return c.json({ error: "No fields to update" }, 400);

    setClauses.push("updated_at = datetime('now')");
    setParams.push(id);

    const result = await run("UPDATE issues SET " + setClauses.join(", ") + " WHERE id = ?", ...setParams);
    if (result.changes === 0) return c.json({ error: "Issue not found" }, 404);

    const issue = await get("SELECT * FROM issues WHERE id = ?", id);
    return c.json({ issue }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteIssue = createRoute({
  method: "delete",
  path: "/api/issues/{id}",
  tags: ["Issues"],
  summary: "Delete an issue",
  request: { params: IdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteIssue, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const result = await run("DELETE FROM issues WHERE id = ?", id);
    if (result.changes === 0) return c.json({ error: "Issue not found" }, 404);

    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Issue Labels ───────────────────────────────────────────────────

const addIssueLabel = createRoute({
  method: "post",
  path: "/api/issues/{id}/labels",
  tags: ["Issue Labels"],
  summary: "Add a label to an issue",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ label_id: z.number().int() }) } },
    },
  },
  responses: {
    201: { description: "Label added", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addIssueLabel, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const issueId = parseInt(idStr, 10);
    if (isNaN(issueId)) return c.json({ error: "Invalid issue ID" }, 400);

    const body = c.req.valid("json");
    await run("INSERT OR IGNORE INTO issue_labels (issue_id, label_id) VALUES (?, ?)", issueId, body.label_id);
    return c.json({ ok: true }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const removeIssueLabel = createRoute({
  method: "delete",
  path: "/api/issues/{id}/labels/{lid}",
  tags: ["Issue Labels"],
  summary: "Remove a label from an issue",
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Issue ID" }),
      lid: z.string().openapi({ description: "Label ID" }),
    }),
  },
  responses: {
    200: { description: "Label removed", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(removeIssueLabel, async (c) => {
  try {
    const params = c.req.valid("param");
    const issueId = parseInt(params.id, 10);
    const labelId = parseInt(params.lid, 10);
    if (isNaN(issueId) || isNaN(labelId)) return c.json({ error: "Invalid ID" }, 400);

    await run("DELETE FROM issue_labels WHERE issue_id = ? AND label_id = ?", issueId, labelId);
    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Comments ───────────────────────────────────────────────────────

const listComments = createRoute({
  method: "get",
  path: "/api/issues/{id}/comments",
  tags: ["Comments"],
  summary: "List comments for an issue",
  request: { params: IdParam },
  responses: {
    200: { description: "Comments list", content: { "application/json": { schema: z.object({ comments: z.array(CommentSchema) }) } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listComments, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const issueId = parseInt(idStr, 10);
    if (isNaN(issueId)) return c.json({ error: "Invalid issue ID" }, 400);

    const comments = await query("SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC", issueId);
    return c.json({ comments }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createComment = createRoute({
  method: "post",
  path: "/api/issues/{id}/comments",
  tags: ["Comments"],
  summary: "Add a comment to an issue",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ content: z.string().min(1) }) } },
    },
  },
  responses: {
    201: { description: "Created comment", content: { "application/json": { schema: z.object({ comment: CommentSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createComment, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const issueId = parseInt(idStr, 10);
    if (isNaN(issueId)) return c.json({ error: "Invalid issue ID" }, 400);

    const body = c.req.valid("json");
    const content = body.content.trim();
    if (!content) return c.json({ error: "Content is required" }, 400);

    await run("INSERT INTO comments (issue_id, content) VALUES (?, ?)", issueId, content);
    const comment = await get("SELECT * FROM comments WHERE rowid = last_insert_rowid()");
    return c.json({ comment }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteComment = createRoute({
  method: "delete",
  path: "/api/comments/{cid}",
  tags: ["Comments"],
  summary: "Delete a comment",
  request: {
    params: z.object({ cid: z.string().openapi({ description: "Comment ID" }) }),
  },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteComment, async (c) => {
  try {
    const { cid } = c.req.valid("param");
    const id = parseInt(cid, 10);
    if (isNaN(id)) return c.json({ error: "Invalid comment ID" }, 400);

    const result = await run("DELETE FROM comments WHERE id = ?", id);
    if (result.changes === 0) return c.json({ error: "Comment not found" }, 404);

    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Projects ───────────────────────────────────────────────────────

const listProjects = createRoute({
  method: "get",
  path: "/api/projects",
  tags: ["Projects"],
  summary: "List projects with pagination and issue counts",
  request: {
    query: z.object({
      page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
      limit: z.string().optional().openapi({ description: "Items per page (default: 25, max: 100)" }),
    }),
  },
  responses: {
    200: {
      description: "Paginated projects",
      content: { "application/json": { schema: z.object({
        projects: z.array(ProjectSchema),
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listProjects, async (c) => {
  try {
    const q = c.req.valid("query");
    const page = Math.max(1, parseInt(q.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || "25", 10)));
    const offset = (page - 1) * limit;

    const countResult = await get<{ total: number }>("SELECT COUNT(*) as total FROM projects");
    const total = countResult?.total || 0;

    const projects = await query(
      `SELECT p.*,
         (SELECT COUNT(*) FROM issues WHERE project_id = p.id) as issue_count,
         (SELECT COUNT(*) FROM issues WHERE project_id = p.id AND status = 'done') as done_count
       FROM projects p ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      limit, offset,
    );

    return c.json({ projects, total, page, limit }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const allProjects = createRoute({
  method: "get",
  path: "/api/projects/all",
  tags: ["Lookups"],
  summary: "Get all projects for dropdown selects",
  responses: {
    200: {
      description: "All projects (id, name, icon)",
      content: { "application/json": { schema: z.object({
        projects: z.array(z.object({ id: z.number().int(), name: z.string(), icon: z.string() })),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(allProjects, async (c) => {
  try {
    const projects = await query("SELECT id, name, icon FROM projects ORDER BY name");
    return c.json({ projects }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createProject = createRoute({
  method: "post",
  path: "/api/projects",
  tags: ["Projects"],
  summary: "Create a new project",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().min(1),
        icon: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        lead: z.string().optional(),
        start_date: z.string().optional(),
        target_date: z.string().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created project", content: { "application/json": { schema: z.object({ project: ProjectSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createProject, async (c) => {
  try {
    const body = c.req.valid("json");
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name is required" }, 400);

    await run(
      `INSERT INTO projects (name, icon, description, status, priority, lead, start_date, target_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      name, body.icon || "📋", body.description || "", body.status || "planned",
      body.priority || "none", body.lead || "", body.start_date || "", body.target_date || "",
    );

    const project = await get("SELECT * FROM projects WHERE rowid = last_insert_rowid()");
    return c.json({ project }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateProject = createRoute({
  method: "put",
  path: "/api/projects/{id}",
  tags: ["Projects"],
  summary: "Update a project",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().optional(),
        icon: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        lead: z.string().optional(),
        start_date: z.string().optional(),
        target_date: z.string().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated project", content: { "application/json": { schema: z.object({ project: ProjectSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateProject, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const body = c.req.valid("json");
    const setClauses: string[] = [];
    const setParams: unknown[] = [];

    if (body.name !== undefined) { setClauses.push("name = ?"); setParams.push(body.name); }
    if (body.icon !== undefined) { setClauses.push("icon = ?"); setParams.push(body.icon); }
    if (body.description !== undefined) { setClauses.push("description = ?"); setParams.push(body.description); }
    if (body.status !== undefined) { setClauses.push("status = ?"); setParams.push(body.status); }
    if (body.priority !== undefined) { setClauses.push("priority = ?"); setParams.push(body.priority); }
    if (body.lead !== undefined) { setClauses.push("lead = ?"); setParams.push(body.lead); }
    if (body.start_date !== undefined) { setClauses.push("start_date = ?"); setParams.push(body.start_date); }
    if (body.target_date !== undefined) { setClauses.push("target_date = ?"); setParams.push(body.target_date); }

    if (setClauses.length === 0) return c.json({ error: "No fields to update" }, 400);

    setClauses.push("updated_at = datetime('now')");
    setParams.push(id);

    const result = await run("UPDATE projects SET " + setClauses.join(", ") + " WHERE id = ?", ...setParams);
    if (result.changes === 0) return c.json({ error: "Project not found" }, 404);

    const project = await get("SELECT * FROM projects WHERE id = ?", id);
    return c.json({ project }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteProject = createRoute({
  method: "delete",
  path: "/api/projects/{id}",
  tags: ["Projects"],
  summary: "Delete a project",
  request: { params: IdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteProject, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const result = await run("DELETE FROM projects WHERE id = ?", id);
    if (result.changes === 0) return c.json({ error: "Project not found" }, 404);

    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Labels ─────────────────────────────────────────────────────────

const listLabels = createRoute({
  method: "get",
  path: "/api/labels",
  tags: ["Labels"],
  summary: "List all labels",
  responses: {
    200: { description: "All labels", content: { "application/json": { schema: z.object({ labels: z.array(LabelSchema) }) } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listLabels, async (c) => {
  try {
    const labels = await query("SELECT * FROM labels ORDER BY name");
    return c.json({ labels }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const allLabels = createRoute({
  method: "get",
  path: "/api/labels/all",
  tags: ["Lookups"],
  summary: "Get all labels for dropdown selects",
  responses: {
    200: {
      description: "All labels (id, name, color)",
      content: { "application/json": { schema: z.object({
        labels: z.array(z.object({ id: z.number().int(), name: z.string(), color: z.string() })),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(allLabels, async (c) => {
  try {
    const labels = await query("SELECT id, name, color FROM labels ORDER BY name");
    return c.json({ labels }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createLabel = createRoute({
  method: "post",
  path: "/api/labels",
  tags: ["Labels"],
  summary: "Create a new label",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().min(1),
        color: z.string().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created label", content: { "application/json": { schema: z.object({ label: LabelSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createLabel, async (c) => {
  try {
    const body = c.req.valid("json");
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name is required" }, 400);

    await run("INSERT INTO labels (name, color) VALUES (?, ?)", name, body.color || "#6b7280");
    const label = await get("SELECT * FROM labels WHERE rowid = last_insert_rowid()");
    return c.json({ label }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateLabel = createRoute({
  method: "put",
  path: "/api/labels/{id}",
  tags: ["Labels"],
  summary: "Update a label",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().optional(),
        color: z.string().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated label", content: { "application/json": { schema: z.object({ label: LabelSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateLabel, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const body = c.req.valid("json");
    const setClauses: string[] = [];
    const setParams: unknown[] = [];

    if (body.name !== undefined) { setClauses.push("name = ?"); setParams.push(body.name); }
    if (body.color !== undefined) { setClauses.push("color = ?"); setParams.push(body.color); }

    if (setClauses.length === 0) return c.json({ error: "No fields to update" }, 400);

    setParams.push(id);
    const result = await run("UPDATE labels SET " + setClauses.join(", ") + " WHERE id = ?", ...setParams);
    if (result.changes === 0) return c.json({ error: "Label not found" }, 404);

    const label = await get("SELECT * FROM labels WHERE id = ?", id);
    return c.json({ label }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteLabel = createRoute({
  method: "delete",
  path: "/api/labels/{id}",
  tags: ["Labels"],
  summary: "Delete a label",
  request: { params: IdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteLabel, async (c) => {
  try {
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const result = await run("DELETE FROM labels WHERE id = ?", id);
    if (result.changes === 0) return c.json({ error: "Label not found" }, 404);

    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── OpenAPI Doc ────────────────────────────────────────────────────

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "Todo App", version: "1.0.0", description: "A Linear-style issue tracker with projects, labels, and comments." },
});

export default app;
