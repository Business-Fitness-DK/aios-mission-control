# AIOS Mission Control — Updated Spec

**Status:** Ready for implementation
**Owner:** Tech (CTO)
**Date:** 2026-03-16 (updated from 2026-03-13)
**Users:** Marinus, Rune
**Codebase:** `dept_tech/projects/aios-mission-control/` (forked from builderz-labs/mission-control, to be gutted and rebuilt)

---

## Decision: Fork vs Fresh

The forked Mission Control (`builderz-labs/mission-control`) is a generic agent orchestration dashboard with SQLite, OpenClaw gateway, task kanban, etc. Almost none of it applies to AIOS. However, the scaffolding is useful: Next.js 16, React 19, Tailwind, shadcn/ui patterns, auth, Docker support, standalone output.

**Decision: gut the fork.** Keep the Next.js skeleton, Tailwind config, auth scaffolding, and build pipeline. Remove all OpenClaw/gateway/SQLite/task/agent logic. Replace with AIOS-specific pages that read from GitHub API.

This avoids creating a separate repo and gives us a working build system on day one.

---

## 1. Data Source Map

Every UI element traces to a specific file or command in the AIOS repo (`Business-Fitness-DK/AIOS`).

### Departments

| UI Element | Source | How to read |
|-----------|--------|------------|
| Department list | `dept_*/` directories at repo root | GitHub API: list repo contents at `/` filtered to `dept_*` prefix |
| Department info | `dept_*/CLAUDE.md` | GitHub API: get file contents |
| Department role | First `You are the ...` line in each `CLAUDE.md` | Parse from markdown content |

**Departments detected from filesystem (no hardcoded list):**
- `dept_tech/` (CTO)
- `dept_marketing/` (CMO)
- `dept_product/` (Head of Product)
- `dept_sales/` (Head of Sales)
- `dept_personal-assistants/` (Personal Assistants)

### Agents

Two types of agents exist, stored in different places:

| Type | Location pattern | Example files |
|------|-----------------|---------------|
| **Department heads** (master agents) | `.claude/agents/*.md` | `ceo.md`, `cto.md`, `cmo.md`, `product.md`, `sales.md`, `pa-marinus.md`, `pa-rune.md` |
| **Sub-agents** (department-level) | `dept_*/.claude/agents/*.md` | `dept_marketing/.claude/agents/banana-squad.md`, `dept_marketing/.claude/agents/newsletter.md` |

Agent file format (frontmatter):
```yaml
---
name: cto
description: "CTO — Engineering, deployments, ..."
model: sonnet
workspace: /Users/marinushvelplund/AIOS/dept_tech
---
```

### Skills

| Location pattern | Example files |
|-----------------|---------------|
| `.claude/skills/*/SKILL.md` | `gws/SKILL.md`, `backlog/SKILL.md`, `d2-diagram/SKILL.md` |
| `dept_*/.claude/skills/*/SKILL.md` | `dept_tech/.claude/skills/vercel/SKILL.md`, `dept_product/.claude/skills/client-pulse/SKILL.md`, `dept_marketing/.claude/skills/banana-squad/SKILL.md` |

Skill file format (frontmatter):
```yaml
---
name: gws
description: "Interact with Google Workspace ..."
---
```

### Projects

| UI Element | Source | How to read |
|-----------|--------|------------|
| Active projects | `projects/active/*.md` | List directory, parse each file |
| Paused projects | `projects/paused/*.md` | Same |
| Completed projects | `projects/completed/*.md` | Same |
| Project index | `projects/README.md` | Parse table for quick overview |
| Department project dirs | `dept_*/projects/` | Each department may have project subdirs with specs |

Project file format (from `projects/_template.md`):
```markdown
# {Project Name}

| Field | Value |
|-------|-------|
| **Owner** | {dept / person} |
| **Departments** | {dept_tech, dept_product, etc.} |
| **Created** | {YYYY-MM-DD} |
| **Updated** | {YYYY-MM-DD} |

## Description
...

## Current Status
...

## Where Things Live
| What | Location |
|------|----------|
| **Code** | ... |
| **Spec** | ... |
...

## Plan
...

## Log
| Date | Update |
|------|--------|
```

Parse the metadata table at the top for Owner, Departments, Created, Updated.

### Backlog

| UI Element | Source | How to read |
|-----------|--------|------------|
| Submitted items | `backlog/submitted/*.md` | List directory, parse each file |
| Approved items | `backlog/approved/*.md` | Same |
| Done items | `backlog/done/*.md` | Same |
| Rejected items | `backlog/rejected/*.md` | Same |
| Pipeline summary | `backlog/PIPELINE.md` | Parse tables for overview |

