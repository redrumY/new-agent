#!/usr/bin/env node
/**
 * s09_memory_system.ts - Memory System
 *
 * This teaching version focuses on one core idea:
 * some information should survive the current conversation, but not everything
 * belongs in memory.
 *
 * Use memory for:
 *   - user preferences
 *   - repeated user feedback
 *   - project facts that are NOT obvious from the current code
 *   - pointers to external resources
 *
 * Do NOT use memory for:
 *   - code structure that can be re-read from the repo
 *   - temporary task state
 *   - secrets
 *
 * Storage layout:
 *   .memory/
 *     MEMORY.md
 *     prefer_tabs.md
 *     review_style.md
 *     incident_board.md
 *
 * Each memory is a small Markdown file with frontmatter.
 * The agent can save a memory through save_memory(), and the memory index
 * is rebuilt after each write.
 *
 * An optional "Dream" pass can later consolidate, deduplicate, and prune
 * stored memories. It is useful, but it is not the first thing readers need
 * to understand.
 *
 * Key insight: "Memory only stores cross-session information that is still
 * worth recalling later and is not easy to re-derive from the current repo."
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { resolve, relative } from 'path';

config();

if (process.env.ANTHROPIC_BASE_URL) {
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}

const WORKDIR = process.cwd();
const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
});
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-20250514';

// ============================================================================
// MEMORY CONSTANTS
// ============================================================================

const MEMORY_DIR = resolve(WORKDIR, '.memory');
const MEMORY_INDEX = resolve(MEMORY_DIR, 'MEMORY.md');
type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
const MEMORY_TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference'];
const MAX_INDEX_LINES = 200;

// ============================================================================
// MEMORY MANAGER
// ============================================================================

interface Memory {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  file?: string;
}

interface FrontmatterData {
  name?: string;
  description?: string;
  type?: MemoryType;
  content?: string;
}

class MemoryManager {
  /**
   * Load, build, and save persistent memories across sessions.
   *
   * The teaching version keeps memory explicit:
   * one Markdown file per memory, plus one compact index file.
   */

  readonly memoryDir: string;
  memories: Record<string, Memory> = {};

  constructor(memoryDir: string = MEMORY_DIR) {
    this.memoryDir = memoryDir;
  }

  loadAll(): void {
    /** Load MEMORY.md index and all individual memory files. */
    this.memories = {};

    if (!existsSync(this.memoryDir)) {
      return;
    }

    // Scan all .md files except MEMORY.md
    const files = readdirSync(this.memoryDir);
    for (const file of files) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') {
        continue;
      }

      const mdFile = resolve(this.memoryDir, file);
      try {
        const text = readFileSync(mdFile, 'utf-8');
        const parsed = this._parseFrontmatter(text);
        if (parsed) {
          const name = parsed.name || file.replace(/\.md$/, '');
          this.memories[name] = {
            name,
            description: parsed.description || '',
            type: parsed.type || 'project',
            content: parsed.content || '',
            file
          };
        }
      } catch (error: any) {
        console.log(`[Memory] Error loading ${file}: ${error.message}`);
      }
    }

    const count = Object.keys(this.memories).length;
    if (count > 0) {
      console.log(`[Memory loaded: ${count} memories from ${this.memoryDir}]`);
    }
  }

  loadMemoryPrompt(): string {
    /** Build a memory section for injection into the system prompt. */
    if (Object.keys(this.memories).length === 0) {
      return '';
    }

    const sections: string[] = [];
    sections.push('# Memories (persistent across sessions)');
    sections.push('');

    // Group by type for readability
    for (const memType of MEMORY_TYPES) {
      const typed: Record<string, Memory> = {};
      for (const [name, mem] of Object.entries(this.memories)) {
        if (mem.type === memType) {
          typed[name] = mem;
        }
      }
      if (Object.keys(typed).length === 0) {
        continue;
      }
      sections.push(`## [${memType}]`);
      for (const [name, mem] of Object.entries(typed)) {
        sections.push(`### ${name}: ${mem.description}`);
        if (mem.content.trim()) {
          sections.push(mem.content.trim());
        }
        sections.push('');
      }
    }

    return sections.join('\n');
  }

  saveMemory(name: string, description: string, memType: MemoryType, content: string): string {
    /**
     * Save a memory to disk and update the index.
     *
     * Returns a status message.
     */

    if (!MEMORY_TYPES.includes(memType)) {
      return `Error: type must be one of ${MEMORY_TYPES.join(', ')}`;
    }

    // Sanitize name for filename
    const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!safeName) {
      return 'Error: invalid memory name';
    }

    mkdirSync(this.memoryDir, { recursive: true });

    // Write individual memory file with frontmatter
    const frontmatter = `---
name: ${name}
description: ${description}
type: ${memType}
---
${content}
`;
    const fileName = `${safeName}.md`;
    const filePath = resolve(this.memoryDir, fileName);
    writeFileSync(filePath, frontmatter);

    // Update in-memory store
    this.memories[name] = {
      name,
      description,
      type: memType,
      content,
      file: fileName
    };

    // Rebuild MEMORY.md index
    this._rebuildIndex();

    const relPath = relative(WORKDIR, filePath);
    return `Saved memory '${name}' [${memType}] to ${relPath}`;
  }

  private _rebuildIndex(): void {
    /** Rebuild MEMORY.md from current in-memory state, capped at 200 lines. */
    const lines: string[] = ['# Memory Index', ''];
    for (const [name, mem] of Object.entries(this.memories)) {
      lines.push(`- ${name}: ${mem.description} [${mem.type}]`);
      if (lines.length >= MAX_INDEX_LINES) {
        lines.push(`... (truncated at ${MAX_INDEX_LINES} lines)`);
        break;
      }
    }
    mkdirSync(this.memoryDir, { recursive: true });
    writeFileSync(MEMORY_INDEX, lines.join('\n') + '\n');
  }

  private _parseFrontmatter(text: string): FrontmatterData | null {
    /** Parse --- delimited frontmatter + body content. */
    const match = text.match(/^---\s*\n(.*?)\n---\s*\n(.*)/s);
    if (!match) {
      return null;
    }
    const [, header, body] = match;
    const result: FrontmatterData = { content: body.trim() };
    for (const line of header.split('\n')) {
      if (line.includes(':')) {
        const colonIndex = line.indexOf(':');
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        result[key as keyof FrontmatterData] = value;
      }
    }
    return result;
  }
}

