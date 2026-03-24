/**
 * Local Agent Sync — Discovers agent definitions from local directories
 * and syncs them bidirectionally with the MC database.
 *
 * Scans:
 *   ~/.agents/         — top-level dirs with agent config files
 *   ~/.codex/agents/   — Codex agent definitions
 *   ~/.claude/agents/  — Claude agent definitions (if present)
 *
 * A directory counts as an agent if it contains one of:
 *   AGENT.md, agent.md, soul.md, identity.md, config.json, agent.json
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getDatabase, logAuditEvent } from './db'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiskAgent {
  name: string
  dir: string
  role: string
  soulContent: string | null
  configContent: string | null
  contentHash: string
}

interface AgentRow {
  id: number
  name: string
  role: string
  soul_content: string | null
  status: string
  source: string | null
  content_hash: string | null
  workspace_path: string | null
  config: string | null
}

// Detection files — order matters: first found wins for role extraction
const IDENTITY_FILES = ['soul.md', 'AGENT.md', 'agent.md', 'identity.md', 'SKILL.md']
const CONFIG_FILES = ['config.json', 'agent.json']
const ALL_MARKERS = [...IDENTITY_FILES, ...CONFIG_FILES]

// YAML frontmatter fields for flat .md agent files (Claude Code format)
interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string
  color?: string
  tools?: string[]
  workspace?: string
}

function parseYamlFrontmatter(content: string): { frontmatter: AgentFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  const raw = match[1]
  const body = match[2]
  const fm: AgentFrontmatter = {}
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/)
    if (!kv) continue
    const [, key, val] = kv
    const cleaned = val.replace(/^["']|["']$/g, '').trim()
    if (key === 'name') fm.name = cleaned
    else if (key === 'description') fm.description = cleaned
    else if (key === 'model') fm.model = cleaned
    else if (key === 'color') fm.color = cleaned
    else if (key === 'workspace') fm.workspace = cleaned
    else if (key === 'tools') {
      try { fm.tools = JSON.parse(val) } catch { /* ignore */ }
    }
  }
  return { frontmatter: fm, body }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function extractRole(content: string): string {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  // Look for "role:" or "theme:" in first 10 lines
  for (const line of lines.slice(0, 10)) {
    const match = line.match(/^(?:role|theme)\s*:\s*(.+)$/i)
    if (match?.[1]) return match[1].trim()
  }
  return 'agent'
}

function getLocalAgentRoots(): string[] {
  const home = homedir()
  const roots = [
    join(home, '.agents'),
    join(home, '.codex', 'agents'),
    join(home, '.claude', 'agents'),
    join(home, '.hermes', 'skills'),
  ]

  // Add AIOS agent directories (root + all departments)
  const aiosRoot = getAiosRoot()
  if (aiosRoot) {
    roots.push(join(aiosRoot, '.claude', 'agents'))
    try {
      const entries = readdirSync(aiosRoot)
      for (const entry of entries) {
        if (!entry.startsWith('dept_')) continue
        const deptAgents = join(aiosRoot, entry, '.claude', 'agents')
        if (existsSync(deptAgents)) roots.push(deptAgents)
      }
    } catch { /* ignore */ }
  }

  return roots
}

// ---------------------------------------------------------------------------
// AIOS scanner — discovers agents from AIOS department structure
// ---------------------------------------------------------------------------

function getAiosRoot(): string | null {
  // Check env var first, then common locations
  const envRoot = process.env.AIOS_ROOT
  if (envRoot && existsSync(envRoot)) return envRoot
  const home = homedir()
  const candidates = [
    join(home, 'AIOS'),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'CLAUDE.md'))) return c
  }
  return null
}