Backlog file format (frontmatter):
```yaml
---
id: BL-001
title: Rolling time periods with comparison graphs
requested_by: Rune
date: 2026-03-11
verdict: BUILD    # BUILD | MAYBE | SKIP
effort: medium    # small | medium | large
status: submitted # submitted | approved | done | rejected
---
```

### Activity Feed

| UI Element | Source | How to read |
|-----------|--------|------------|
| Recent activity | `git log` via GitHub API | GitHub API: list commits (up to 100) |
| Activity per department | `git log -- dept_*/` | GitHub API: list commits filtered by path |
| Activity per project | `git log -- projects/active/slug.md` or `git log -- dept_*/projects/name/` | Same, path-scoped |

GitHub commit object gives: `sha`, `commit.message`, `commit.author.name`, `commit.author.date`, `files[]` (with path filter).

### Google Workspace Links

| UI Element | Source | How to read |
|-----------|--------|------------|
| Project resources | `resources.md` in any project directory | Parse markdown for Google URLs |
| "Where Things Live" table | Project files (`projects/active/*.md`) | Parse the `## Where Things Live` section for links |

Convention: URLs matching `docs.google.com`, `sheets.google.com`, `slides.google.com`, `drive.google.com` are extracted and labeled.

### Review Gates / Needs Attention

| Signal | Source | Detection |
|--------|--------|-----------|
| Approved backlog items (ready to build) | `backlog/approved/*.md` | Any file in this directory |
| Review gate markers in project plans | `projects/active/*.md` | Lines containing `REVIEW GATE:` |
| "needs review" in project status | `projects/active/*.md` | `## Current Status` section containing "waiting for review", "needs review", "waiting for approval" |

---

## 2. Data Model (Relationships)

```
AIOS Repo
├── Departments (dept_*/)
│   ├── has CLAUDE.md (identity, responsibilities)
│   ├── has Projects (dept_*/projects/*/)
│   ├── has Agents (dept_*/.claude/agents/*.md)
│   ├── has Skills (dept_*/.claude/skills/*/SKILL.md)
│   └── has Activity (git commits touching dept_*/)
│
├── Root Agents (.claude/agents/*.md)
│   ├── each has: name, description, model, workspace
│   ├── workspace path → maps to a Department
│   └── hierarchy: CEO → department heads → sub-agents
│
├── Root Skills (.claude/skills/*/SKILL.md)
│   └── each has: name, description
│
├── Projects (projects/{active,paused,completed}/*.md)
│   ├── each has: owner, departments[], status (by folder), plan, log
│   ├── references Department(s) via "Departments" field
│   ├── references Code location (dept_*/projects/*)
│   ├── references Spec location (dept_*/projects/*)
│   ├── may have resources.md with Google links
│   └── has Activity (git commits touching project files)
│
├── Backlog (backlog/{submitted,approved,done,rejected}/*.md)
│   ├── each has: id, title, verdict, effort, status, requested_by
│   ├── may reference a Department via content
│   └── status = which folder it's in (source of truth)
│
└── Activity (git log)
    ├── each commit has: sha, author, date, message, files[]
    ├── files[] → maps to Departments, Projects
    └── author → maps to Agents or Humans
```

### Key relationships:
- **Agent → Department**: Agent's `workspace` path maps to `dept_*/`. E.g., workspace `/AIOS/dept_tech` → `dept_tech`.
- **Project → Department**: Project's `Departments` field lists `dept_tech, dept_product`, etc.
- **Project → Code**: The "Where Things Live" table links to `dept_*/projects/name/`.
- **Backlog → Department**: The `department` field in approved items (e.g., `dept_tech/`).
- **Activity → Department/Project**: Each commit's changed files map to paths under departments or projects.

---

## 3. Conventions to Define

### 3.1 Agent hierarchy (for org chart)

The org chart is implicit but can be derived:

| Level | How to detect |
|-------|--------------|
| CEO | `.claude/agents/ceo.md` — workspace is repo root |
| Department heads | `.claude/agents/{cto,cmo,product,sales}.md` — workspace is a `dept_*/` directory |
| Personal assistants | `.claude/agents/pa-*.md` — workspace is `dept_personal-assistants/*/` |
| Sub-agents | `dept_*/.claude/agents/*.md` — live inside a department |

**Convention to enforce:** Every agent's `workspace` field in frontmatter must be an absolute path. The dashboard strips the prefix to get the relative AIOS path and maps it to a department.