// ============================================================================
// DREAM CONSOLIDATOR
// ============================================================================

class DreamConsolidator {
  /**
   * Auto-consolidation of memories between sessions ("Dream").
   *
   * This is an optional later-stage feature. Its job is to prevent the memory
   * store from growing into a noisy pile by merging, deduplicating, and
   * pruning entries over time.
   */

  readonly COOLDOWN_SECONDS = 86400;       // 24 hours between consolidations
  readonly SCAN_THROTTLE_SECONDS = 600;    // 10 minutes between scan attempts
  readonly MIN_SESSION_COUNT = 5;          // need enough data to consolidate
  readonly LOCK_STALE_SECONDS = 3600;      // PID lock considered stale after 1 hour

  readonly PHASES = [
    'Orient: scan MEMORY.md index for structure and categories',
    'Gather: read individual memory files for full content',
    'Consolidate: merge related memories, remove stale entries',
    'Prune: enforce 200-line limit on MEMORY.md index',
  ];

  readonly memoryDir: string;
  readonly lockFile: string;
  enabled: boolean = true;
  mode: string = 'default';
  lastConsolidationTime: number = 0;
  lastScanTime: number = 0;
  sessionCount: number = 0;

  constructor(memoryDir: string = MEMORY_DIR) {
    this.memoryDir = memoryDir;
    this.lockFile = resolve(memoryDir, '.dream_lock');
  }

