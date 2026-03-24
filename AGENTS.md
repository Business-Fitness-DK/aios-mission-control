# AIOS Agents

## Department Heads (Master Agents)

### CEO
- **Workspace:** `/Users/marinushvelplund/AIOS/`
- **Role:** Chief Executive — routes to departments, owns root-level decisions
- **Interface:** Slack (@ceo), Claude Code CLI

### CTO
- **Workspace:** `/Users/marinushvelplund/AIOS/dept_tech/`
- **Role:** Engineering, deployments, infrastructure, GitHub, AWS, Vercel
- **Interface:** Slack (@cto), Claude Code CLI

### CMO
- **Workspace:** `/Users/marinushvelplund/AIOS/dept_marketing/`
- **Role:** Campaigns, ads, content, social media
- **Interface:** Slack (@cmo), Claude Code CLI
- **Sub-agents:** SEO, Copy, Image Generation (banana-squad), Newsletter

### Head of Product
- **Workspace:** `/Users/marinushvelplund/AIOS/dept_product/`
- **Role:** Product, onboarding, Blueprint, client health, client-facing materials
- **Interface:** Slack (@product), Claude Code CLI
- **Sub-agents:** Client Pulse

### Head of Sales
- **Workspace:** `/Users/marinushvelplund/AIOS/dept_sales/`
- **Role:** Sales calls, closing, objection handling, call analysis
- **Interface:** Slack (@sales), Claude Code CLI

### COO
- **Workspace:** `/Users/marinushvelplund/AIOS/dept_operations/`
- **Role:** AIOS platform, internal tools, business operations, agent orchestration
- **Interface:** Claude Code CLI

## Specialized Agents (Skills)

### banana-squad
- **Department:** Marketing
- **Location:** `.claude/skills/banana-squad/`
- **Role:** Image generation using Gemini 3 Pro Image API

### newsletter
- **Department:** Marketing
- **Location:** `.claude/skills/newsletter/`
- **Role:** Newsletter style analysis and generation

### client-pulse
- **Department:** Product
- **Location:** `dept_product/.claude/skills/client-pulse/`
- **Role:** Pull live client performance data and update health status

### backlog
- **Department:** Root
- **Location:** `.claude/skills/backlog/`
- **Role:** Submit, analyze, and review backlog items

### gws
- **Department:** Root
- **Location:** `.claude/skills/gws/`
- **Role:** Google Workspace integration (Drive, Docs, Sheets, Gmail, Calendar, Tasks)

### d2-diagram
- **Department:** Root
- **Location:** `.claude/skills/d2-diagram/`
- **Role:** D2 diagram generation

## Personal Assistants

### Marinus PA
- **Workspace:** `/Users/marinushvelplund/AIOS/dept_personal-assistants/marinus-workspace/`
- **Role:** Daily briefing, task management, email triage
- **Google account:** marinus@businessandfitness.dk
- **Interface:** Slack DM, Claude Code CLI

### Rune PA
- **Workspace:** `/Users/marinushvelplund/AIOS/dept_personal-assistants/rune-laursen-workspace/`
- **Role:** Daily briefing, task management, email triage
- **Google account:** rune@businessandfitness.dk
- **Interface:** Slack DM

## Runtime

All agents run via **Claude Agent SDK** through the Slack bot (`dept_tech/projects/slack-agents/`). Each Slack thread = one persistent Claude Code session. Department heads are master agents; specialized agents are skills available within the department workspace.