### 3.2 "Needs Attention" detection

Items surfaced in the "Needs Your Attention" widget on the Home page:

1. **Approved backlog items**: Any `.md` file in `backlog/approved/` = approved and waiting to be built.
2. **Review gate markers**: Any line in `projects/active/*.md` matching the pattern `REVIEW GATE:` that is preceded by an unchecked checkbox `- [ ]`.
3. **Status keywords**: The `## Current Status` section of any active project containing: "waiting for review", "needs review", "waiting for approval", "blocked".

### 3.3 Project status

Status is determined by folder location, not a frontmatter field:
- `projects/active/` = in progress
- `projects/paused/` = on hold
- `projects/completed/` = done

No additional status convention needed. The "Current Status" freetext section provides detail.

### 3.4 Commit message parsing

Commits from agents follow no strict format today. The dashboard should:
- Show the raw commit message
- Extract file paths from the commit to determine which departments/projects are affected
- Use the author name to identify agent vs human
- Do NOT depend on conventional commit format — parse what exists

### 3.5 Agent-to-department mapping

Map agent → department using the `workspace` frontmatter field:
- If workspace contains `dept_tech` → Tech department
- If workspace contains `dept_marketing` → Marketing department
- If workspace is the repo root → Root / CEO level
- Sub-agents inherit their parent department from their file location (`dept_*/.claude/agents/`)

---

## 4. MVP Priorities (Build Order)

Ranked by daily use value:

### Tier 1 — Build first (daily use, immediate value)

1. **Home page** (`/`)
   - Activity feed (last 50 commits, parsed into human-readable cards)
   - "Needs Your Attention" section (approved backlog + review gates + status keywords)
   - Department cards with project counts
   - Quick stats (total projects, agents, backlog items)

2. **Department view** (`/dept/[name]`)
   - Rendered CLAUDE.md
   - Project list (linked from `projects/active/*.md` where departments match)
   - Agent list (from `dept_*/.claude/agents/` and root agents mapped to this dept)
   - Skill list (from `dept_*/.claude/skills/`)
   - Recent activity filtered to this department

3. **Project view** (`/project/[slug]`)
   - Parsed project file (metadata table, status, plan, log)
   - Google Workspace links (from "Where Things Live" table and `resources.md`)
   - Git history for this project's files

### Tier 2 — Build second (weekly use, operational value)

4. **Backlog** (`/backlog`)
   - Kanban columns: Submitted, Approved, Done
   - Cards show: ID, title, verdict badge (BUILD/MAYBE/SKIP), effort, requested_by
   - Color coding: BUILD=green, MAYBE=amber, SKIP=red

5. **Agent directory** (`/agents`)
   - Org chart: CEO at top, department heads below, sub-agents and PAs branching off
   - Click to see agent details (name, description, model, workspace, skills available)
   - Department grouping

### Tier 3 — Build later (high value but complex)

6. **Chat** (`/chat`)
   - Select an agent (department head or sub-agent)
   - Streaming chat via Claude API
   - Agent gets its department's CLAUDE.md as system prompt
   - Can read/write AIOS repo files

---

## 5. Tech Stack

- **Framework:** Next.js (keep the forked v16 + App Router)
- **Data source:** GitHub API via `octokit` (read-only PAT on `Business-Fitness-DK/AIOS`)
- **Caching:** ISR with 60-second revalidation (fine for 2 users, 5000 req/hr free tier)
- **Auth:** Keep the existing auth from the fork, restrict to `@businessandfitness.dk` Google accounts
- **Styling:** Tailwind + shadcn/ui (already in fork)
- **Markdown:** `gray-matter` for frontmatter parsing, `react-markdown` + `remark-gfm` (already in fork) for rendering
- **Deploy:** Vercel under `businessandfitness` team at `aios.businessandfitness.dk`
- **No database:** Remove SQLite entirely. GitHub API is the only data source.
- **AI (for Chat, Tier 3):** Claude API with streaming

---

## 6. API Routes

```
GET /api/activity                  → git log (last 50-100 commits)
GET /api/activity?dept=marketing   → git log filtered to dept_marketing/
GET /api/activity?path=projects/active/ceo-dashboard.md → git log for specific path

GET /api/departments               → list dept_*/ dirs with CLAUDE.md metadata
GET /api/dept/[name]               → full department data: CLAUDE.md + projects + agents + skills

GET /api/projects                  → all project files from projects/{active,paused,completed}/
GET /api/project/[slug]            → single project: parsed file + resources.md + "Where Things Live" links

GET /api/agents                    → all agents: .claude/agents/*.md + dept_*/.claude/agents/*.md
GET /api/skills                    → all skills: .claude/skills/*/SKILL.md + dept_*/.claude/skills/*/SKILL.md

GET /api/backlog                   → all backlog items grouped by status folder
GET /api/backlog/[id]              → single backlog item

GET /api/review-gates              → aggregated "needs attention" items

GET /api/file/[...path]            → raw markdown content for any file

POST /api/chat                     → Claude API streaming (Tier 3)
```