  shouldConsolidate(): [boolean, string] {
    /**
     * Check 7 gates in sequence. All must pass.
     * Returns [can_run, reason] where reason explains the first failed gate.
     */
    const now = Date.now() / 1000;

    // Gate 1: enabled flag
    if (!this.enabled) {
      return [false, 'Gate 1: consolidation is disabled'];
    }

    // Gate 2: memory directory exists and has memory files
    if (!existsSync(this.memoryDir)) {
      return [false, 'Gate 2: memory directory does not exist'];
    }
    const memoryFiles = readdirSync(this.memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    if (memoryFiles.length === 0) {
      return [false, 'Gate 2: no memory files found'];
    }

    // Gate 3: not in plan mode (only consolidate in active modes)
    if (this.mode === 'plan') {
      return [false, 'Gate 3: plan mode does not allow consolidation'];
    }

    // Gate 4: 24-hour cooldown since last consolidation
    const timeSinceLast = now - this.lastConsolidationTime;
    if (timeSinceLast < this.COOLDOWN_SECONDS) {
      const remaining = Math.floor(this.COOLDOWN_SECONDS - timeSinceLast);
      return [false, `Gate 4: cooldown active, ${remaining}s remaining`];
    }

    // Gate 5: 10-minute throttle since last scan attempt
    const timeSinceScan = now - this.lastScanTime;
    if (timeSinceScan < this.SCAN_THROTTLE_SECONDS) {
      const remaining = Math.floor(this.SCAN_THROTTLE_SECONDS - timeSinceScan);
      return [false, `Gate 5: scan throttle active, ${remaining}s remaining`];
    }

    // Gate 6: need at least 5 sessions worth of data
    if (this.sessionCount < this.MIN_SESSION_COUNT) {
      return [false, `Gate 6: only ${this.sessionCount} sessions, need ${this.MIN_SESSION_COUNT}`];
    }

    // Gate 7: no active lock file (check PID staleness)
    if (!this._acquireLock()) {
      return [false, 'Gate 7: lock held by another process'];
    }

    return [true, 'All 7 gates passed'];
  }

  consolidate(): string[] {
    /**
     * Run the 4-phase consolidation process.
     *
     * The teaching version returns phase descriptions to make the flow
     * visible without requiring an extra LLM pass here.
     */
    const [canRun, reason] = this.shouldConsolidate();
    if (!canRun) {
      console.log(`[Dream] Cannot consolidate: ${reason}`);
      return [];
    }

    console.log('[Dream] Starting consolidation...');
    this.lastScanTime = Date.now() / 1000;

    const completedPhases: string[] = [];
    for (let i = 0; i < this.PHASES.length; i++) {
      const phase = this.PHASES[i];
      console.log(`[Dream] Phase ${i + 1}/4: ${phase}`);
      completedPhases.push(phase);
    }

    this.lastConsolidationTime = Date.now() / 1000;
    this._releaseLock();
    console.log(`[Dream] Consolidation complete: ${completedPhases.length} phases executed`);
    return completedPhases;
  }

  private _acquireLock(): boolean {
    /**
     * Acquire a PID-based lock file. Returns False if locked by another
     * live process. Stale locks (older than LOCK_STALE_SECONDS) are removed.
     */
    if (existsSync(this.lockFile)) {
      try {
        const lockData = readFileSync(this.lockFile, 'utf-8').trim();
        const [pidStr, timestampStr] = lockData.split(':');
        const pid = parseInt(pidStr, 10);
        const lockTime = parseFloat(timestampStr);

        // Check if lock is stale
        const now = Date.now() / 1000;
        if ((now - lockTime) > this.LOCK_STALE_SECONDS) {
          console.log(`[Dream] Removing stale lock from PID ${pid}`);
          unlinkSync(this.lockFile);
        } else {
          // Check if owning process is still alive (not easily portable in Node)
          // For teaching purposes, we'll assume it's alive if recent
          return false;
        }
      } catch {
        // Corrupted lock file, remove it
        try {
          unlinkSync(this.lockFile);
        } catch {
          // Ignore
        }
      }
    }

    // Write new lock
    try {
      mkdirSync(this.memoryDir, { recursive: true });
      writeFileSync(this.lockFile, `${process.pid}:${Date.now() / 1000}`);
      return true;
    } catch {
      return false;
    }
  }

  private _releaseLock(): void {
    /** Release the lock file if we own it. */
    try {
      if (existsSync(this.lockFile)) {
        const lockData = readFileSync(this.lockFile, 'utf-8').trim();
        const pidStr = lockData.split(':')[0];
        if (parseInt(pidStr, 10) === process.pid) {
          unlinkSync(this.lockFile);
        }
      }
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

function safePath(p: string): string {
  const path = resolve(WORKDIR, p);
  const rel = relative(WORKDIR, path);
  if (rel.startsWith('..')) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return path;
}

function runBash(command: string): string {
  const dangerous = ['rm -rf /', 'sudo', 'shutdown', 'reboot', '> /dev/'];
  if (dangerous.some(d => command.includes(d))) {
    return 'Error: Dangerous command blocked';
  }

  try {
    const r = execSync(command, {
      cwd: WORKDIR,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const out = (r as string).trim();
    return out ? out.substring(0, 50000) : '(no output)';
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      return 'Error: Timeout (120s)';
    }
    return `Error: ${error.message || error}`;
  }
}

function runRead(path: string, limit?: number): string {
  try {
    const lines = readFileSync(safePath(path), 'utf-8').split('\n');
    if (limit && limit < lines.length) {
      lines.length = limit;
      lines.push(`... (${lines.length - limit} more)`);
    }
    return lines.join('\n').substring(0, 50000);
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

function runWrite(path: string, content: string): string {
  try {
    const fp = safePath(path);
    mkdirSync(resolve(fp, '..'), { recursive: true });
    writeFileSync(fp, content);
    return `Wrote ${content.length} bytes`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

function runEdit(path: string, oldText: string, newText: string): string {
  try {
    const fp = safePath(path);
    let fileContent = readFileSync(fp, 'utf-8');
    if (!fileContent.includes(oldText)) {
      return `Error: Text not found in ${path}`;
    }
    fileContent = fileContent.replace(oldText, newText);
    writeFileSync(fp, fileContent);
    return `Edited ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// Global memory manager
const memoryMgr = new MemoryManager();

function runSaveMemory(name: string, description: string, memType: MemoryType, content: string): string {
  return memoryMgr.saveMemory(name, description, memType, content);
}

const TOOL_HANDLERS: Record<string, (params: any) => string> = {
  bash: (kw) => runBash(kw.command),
  read_file: (kw) => runRead(kw.path, kw.limit),
  write_file: (kw) => runWrite(kw.path, kw.content),
  edit_file: (kw) => runEdit(kw.path, kw.old_text, kw.new_text),
  save_memory: (kw) => runSaveMemory(kw.name, kw.description, kw.type, kw.content),
};

const TOOLS = [
  {
    name: 'bash',
    description: 'Run a shell command.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read file contents.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, limit: { type: 'integer' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Replace exact text in file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' }
      },
      required: ['path', 'old_text', 'new_text']
    }
  },
  {
    name: 'save_memory',
    description: 'Save a persistent memory that survives across sessions.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short identifier (e.g. prefer_tabs, db_schema)'
        },
        description: {
          type: 'string',
          description: 'One-line summary of what this memory captures'
        },
        type: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description: 'user=preferences, feedback=corrections, project=non-obvious project conventions or decision reasons, reference=external resource pointers'
        },
        content: {
          type: 'string',
          description: 'Full memory content (multi-line OK)'
        }
      },
      required: ['name', 'description', 'type', 'content']
    }
  }
];

const MEMORY_GUIDANCE = `
When to save memories:
- User states a preference ("I like tabs", "always use pytest") -> type: user
- User corrects you ("don't do X", "that was wrong because...") -> type: feedback
- You learn a project fact that is not easy to infer from current code alone
  (for example: a rule exists because of compliance, or a legacy module must
  stay untouched for business reasons) -> type: project
- You learn where an external resource lives (ticket board, dashboard, docs URL)
  -> type: reference

When NOT to save:
- Anything easily derivable from code (function signatures, file structure, directory layout)
- Temporary task state (current branch, open PR numbers, current TODOs)
- Secrets or credentials (API keys, passwords)
`;

// ============================================================================
// SYSTEM PROMPT BUILDER
// ============================================================================

function buildSystemPrompt(): string {
  /** Assemble system prompt with memory content included. */
  const parts: string[] = [`You are a coding agent at ${WORKDIR}. Use tools to solve tasks.`];

  // Inject memory content if available
  const memorySection = memoryMgr.loadMemoryPrompt();
  if (memorySection) {
    parts.push(memorySection);
  }

  parts.push(MEMORY_GUIDANCE);
  return parts.join('\n\n');
}

// ============================================================================
// AGENT LOOP
// ============================================================================

async function agentLoop(messages: Array<{ role: string; content: any }>): Promise<void> {
  /**
   * Agent loop with memory-aware system prompt.
   *
   * The system prompt is rebuilt each call so newly saved memories
   * are visible in the next LLM turn within the same session.
   */

  while (true) {
    const system = buildSystemPrompt();
    const response = await client.messages.create({
      model: MODEL,
      system: system,
      messages: messages as any,
      tools: TOOLS as any,
      max_tokens: 8000
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      return;
    }

    const results: any[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const handler = TOOL_HANDLERS[block.name];
      let output: string;
      try {
        output = handler ? handler(block.input || {}) : `Unknown: ${block.name}`;
      } catch (error: any) {
        output = `Error: ${error.message}`;
      }
      console.log(`> ${block.name}: ${String(output).substring(0, 200)}`);

      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: String(output)
      });
    }

    messages.push({ role: 'user', content: results });
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Load existing memories at session start
  memoryMgr.loadAll();
  const memCount = Object.keys(memoryMgr.memories).length;
  if (memCount > 0) {
    console.log(`[${memCount} memories loaded into context]`);
  } else {
    console.log('[No existing memories. The agent can create them with save_memory.]');
  }

  const history: Array<{ role: string; content: any }> = [];

  // Create readline interface once (matches Python's input() pattern)
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('close', () => process.exit(0));

  while (true) {
    const query = await new Promise<string>((resolve) => {
      rl.question('\x1b[36ms09 >> \x1b[0m', (ans) => {
        resolve(ans);
      });
    });

    if (!query || query.trim().toLowerCase() === 'q' || query.trim().toLowerCase() === 'exit') {
      break;
    }

    // /memories command to list current memories
    if (query.trim() === '/memories') {
      const mems = memoryMgr.memories;
      const names = Object.keys(mems);
      if (names.length > 0) {
        for (const name of names) {
          const mem = mems[name];
          console.log(`  [${mem.type}] ${name}: ${mem.description}`);
        }
      } else {
        console.log('  (no memories)');
      }
      continue;
    }

    history.push({ role: 'user', content: query });
    await agentLoop(history);

    const responseContent = history[history.length - 1].content;
    if (Array.isArray(responseContent)) {
      for (const block of responseContent) {
        if (block.text) {
          console.log(block.text);
        }
      }
    }
    console.log();
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

if (process.argv[1]?.endsWith('s09-memory-system.ts')) {
  main().catch(console.error);
}

export { MemoryManager, DreamConsolidator, MemoryType };