function scanAiosAgents(): DiskAgent[] {
  const aiosRoot = getAiosRoot()
  if (!aiosRoot) return []

  const agents: DiskAgent[] = []

  // 1. Scan department heads (dept_*/CLAUDE.md)
  try {
    const entries = readdirSync(aiosRoot)
    for (const entry of entries) {
      if (!entry.startsWith('dept_')) continue
      const deptPath = join(aiosRoot, entry)
      const claudeMd = join(deptPath, 'CLAUDE.md')
      if (!existsSync(claudeMd)) continue

      try {
        const content = readFileSync(claudeMd, 'utf8')
        // Extract role from first line like "You are the CTO of Business & Fitness"
        const firstLine = content.split('\n').find(l => l.trim().length > 0) || ''
        const roleMatch = firstLine.match(/You are the (.+?)(?:\s+(?:of|at)\s+)/i)
        const role = roleMatch ? roleMatch[1].trim() : entry.replace('dept_', '')
        const name = entry.replace('dept_', '')

        agents.push({
          name,
          dir: deptPath,
          role,
          soulContent: content,
          configContent: JSON.stringify({ type: 'department-head', department: entry, workspace: deptPath }),
          contentHash: sha256(content),
        })
      } catch { /* unreadable */ }
    }
  } catch { /* unreadable */ }

  // 2. Scan skills (root .claude/skills/ and dept_*/.claude/skills/)
  const skillRoots = [join(aiosRoot, '.claude', 'skills')]
  try {
    const entries = readdirSync(aiosRoot)
    for (const entry of entries) {
      if (!entry.startsWith('dept_')) continue
      const deptSkills = join(aiosRoot, entry, '.claude', 'skills')
      if (existsSync(deptSkills)) skillRoots.push(deptSkills)
    }
  } catch { /* ignore */ }

  for (const skillRoot of skillRoots) {
    if (!existsSync(skillRoot)) continue
    try {
      const skills = readdirSync(skillRoot)
      for (const skill of skills) {
        const skillPath = join(skillRoot, skill)
        const skillMd = join(skillPath, 'SKILL.md')
        if (!existsSync(skillMd)) continue

        try {
          const content = readFileSync(skillMd, 'utf8')
          // Extract description from first few lines
          const lines = content.split('\n').filter(l => l.trim().length > 0)
          const description = lines.length > 1 ? lines[1].trim() : lines[0].trim()
          // Determine department from path
          const deptMatch = skillPath.match(/dept_(\w+)/)
          const dept = deptMatch ? deptMatch[1] : 'root'

          agents.push({
            name: `${skill}`,
            dir: skillPath,
            role: `skill (${dept})`,
            soulContent: content,
            configContent: JSON.stringify({ type: 'skill', department: dept, skillPath }),
            contentHash: sha256(content),
          })
        } catch { /* unreadable */ }
      }
    } catch { /* ignore */ }
  }

  // 3. Scan personal assistants (dept_personal-assistants/*/CLAUDE.md)
  const paDir = join(aiosRoot, 'dept_personal-assistants')
  if (existsSync(paDir)) {
    try {
      const entries = readdirSync(paDir)
      for (const entry of entries) {
        const paPath = join(paDir, entry)
        const claudeMd = join(paPath, 'CLAUDE.md')
        if (!existsSync(claudeMd)) continue

        try {
          const content = readFileSync(claudeMd, 'utf8')
          agents.push({
            name: `pa-${entry.replace('-workspace', '')}`,
            dir: paPath,
            role: 'personal-assistant',
            soulContent: content,
            configContent: JSON.stringify({ type: 'personal-assistant', workspace: paPath }),
            contentHash: sha256(content),
          })
        } catch { /* unreadable */ }
      }
    } catch { /* ignore */ }
  }

  return agents
}

// ---------------------------------------------------------------------------
// Disk scanner
// ---------------------------------------------------------------------------