All GET routes use `octokit` with a fine-grained PAT (read-only on AIOS repo). Cached with ISR (revalidate 60s).

---

## 7. What to Remove from the Fork

The forked `builderz-labs/mission-control` contains extensive infrastructure we do not need:

| Remove | Reason |
|--------|--------|
| `src/lib/db.ts`, `schema.sql`, `migrations.ts` | No SQLite — GitHub API is our data source |
| `src/lib/agent-*.ts` (sync, templates, evals, optimizer, workspace) | AIOS agents are defined in markdown, not SQLite |
| `src/lib/claude-sessions.ts`, `codex-sessions.ts` | Different session model |
| `src/lib/task-*.ts` (costs, dispatch, routing, status) | AIOS uses backlog/ directory, not task tables |
| `src/lib/gateway-*.ts`, `openclaw-*.ts` | OpenClaw gateway not used |
| `src/lib/webhooks.ts`, `websocket*.ts` | Not needed for MVP (read-only GitHub API) |
| `src/lib/skill-*.ts` | Skills are markdown files, not registry entries |
| `src/lib/cron-*.ts`, `scheduler.ts` | No scheduling in MVP |
| `src/lib/hermes-*.ts` | Hermes not used |
| `src/lib/github-sync-*.ts` | We read GitHub directly, not sync to SQLite |
| `src/app/[[...panel]]/` | Replace with AIOS-specific pages |
| `src/app/api/` | Replace with AIOS-specific API routes |
| `openapi.json` | Not applicable |
| `tests/` | Will be replaced with AIOS-specific tests |
| `better-sqlite3` dependency | Remove entirely |

**Keep:**
- Next.js config, Tailwind config, postcss
- Auth scaffolding (adapt for Google whitelist)
- `src/lib/utils.ts`, `src/styles/`
- Docker support, standalone output config
- `pnpm` setup, `.node-version`
- Basic component patterns from `src/components/` (adapt for AIOS)

---

## 8. Implementation Phases

### Phase 1: Gut Fork + Home Page (Tech builds)

- [ ] Remove all OpenClaw/SQLite/gateway/task/agent infrastructure listed above
- [ ] Add `octokit` dependency, create `src/lib/github.ts` with authenticated client
- [ ] Create `src/lib/aios/` module with parsers:
  - `parse-frontmatter.ts` — generic gray-matter wrapper
  - `parse-project.ts` — extract metadata table, status section, plan, log from project files
  - `parse-backlog.ts` — extract frontmatter from backlog items
  - `parse-agent.ts` — extract frontmatter from agent files
  - `parse-skill.ts` — extract frontmatter from skill files
  - `parse-activity.ts` — transform GitHub commit objects into activity feed items
  - `parse-resources.ts` — extract Google Workspace links from resources.md and "Where Things Live" tables
  - `parse-review-gates.ts` — detect review gate markers, approved backlog, status keywords
- [ ] Build Home page: activity feed + "Needs Attention" + department cards + stats
- [ ] Set up auth (Google OAuth, whitelist marinus@, rune@businessandfitness.dk)
- [ ] Deploy to Vercel, configure DNS for aios.businessandfitness.dk

**Review gate:** Marinus reviews Home page. Does the activity feed make sense? Is "Needs Your Attention" surfacing the right items?

### Phase 2: Department + Project Views (Tech builds)

- [ ] Build Department view: rendered CLAUDE.md + projects + agents + skills + filtered activity
- [ ] Build Project view: parsed metadata + plan + Google links + git history
- [ ] Navigation: Home -> Department -> Project with breadcrumbs

**Review gate:** Can you find everything you need by browsing? Are Google links parsed correctly?

### Phase 3: Backlog + Agent Directory (Tech builds)

- [ ] Build Backlog kanban: columns per status, color-coded verdict badges
- [ ] Build Agent directory: org chart with CEO -> dept heads -> sub-agents
- [ ] Agent detail view: name, description, model, workspace, available skills

**Review gate:** Does the backlog view match PIPELINE.md? Does the org chart accurately reflect the agent hierarchy?

