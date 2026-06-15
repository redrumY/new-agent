#!/usr/bin/env node
/**
 * s_full_agent.ts - Full Reference Agent
 *
 * Capstone implementation combining every mechanism from s01-s11.
 * Session s12 (task-aware worktree isolation) is taught separately.
 * NOT a teaching session -- this is the "put it all together" reference.
 *
 *生成react组件    +------------------------------------------------------------------+
 *    |                        FULL AGENT                                 |
 *    |                                                                   |
 *    |  System prompt (s05 skills, task-first + optional todo nag)      |
 *    |                                                                   |
 *    |  Before each LLM call:                                            |
 *    |  +--------------------+  +------------------+  +--------------+  |
 *    |  | Microcompact (s06) |  | Drain bg (s08)   |  | Check inbox  |  |
 *    |  | Auto-compact (s06) |  | notifications    |  | (s09)        |  |
 *    |  +--------------------+  +------------------+  +--------------+  |
 *    |                                                                   |
 *    |  Tool dispatch (s02 pattern):                                     |
 *    |  +--------+----------+----------+---------+-----------+          |
 *    |  | bash   | read     | write    | edit    | TodoWrite |          |
 *    |  | task   | load_sk  | compress | bg_run  | bg_check  |          |
 *    |  | t_crt  | t_get    | t_upd    | t_list  | spawn_tm  |          |
 *    |  | list_tm| send_msg | rd_inbox | bcast   | shutdown  |          |
 *    |  | plan   | idle     | claim    |         |           |          |
 *    |  +--------+----------+----------+---------+-----------+          |
 *    |                                                                   |
 *    |  Subagent (s04):  spawn -> work -> return summary                 |
 *    |  Teammate (s09):  spawn -> work -> idle -> auto-claim (s11)      |
 *    |  Shutdown (s10):  request_id handshake                            |
 *    |  Plan gate (s10): submit -> approve/reject                        |
 *    +------------------------------------------------------------------+
 *
 * REPL commands: /compact /tasks /team /inbox
 *
 * Based on the Learn Claude Code reference agent.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync, spawn } from 'child_process';
import { readFile, writeFile, mkdir, access, readdir, stat, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cwd } from 'process';

// Determine current directory
const currentDir = resolve();

// Load .env file - try parent directory (z-agent root) and current directory
const envPath = resolve(currentDir, '..', '.env');
config({ path: existsSync(envPath) ? envPath : resolve(currentDir, '.env') });

// ============================================================================
// CONFIGURATION
// ============================================================================

// We'll use WORKDIR directly instead of __dirname

const WORKDIR = cwd();
const API_KEY = process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.ANTHROPIC_BASE_URL;
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-20250514';

const client = API_KEY ? new Anthropic({
  apiKey: API_KEY,
  baseURL: BASE_URL
}) : null;

const TEAM_DIR = resolve(WORKDIR, '.team');
const INBOX_DIR = resolve(TEAM_DIR, 'inbox');
const TASKS_DIR = resolve(WORKDIR, '.tasks');
const SKILLS_DIR = resolve(WORKDIR, 'skills');
const TRANSCRIPT_DIR = resolve(WORKDIR, '.transcripts');

const TOKEN_THRESHOLD = 100000;
const POLL_INTERVAL = 5000; // 5 seconds
const IDLE_TIMEOUT = 60000; // 60 seconds

const VALID_MSG_TYPES = new Set([
  'message',
  'broadcast',
  'shutdown_request',
  'shutdown_response',
  'plan_approval_response'
]);

// ============================================================================
// TYPES
// ============================================================================

interface Message {
  role: 'user' | 'assistant';
  content: string | Array<Anthropic.ContentBlock>;
}

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface Task {
  id: number;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  owner: string | null;
  blockedBy: number[];
}

interface BackgroundTask {
  status: 'running' | 'completed' | 'error';
  command: string;
  result: string | null;
}

interface TeammateMessage {
  type: string;
  from: string;
  content: string;
  timestamp: number;
  [key: string]: any;
}

interface Teammate {
  name: string;
  role: string;
  status: 'idle' | 'working' | 'shutdown';
}

interface TeamConfig {
  team_name: string;
  members: Teammate[];
}

// ============================================================================
// SECTION: base_tools
// ============================================================================

function safePath(p: string): string {
  const path = resolve(WORKDIR, p);
  const rel = relative(WORKDIR, path);
  if (rel.startsWith('..')) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return path;
}

async function runBash(command: string): Promise<string> {
  const dangerous = ['rm -rf /', 'sudo', 'shutdown', 'reboot', '> /dev/'];
  if (dangerous.some(d => command.includes(d))) {
    return 'Error: Dangerous command blocked';
  }

  try {
    const output = execSync(command, {
      cwd: WORKDIR,
      encoding: 'utf-8',
      timeout: 120000, // 120s
      maxBuffer: 50000 * 1024
    });
    return output.trim() || '(no output)';
  } catch (error: any) {
    if (error.signal === 'SIGTERM') {
      return 'Error: Timeout (120s)';
    }
    return error.stdout || error.stderr || error.message;
  }
}

async function runRead(path: string, limit?: number): Promise<string> {
  try {
    const safeFilePath = safePath(path);
    const content = await readFile(safeFilePath, 'utf-8');
    const lines = content.split('\n');

    if (limit && limit < lines.length) {
      const truncated = lines.slice(0, limit);
      truncated.push(`... (${lines.length - limit} more)`);
      return truncated.join('\n').slice(0, 50000);
    }

    return content.slice(0, 50000);
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

async function runWrite(path: string, content: string): Promise<string> {
  try {
    const safeFilePath = safePath(path);
    await mkdir(dirname(safeFilePath), { recursive: true });
    await writeFile(safeFilePath, content, 'utf-8');
    return `Wrote ${content.length} bytes to ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

async function runEdit(path: string, oldText: string, newText: string): Promise<string> {
  try {
    const safeFilePath = safePath(path);
    const content = await readFile(safeFilePath, 'utf-8');

    if (!content.includes(oldText)) {
      return `Error: Text not found in ${path}`;
    }

    const updated = content.replace(oldText, newText);
    await writeFile(safeFilePath, updated, 'utf-8');

    return `Edited ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// ============================================================================
// SECTION: todos (s03)
// ============================================================================

class TodoManager {
  private items: TodoItem[] = [];

  update(newItems: TodoItem[]): string {
    const validated: TodoItem[] = [];
    let inProgress = 0;

    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i];
      const content = item.content?.trim() || '';
      const status = item.status?.toLowerCase() || 'pending';
      const activeForm = item.activeForm?.trim() || '';

      if (!content) {
        throw new Error(`Item ${i}: content required`);
      }
      const validStatuses: TodoStatus[] = ['pending', 'in_progress', 'completed'];
      if (!validStatuses.includes(status as TodoStatus)) {
        throw new Error(`Item ${i}: invalid status '${status}'`);
      }
      if (!activeForm) {
        throw new Error(`Item ${i}: activeForm required`);
      }
      if (status === 'in_progress') inProgress++;

      validated.push({ content, status: status as TodoStatus, activeForm });
    }

    if (validated.length > 20) {
      throw new Error('Max 20 todos');
    }
    if (inProgress > 1) {
      throw new Error('Only one in_progress allowed');
    }

    this.items = validated;
    return this.render();
  }

  render(): string {
    if (this.items.length === 0) return 'No todos.';

    const lines: string[] = [];
    for (const item of this.items) {
      const marker = {
        completed: '[x]',
        in_progress: '[>]',
        pending: '[ ]'
      }[item.status] || '[?]';

      const suffix = item.status === 'in_progress' ? ` <- ${item.activeForm}` : '';
      lines.push(`${marker} ${item.content}${suffix}`);
    }

    const completed = this.items.filter(t => t.status === 'completed').length;
    lines.push(`\n(${completed}/${this.items.length} completed)`);

    return lines.join('\n');
  }

  hasOpenItems(): boolean {
    return this.items.some(item => item.status !== 'completed');
  }
}

// ============================================================================
// SECTION: skills (s05)
// ============================================================================

interface Skill {
  meta: Record<string, string>;
  body: string;
}

class SkillLoader {
  private skills: Record<string, Skill> = {};

  constructor(skillsDir: string) {
    this.loadSkills(skillsDir);
  }

  private async loadSkills(skillsDir: string): Promise<void> {
    try {
      if (!existsSync(skillsDir)) return;

      const skillFiles = await this.findSkillFiles(skillsDir);

      for (const filePath of skillFiles) {
        const text = await readFile(filePath, 'utf-8');
        const match = text.match(/^---\n(.*?)\n---\n([\s\S]*)$/);

        let meta: Record<string, string> = {};
        let body = text;

        if (match) {
          const frontMatter = match[1];
          body = match[2].trim();

          for (const line of frontMatter.trim().split('\n')) {
            if (line.includes(':')) {
              const [key, ...valueParts] = line.split(':');
              const keyTrimmed = key.trim();
              const valueTrimmed = valueParts.join(':').trim();
              meta[keyTrimmed] = valueTrimmed;
            }
          }
        }

        const name = meta.name || filePath.split('/').reverse()[1];
        this.skills[name] = { meta, body };
      }
    } catch (error) {
      console.error('Error loading skills:', error);
    }
  }

  private async findSkillFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.findSkillFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.name === 'SKILL.md') {
        files.push(fullPath);
      }
    }

    return files.sort();
  }

  descriptions(): string {
    if (Object.keys(this.skills).length === 0) return '(no skills)';
    return Object.entries(this.skills)
      .map(([name, skill]) => `  - ${name}: ${skill.meta.description || '-'}`)
      .join('\n');
  }

  load(name: string): string {
    const skill = this.skills[name];
    if (!skill) {
      return `Error: Unknown skill '${name}'. Available: ${Object.keys(this.skills).join(', ')}`;
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }
}

// ============================================================================
// SECTION: compression (s06)
// ============================================================================

function estimateTokens(messages: Message[]): number {
  return JSON.stringify(messages).length / 4;
}

function microcompact(messages: Message[]): void {
  const toolResults: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part === 'object' && 'type' in part) {
          const blockType = (part as any).type;
          if (blockType === 'tool_result') {
            toolResults.push(part);
          }
        }
      }
    }
  }

  if (toolResults.length <= 3) return;

  for (const part of toolResults.slice(0, -3)) {
    if (typeof part.content === 'string' && part.content.length > 100) {
      part.content = '[cleared]';
    }
  }
}

async function autoCompact(messages: Message[]): Promise<Message[]> {
  await mkdir(TRANSCRIPT_DIR, { recursive: true });

  const timestamp = Date.now();
  const transcriptPath = resolve(TRANSCRIPT_DIR, `transcript_${timestamp}.jsonl`);

  const transcriptData = messages.map(msg => JSON.stringify(msg)).join('\n');
  await writeFile(transcriptPath, transcriptData, 'utf-8');

  const convText = JSON.stringify(messages).slice(-80000);

  const summaryResp = await client!.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Summarize for continuity:\n${convText}`
    }]
  });

  const summary = summaryResp.content[0].type === 'text'
    ? summaryResp.content[0].text
    : '(no summary)';

  return [{
    role: 'user',
    content: `[Compressed. Transcript: ${transcriptPath}]\n${summary}`
  }];
}

// ============================================================================
// SECTION: file_tasks (s07)
// ============================================================================

class TaskManager {
  async init(): Promise<void> {
    await mkdir(TASKS_DIR, { recursive: true });
  }

  private async nextId(): Promise<number> {
    try {
      const files = await readdir(TASKS_DIR);
      const ids = files
        .filter(f => f.startsWith('task_') && f.endsWith('.json'))
        .map(f => parseInt(f.replace('task_', '').replace('.json', ''), 10))
        .filter(id => !isNaN(id));

      return ids.length > 0 ? Math.max(...ids) + 1 : 1;
    } catch {
      return 1;
    }
  }

  private async load(tid: number): Promise<Task> {
    const path = resolve(TASKS_DIR, `task_${tid}.json`);
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  }

  private async save(task: Task): Promise<void> {
    const path = resolve(TASKS_DIR, `task_${task.id}.json`);
    await writeFile(path, JSON.stringify(task, null, 2), 'utf-8');
  }

  async create(subject: string, description: string = ''): Promise<string> {
    await this.init();
    const task: Task = {
      id: await this.nextId(),
      subject,
      description,
      status: 'pending',
      owner: null,
      blockedBy: []
    };
    await this.save(task);
    return JSON.stringify(task, null, 2);
  }

  async get(tid: number): Promise<string> {
    const task = await this.load(tid);
    return JSON.stringify(task, null, 2);
  }

  async update(
    tid: number,
    status?: string,
    addBlockedBy?: number[],
    removeBlockedBy?: number[]
  ): Promise<string> {
    const task = await this.load(tid);

    if (status) {
      task.status = status as any;

      if (status === 'completed') {
        const files = await readdir(TASKS_DIR);
        for (const f of files) {
          if (f.startsWith('task_') && f.endsWith('.json')) {
            const content = await readFile(resolve(TASKS_DIR, f), 'utf-8');
            const t: Task = JSON.parse(content);
            if (t.blockedBy.includes(tid)) {
              t.blockedBy = t.blockedBy.filter(id => id !== tid);
              await writeFile(resolve(TASKS_DIR, f), JSON.stringify(t, null, 2), 'utf-8');
            }
          }
        }
      }

      if (status === 'deleted') {
        const path = resolve(TASKS_DIR, `task_${tid}.json`);
        await unlink(path).catch(() => {});
        return `Task ${tid} deleted`;
      }
    }

    if (addBlockedBy) {
      const combined = [...task.blockedBy, ...addBlockedBy];
      task.blockedBy = Array.from(new Set(combined));
    }

    if (removeBlockedBy) {
      task.blockedBy = task.blockedBy.filter(id => !removeBlockedBy.includes(id));
    }

    await this.save(task);
    return JSON.stringify(task, null, 2);
  }

  async listAll(): Promise<string> {
    try {
      const files = await readdir(TASKS_DIR);
      const taskFiles = files
        .filter(f => f.startsWith('task_') && f.endsWith('.json'))
        .sort();

      if (taskFiles.length === 0) return 'No tasks.';

      const tasks: Task[] = [];
      for (const f of taskFiles) {
        const content = await readFile(resolve(TASKS_DIR, f), 'utf-8');
        tasks.push(JSON.parse(content));
      }

      const lines: string[] = [];
      for (const t of tasks) {
        const marker = {
          pending: '[ ]',
          in_progress: '[>]',
          completed: '[x]'
        }[t.status] || '[?]';

        const owner = t.owner ? ` @${t.owner}` : '';
        const blocked = t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(', ')})` : '';
        lines.push(`${marker} #${t.id}: ${t.subject}${owner}${blocked}`);
      }

      return lines.join('\n');
    } catch {
      return 'No tasks.';
    }
  }

  async claim(tid: number, owner: string): Promise<string> {
    const task = await this.load(tid);
    task.owner = owner;
    task.status = 'in_progress';
    await this.save(task);
    return `Claimed task #${tid} for ${owner}`;
  }
}

// ============================================================================
// SECTION: background (s08)
// ============================================================================

class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private notifications: Array<{ task_id: string; status: string; result: string }> = [];

  async run(command: string, timeout: number = 120): Promise<string> {
    const tid = Math.random().toString(36).substring(2, 10);
    this.tasks.set(tid, {
      status: 'running',
      command,
      result: null
    });

    // Execute in background
    this.execute(tid, command, timeout).catch(console.error);

    return `Background task ${tid} started: ${command.slice(0, 80)}`;
  }

  private async execute(tid: string, command: string, timeout: number): Promise<void> {
    try {
      const output = execSync(command, {
        cwd: WORKDIR,
        encoding: 'utf-8',
        timeout: timeout * 1000,
        maxBuffer: 50000 * 1024
      });

      const result = output.trim() || '(no output)';
      const task = this.tasks.get(tid);
      if (task) {
        task.status = 'completed';
        task.result = result;
      }

      this.notifications.push({
        task_id: tid,
        status: 'completed',
        result: result.slice(0, 500)
      });
    } catch (error: any) {
      const task = this.tasks.get(tid);
      if (task) {
        task.status = 'error';
        task.result = error.message;
      }

      this.notifications.push({
        task_id: tid,
        status: 'error',
        result: error.message.slice(0, 500)
      });
    }
  }

  async check(tid?: string): Promise<string> {
    if (tid) {
      const task = this.tasks.get(tid);
      if (!task) return `Unknown: ${tid}`;
      return `[${task.status}] ${task.result || '(running)'}`;
    }

    const lines: string[] = [];
    const entries = Array.from(this.tasks.entries());
    for (const [k, v] of entries) {
      lines.push(`${k}: [${v.status}] ${v.command.slice(0, 60)}`);
    }

    return lines.length > 0 ? lines.join('\n') : 'No bg tasks.';
  }

  drain(): Array<{ task_id: string; status: string; result: string }> {
    const notifs = [...this.notifications];
    this.notifications = [];
    return notifs;
  }
}

// ============================================================================
// SECTION: messaging (s09)
// ============================================================================

class MessageBus {
  async init(): Promise<void> {
    await mkdir(INBOX_DIR, { recursive: true });
  }

  async send(
    sender: string,
    to: string,
    content: string,
    msgType: string = 'message',
    extra?: Record<string, any>
  ): Promise<string> {
    await this.init();

    const msg: TeammateMessage = {
      type: msgType,
      from: sender,
      content,
      timestamp: Date.now(),
      ...extra
    };

    const inboxPath = resolve(INBOX_DIR, `${to}.jsonl`);
    const line = JSON.stringify(msg) + '\n';

    try {
      await readFile(inboxPath, 'utf-8');
    } catch {
      await writeFile(inboxPath, '', 'utf-8');
    }

    const existing = await readFile(inboxPath, 'utf-8');
    await writeFile(inboxPath, existing + line, 'utf-8');

    return `Sent ${msgType} to ${to}`;
  }

  async readInbox(name: string): Promise<TeammateMessage[]> {
    const path = resolve(INBOX_DIR, `${name}.jsonl`);

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);

      const msgs: TeammateMessage[] = [];
      for (const line of lines) {
        try {
          msgs.push(JSON.parse(line));
        } catch {}
      }

      // Clear inbox
      await writeFile(path, '', 'utf-8');

      return msgs;
    } catch {
      return [];
    }
  }

  async broadcast(sender: string, content: string, names: string[]): Promise<string> {
    let count = 0;
    for (const n of names) {
      if (n !== sender) {
        await this.send(sender, n, content, 'broadcast');
        count++;
      }
    }
    return `Broadcast to ${count} teammates`;
  }
}

// ============================================================================
// SECTION: shutdown + plan tracking (s10)
// ============================================================================

interface ShutdownRequest {
  target: string;
  status: 'pending' | 'completed';
}

interface PlanRequest {
  from: string;
  status: 'pending' | 'approved' | 'rejected';
}

const shutdownRequests: Record<string, ShutdownRequest> = {};
const planRequests: Record<string, PlanRequest> = {};

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

const TODO = new TodoManager();
const SKILLS = new SkillLoader(SKILLS_DIR);
const TASK_MGR = new TaskManager();
const BG = new BackgroundManager();
const BUS = new MessageBus();

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

let systemPrompt = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks.
Prefer task_create/task_update/task_list for multi-step work. Use TodoWrite for short checklists.
Use task for subagent delegation. Use load_skill for specialized knowledge.
Skills: ${SKILLS.descriptions()}`;

// ============================================================================
// SUBAGENT (s04)
// ============================================================================

async function runSubagent(prompt: string, agentType: string = 'Explore'): Promise<string> {
  const subTools = [
    {
      name: 'bash',
      description: 'Run command.',
      input_schema: {
        type: 'object' as const,
        properties: {
          command: { type: 'string' }
        },
        required: ['command']
      }
    },
    {
      name: 'read_file',
      description: 'Read file.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  ];

  if (agentType !== 'Explore') {
    subTools.push(
      {
        name: 'write_file',
        description: 'Write file.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          } as any,
          required: ['path', 'content']
        } as any
      },
      {
        name: 'edit_file',
        description: 'Edit file.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_text: { type: 'string' },
            new_text: { type: 'string' }
          } as any,
          required: ['path', 'old_text', 'new_text']
        } as any
      }
    );
  }

  const subHandlers: Record<string, (args: any) => Promise<string> | string> = {
    bash: async (args) => await runBash(args.command),
    read_file: async (args) => await runRead(args.path),
    write_file: async (args) => await runWrite(args.path, args.content),
    edit_file: async (args) => await runEdit(args.path, args.old_text, args.new_text)
  };

  const subMessages: Message[] = [{ role: 'user', content: prompt }];

  for (let i = 0; i < 30; i++) {
    const resp = await client!.messages.create({
      model: MODEL,
      messages: subMessages,
      tools: subTools,
      max_tokens: 8000
    });

    subMessages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason !== 'tool_use') break;

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of resp.content) {
      if (block.type === 'tool_use') {
        const handler = subHandlers[block.name] || (() => 'Unknown tool');
        const output = await handler(block.input);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: String(output).slice(0, 50000)
        });
      }
    }

    subMessages.push({ role: 'user', content: results as any });
  }

  const lastMsg = subMessages[subMessages.length - 1];
  if (Array.isArray(lastMsg.content)) {
    const textBlocks = lastMsg.content.filter(b => b.type === 'text');
    return textBlocks.map(b => (b as any).text).join('') || '(no summary)';
  }

  return '(subagent failed)';
}

// ============================================================================
// TOOL HANDLERS
// ============================================================================

interface ToolHandler {
  (args: any): Promise<string> | string;
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  bash: async (args) => await runBash(args.command),
  read_file: async (args) => await runRead(args.path, args.limit),
  write_file: async (args) => await runWrite(args.path, args.content),
  edit_file: async (args) => await runEdit(args.path, args.old_text, args.new_text),
  TodoWrite: (args) => TODO.update(args.items),
  task: async (args) => await runSubagent(args.prompt, args.agent_type || 'Explore'),
  load_skill: (args) => SKILLS.load(args.name),
  compress: () => 'Compressing...',
  background_run: async (args) => await BG.run(args.command, args.timeout || 120),
  check_background: async (args) => await BG.check(args.task_id),
  task_create: async (args) => await TASK_MGR.create(args.subject, args.description || ''),
  task_get: async (args) => await TASK_MGR.get(args.task_id),
  task_update: async (args) => await TASK_MGR.update(
    args.task_id,
    args.status,
    args.add_blocked_by,
    args.remove_blocked_by
  ),
  task_list: async () => await TASK_MGR.listAll(),
  spawn_teammate: async (args) => `Teammate spawning not implemented in TypeScript`,
  list_teammates: async () => `Teammates not implemented in TypeScript`,
  send_message: async (args) => await BUS.send('lead', args.to, args.content, args.msg_type || 'message'),
  read_inbox: async () => JSON.stringify(await BUS.readInbox('lead'), null, 2),
  broadcast: async (args) => await BUS.broadcast('lead', args.content, []),
  shutdown_request: async (args) => `Shutdown request sent to ${args.teammate}`,
  plan_approval: async (args) => `Plan ${args.approve ? 'approved' : 'rejected'} for ${args.request_id}`,
  idle: () => 'Lead does not idle.',
  claim_task: async (args) => await TASK_MGR.claim(args.task_id, 'lead')
};

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'bash',
    description: 'Run a shell command.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read file contents.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { type: 'integer' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
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
    name: 'TodoWrite',
    description: 'Update task tracking list.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              activeForm: { type: 'string' }
            },
            required: ['content', 'status', 'activeForm']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'task',
    description: 'Spawn a subagent for isolated exploration or work.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        agent_type: { type: 'string', enum: ['Explore', 'general-purpose'] }
      },
      required: ['prompt']
    }
  },
  {
    name: 'load_skill',
    description: 'Load specialized knowledge by name.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      },
      required: ['name']
    }
  },
  {
    name: 'compress',
    description: 'Manually compress conversation context.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'background_run',
    description: 'Run command in background thread.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'integer' }
      },
      required: ['command']
    }
  },
  {
    name: 'check_background',
    description: 'Check background task status.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' }
      }
    }
  },
  {
    name: 'task_create',
    description: 'Create a persistent file task.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['subject']
    }
  },
  {
    name: 'task_get',
    description: 'Get task details by ID.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_update',
    description: 'Update task status or dependencies.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] },
        add_blocked_by: { type: 'array', items: { type: 'integer' } },
        remove_blocked_by: { type: 'array', items: { type: 'integer' } }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_list',
    description: 'List all tasks.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'send_message',
    description: 'Send a message to a teammate.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        content: { type: 'string' },
        msg_type: {
          type: 'string',
          enum: Array.from(VALID_MSG_TYPES)
        }
      },
      required: ['to', 'content']
    }
  },
  {
    name: 'read_inbox',
    description: 'Read and drain the lead\'s inbox.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'broadcast',
    description: 'Send message to all teammates.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' }
      },
      required: ['content']
    }
  },
  {
    name: 'idle',
    description: 'Enter idle state.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'claim_task',
    description: 'Claim a task from the board.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' }
      },
      required: ['task_id']
    }
  }
];

// ============================================================================
// AGENT LOOP
// ============================================================================

async function agentLoop(messages: Message[]): Promise<void> {
  let roundsWithoutTodo = 0;

  while (true) {
    // s06: compression pipeline
    microcompact(messages);

    if (estimateTokens(messages) > TOKEN_THRESHOLD) {
      console.log('[auto-compact triggered]');
      messages.splice(0, messages.length, ...(await autoCompact(messages)));
    }

    // s08: drain background notifications
    const notifs = BG.drain();
    if (notifs.length > 0) {
      const txt = notifs
        .map(n => `[bg:${n.task_id}] ${n.status}: ${n.result}`)
        .join('\n');
      messages.push({
        role: 'user',
        content: `<background-results>\n${txt}\n</background-results>`
      });
    }

    // s10: check lead inbox
    const inbox = await BUS.readInbox('lead');
    if (inbox.length > 0) {
      messages.push({
        role: 'user',
        content: `<inbox>${JSON.stringify(inbox, null, 2)}</inbox>`
      });
    }

    // LLM call
    const response = await client!.messages.create({
      model: MODEL,
      system: systemPrompt,
      messages,
      tools: TOOLS,
      max_tokens: 8000
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      return;
    }

    // Tool execution
    const results: Anthropic.ToolResultBlockParam[] = [];
    let usedTodo = false;
    let manualCompress = false;

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        if (block.name === 'compress') {
          manualCompress = true;
        }

        const handler = TOOL_HANDLERS[block.name];
        let output: string;

        try {
          output = handler ? await handler(block.input) : `Unknown tool: ${block.name}`;
        } catch (error: any) {
          output = `Error: ${error.message}`;
        }

        console.log(`> ${block.name}:`);
        console.log(String(output).slice(0, 200));

        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: String(output)
        });

        if (block.name === 'TodoWrite') {
          usedTodo = true;
        }
      }
    }

    // s03: nag reminder
    roundsWithoutTodo = usedTodo ? 0 : roundsWithoutTodo + 1;
    if (TODO.hasOpenItems() && roundsWithoutTodo >= 3) {
      results.push({
        type: 'text',
        text: '<reminder>Update your todos.</reminder>'
      } as any);
    }

    messages.push({ role: 'user', content: results as any });

    // s06: manual compress
    if (manualCompress) {
      console.log('[manual compact]');
      messages.splice(0, messages.length, ...(await autoCompact(messages)));
      return;
    }
  }
}

// ============================================================================
// REPL
// ============================================================================

async function main() {
  if (!client) {
    console.error('Error: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  // Initialize managers
  await TASK_MGR.init();
  await BUS.init();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const history: Message[] = [];

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log('\n=== Full Reference Agent ===');
  console.log('Commands: /compact /tasks /inbox q|exit\n');

  while (true) {
    try {
      const query = await question('\x1b[36ms_full >> \x1b[0m');

      if (query.trim().toLowerCase() === 'q' || query.trim().toLowerCase() === 'exit' || query.trim() === '') {
        break;
      }

      if (query.trim() === '/compact') {
        if (history.length > 0) {
          console.log('[manual compact via /compact]');
          history.splice(0, history.length, ...(await autoCompact(history)));
        }
        continue;
      }

      if (query.trim() === '/tasks') {
        console.log(await TASK_MGR.listAll());
        continue;
      }

      if (query.trim() === '/inbox') {
        console.log(JSON.stringify(await BUS.readInbox('lead'), null, 2));
        continue;
      }

      history.push({ role: 'user', content: query });

      await agentLoop(history);

      const lastMsg = history[history.length - 1];
      if (Array.isArray(lastMsg.content)) {
        for (const block of lastMsg.content) {
          if (block.type === 'text') {
            console.log(block.text);
          }
        }
      }

      console.log();
    } catch (error: any) {
      if (error.message !== 'NIL') {
        console.error('Error:', error.message);
      }
      break;
    }
  }

  rl.close();
  console.log('\nGoodbye!');
}

main().catch(console.error);