function scanLocalAgents(): DiskAgent[] {
  const agents: DiskAgent[] = []
  const seen = new Set<string>()

  // Scan AIOS agents first (department heads, skills, PAs)
  for (const agent of scanAiosAgents()) {
    if (!seen.has(agent.name)) {
      seen.add(agent.name)
      agents.push(agent)
    }
  }

  for (const root of getLocalAgentRoots()) {
    if (!existsSync(root)) continue
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }

    for (const entry of entries) {
      // Skip 'skills' subdirectory — that's the skill roots
      if (entry === 'skills') continue

      const fullPath = join(root, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      // --- Flat .md agent files (Claude Code format) ---
      if (stat.isFile() && entry.endsWith('.md') && entry !== 'CLAUDE.md' && entry !== 'AGENTS.md') {
        try {
          const content = readFileSync(fullPath, 'utf8')
          const { frontmatter, body } = parseYamlFrontmatter(content)
          const agentName = frontmatter.name || entry.replace(/\.md$/, '')
          if (seen.has(agentName)) continue
          seen.add(agentName)

          const configObj: Record<string, unknown> = {}
          if (frontmatter.model) configObj.model = frontmatter.model
          if (frontmatter.color) configObj.color = frontmatter.color
          if (frontmatter.tools) configObj.tools = frontmatter.tools
          if (frontmatter.description) configObj.description = frontmatter.description
          const configJson = Object.keys(configObj).length > 0 ? JSON.stringify(configObj) : null

          agents.push({
            name: agentName,
            dir: frontmatter.workspace || fullPath,
            role: frontmatter.description ? 'agent' : 'agent',
            soulContent: body.trim() || null,
            configContent: configJson,
            contentHash: sha256(content),
          })
        } catch { /* unreadable */ }
        continue
      }

      // --- Directory-based agents (workspace format) ---
      if (!stat.isDirectory()) continue

      // Check if any marker file exists
      const hasMarker = ALL_MARKERS.some(f => existsSync(join(fullPath, f)))
      if (!hasMarker) continue

      if (seen.has(entry)) continue
      seen.add(entry)

      // Read identity content (soul/agent/identity.md)
      let soulContent: string | null = null
      let role = 'agent'
      for (const f of IDENTITY_FILES) {
        const p = join(fullPath, f)
        if (existsSync(p)) {
          try {
            soulContent = readFileSync(p, 'utf8')
            role = extractRole(soulContent)
            break
          } catch { /* unreadable */ }
        }
      }

      // Read config JSON if present
      let configContent: string | null = null
      for (const f of CONFIG_FILES) {
        const p = join(fullPath, f)
        if (existsSync(p)) {
          try {
            configContent = readFileSync(p, 'utf8')
            break
          } catch { /* unreadable */ }
        }
      }

      // Build content hash from whatever identity files exist
      const hashInput = (soulContent || '') + (configContent || '')
      if (!hashInput) continue

      agents.push({
        name: entry,
        dir: fullPath,
        role,
        soulContent,
        configContent,
        contentHash: sha256(hashInput),
      })
    }
  }

  return agents
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

export async function syncLocalAgents(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const diskAgents = scanLocalAgents()
    const now = Math.floor(Date.now() / 1000)

    const diskMap = new Map<string, DiskAgent>()
    for (const a of diskAgents) {
      diskMap.set(a.name, a)
    }

    // Fetch DB agents with source='local'
    const dbRows = db.prepare(
      `SELECT id, name, role, soul_content, status, source, content_hash, workspace_path, config FROM agents WHERE source = 'local'`
    ).all() as AgentRow[]

    const dbMap = new Map<string, AgentRow>()
    for (const r of dbRows) {
      dbMap.set(r.name, r)
    }

    let created = 0
    let updated = 0
    let removed = 0

    const insertStmt = db.prepare(`
      INSERT INTO agents (name, role, soul_content, status, source, content_hash, workspace_path, config, created_at, updated_at)
      VALUES (?, ?, ?, 'offline', 'local', ?, ?, ?, ?, ?)
    `)
    const updateStmt = db.prepare(`
      UPDATE agents SET role = ?, soul_content = ?, content_hash = ?, workspace_path = ?, config = ?, updated_at = ?
      WHERE id = ?
    `)
    const markRemovedStmt = db.prepare(`
      UPDATE agents SET status = 'offline', updated_at = ? WHERE id = ?
    `)

    db.transaction(() => {
      // Disk → DB: additions and changes
      for (const [name, disk] of diskMap) {
        const existing = dbMap.get(name)
        const configJson = disk.configContent ? disk.configContent : null

        if (!existing) {
          insertStmt.run(name, disk.role, disk.soulContent, disk.contentHash, disk.dir, configJson, now, now)
          created++
        } else if (existing.content_hash !== disk.contentHash) {
          updateStmt.run(disk.role, disk.soulContent, disk.contentHash, disk.dir, configJson, now, existing.id)
          updated++
        }
      }

      // Agents that vanished from disk — mark offline but don't delete
      for (const [name, row] of dbMap) {
        if (!diskMap.has(name) && row.status !== 'offline') {
          markRemovedStmt.run(now, row.id)
          removed++
        }
      }
    })()

    const msg = `Local agent sync: ${created} added, ${updated} updated, ${removed} marked offline (${diskAgents.length} on disk)`
    if (created > 0 || updated > 0 || removed > 0) {
      logger.info(msg)
      logAuditEvent({
        action: 'local_agent_sync',
        actor: 'scheduler',
        detail: { created, updated, removed, total: diskAgents.length },
      })
    }
    return { ok: true, message: msg }
  } catch (err: any) {
    logger.error({ err }, 'Local agent sync failed')
    return { ok: false, message: `Local agent sync failed: ${err.message}` }
  }
}

/**
 * Write agent soul content back to disk (UI → Disk direction).
 * Called when a user edits a local agent's soul in the MC UI.
 */
export function writeLocalAgentSoul(agentDir: string, soulContent: string): void {
  // Prefer soul.md, fall back to AGENT.md
  const soulPath = join(agentDir, 'soul.md')
  const agentMdPath = join(agentDir, 'AGENT.md')
  const targetPath = existsSync(soulPath) ? soulPath : existsSync(agentMdPath) ? agentMdPath : soulPath

  mkdirSync(agentDir, { recursive: true })
  writeFileSync(targetPath, soulContent, 'utf8')

  // Update the DB hash so the next sync doesn't re-overwrite
  try {
    const db = getDatabase()
    const hash = sha256(soulContent)
    db.prepare(`UPDATE agents SET content_hash = ?, updated_at = ? WHERE workspace_path = ? AND source = 'local'`)
      .run(hash, Math.floor(Date.now() / 1000), agentDir)
  } catch { /* best-effort */ }
}