### Phase 4: Agent Runtime + Chat Interface (Tech builds — deferred, Tier 3)

**Architecture:** The chat feature needs the Claude Agent SDK (Python) to spawn and manage agent sessions. This requires a Python sidecar service alongside the Next.js dashboard.

```
┌─────────────────────────────┐     ┌──────────────────────────────┐
│  Next.js Dashboard (Vercel) │────▶│  Python Sidecar (persistent) │
│  Chat UI, SSE streaming     │     │  Claude Agent SDK runtime    │
└─────────────────────────────┘     └──────────────────────────────┘
                                                 │
                                    ┌────────────┴────────────┐
                                    │  Slack Bot (existing)    │
                                    │  (also uses the runtime) │
                                    └─────────────────────────┘
```

**Runtime extraction from slack-agents:**

| File | Source | Reusability |
|------|--------|-------------|
| `agent_sdk.py` | `slack-agents/scripts/apps/slackbot/` | 100% — zero Slack references |
| `worker.py` | same | 100% — thin wrapper |
| `session_manager.py` | same | 100% — JSON file-based persistence |
| `cost_tracker.py` | same | 100% — JSONL logging |
| `work_log.py` | same | 100% — per-session logs |
| `sandbox.py` | same | 100% — PA sandboxing |
| `agents.py` | same | 95% — remove `_SLACK_STYLE`, add generic style |
| `config.py` | NEW | Runtime-only config (no Slack tokens) |
| `server.py` | NEW | Starlette HTTP server (~150 lines) |

**Sidecar API endpoints:**
```
POST /run          — Start new agent session (agent name, prompt)
POST /continue     — Continue existing session (session_id, message)
GET  /sessions     — List active sessions with metadata
GET  /sessions/:id — Get session details + work log
DELETE /sessions/:id — End session
GET  /agents       — List available agents (from .claude/agents/)
GET  /costs        — Cost data (daily, per-agent)
GET  /health       — Health check
```

**Sidecar structure:**
```
dept_tech/projects/aios-mission-control/sidecar/
├── aios_runtime/
│   ├── __init__.py
│   ├── agent_sdk.py, worker.py, session_manager.py
│   ├── cost_tracker.py, work_log.py, sandbox.py
│   ├── agents.py (adapted — no Slack style)
│   └── config.py (new — runtime-only)
├── server.py
├── requirements.txt
└── Dockerfile
```

**Implementation tasks:**
- [ ] Extract runtime files from slack-agents into `sidecar/aios_runtime/`
- [ ] Build `server.py` with Starlette + uvicorn
- [ ] Chat page: agent selector, message input, streaming SSE display
- [ ] Connect chat UI to sidecar `/run` and `/continue` endpoints
- [ ] Session history (list past conversations, resume)
- [ ] Cost display per session
- [ ] Spawn agents from Agent Directory page (calls sidecar `/run`)
- [ ] Update slack-agents to import from shared `aios_runtime/` (no duplication)

**Deployment:** Sidecar runs on a persistent server (Mac locally or Lightsail ~$12/mo). Dashboard stays on Vercel, calls sidecar API for chat only. Cannot use Vercel serverless functions — agent sessions run 30-120+ seconds.

**Review gate:** Can Marinus chat with CEO and have it spawn CMO for a marketing task? Does streaming work? Are costs tracked?

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| GitHub API rate limits | ISR caching (revalidate 60s). 5000 req/hr free tier covers 2 users easily. |
| Frontmatter format inconsistency | Graceful fallback — show raw content if parsing fails. Add validation to agent/skill templates. |
| "Needs Attention" false positives | Start conservative (only exact matches). Iterate with Marinus based on what surfaces. |
| Fork divergence | We are gutting, not tracking upstream. This is intentional — we own it now. |
| resources.md not adopted everywhere | Show "No resources linked" gracefully. The dashboard creates incentive to adopt. |
| Agent workspace paths are absolute (machine-specific) | Strip known prefix (`/Users/marinushvelplund/AIOS/`) to get relative path. |

---

## 10. Success Criteria

- Dashboard loads at aios.businessandfitness.dk with Google auth
- Home page shows last 50 commits as human-readable activity feed
- "Needs Your Attention" surfaces approved backlog items and review gates
- Can browse all 7 active projects with metadata, Google links, and git history
- Department views show CLAUDE.md, projects, agents, and skills for each dept
- Backlog kanban shows items in correct columns with verdict color coding
- Agent directory shows full org chart with department grouping
- Marinus and Rune can both log in and use it daily
