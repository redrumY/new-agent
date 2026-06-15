#!/usr/bin/env node
/**
 * s05_skill_loading.ts - Skills
 *
 * Two-layer skill model:
 * 1. Put a cheap skill catalog in the system prompt.
 * 2. Load the full skill body only when the model asks for it.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, relative, join } from 'path';

config();

if (process.env.ANTHROPIC_BASE_URL) {
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}

const WORKDIR = process.cwd();
const SKILLS_DIR = resolve(WORKDIR, 'skills');
const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
});
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-20250514';

// ============================================================================
// SKILL DATA STRUCTURES
// ============================================================================

interface SkillManifest {
  name: string;
  description: string;
  path: string;
}

interface SkillDocument {
  manifest: SkillManifest;
  body: string;
}

// ============================================================================
// SKILL REGISTRY
// ============================================================================

class SkillRegistry {
  skillsDir: string;
  documents: Map<string, SkillDocument> = new Map();

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    this._loadAll();
  }

  _loadAll() {
    if (!this._exists(this.skillsDir)) {
      return;
    }

    const skillFiles = this._findSkillFiles(this.skillsDir);

    for (const path of skillFiles) {
      const text = readFileSync(path, 'utf-8');
      const { meta, body } = this._parseFrontmatter(text);

      const name = meta.name || this._getDirName(path);
      const description = meta.description || 'No description';

      this.documents.set(name, {
        manifest: { name, description, path },
        body: body.trim()
      });
    }
  }

  _findSkillFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...this._findSkillFiles(fullPath));
      } else if (entry.name === 'SKILL.md') {
        files.push(fullPath);
      }
    }

    return files.sort();
  }

  _parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = text.match(/^---\n(.*?)\n---\n(.*)/s);
    if (!match) {
      return { meta: {}, body: text };
    }

    const meta: Record<string, string> = {};
    for (const line of match[1].trim().split('\n')) {
      if (!line.includes(':')) continue;
      const [key, ...valueParts] = line.split(':');
      meta[key.trim()] = valueParts.join(':').trim();
    }

    return { meta, body: match[2] };
  }

  _exists(path: string): boolean {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  _getDirName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 2] || 'unknown';
  }

  describeAvailable(): string {
    if (this.documents.size === 0) {
      return '(no skills available)';
    }

    const lines: string[] = [];
    for (const name of Array.from(this.documents.keys()).sort()) {
      const manifest = this.documents.get(name)!.manifest;
      lines.push(`- ${manifest.name}: ${manifest.description}`);
    }
    return lines.join('\n');
  }

  loadFullText(name: string): string {
    const document = this.documents.get(name);
    if (!document) {
      const known = Array.from(this.documents.keys()).sort().join(', ') || '(none)';
      return `Error: Unknown skill '${name}'. Available skills: ${known}`;
    }

    return `<skill name="${document.manifest.name}">\n${document.body}\n</skill>`;
  }
}

const SKILL_REGISTRY = new SkillRegistry(SKILLS_DIR);

const SYSTEM = `You are a coding agent at ${WORKDIR}.
Use load_skill when a task needs specialized instructions before you act.

Skills available:
${SKILL_REGISTRY.describeAvailable()}
`;

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

function safePath(pathStr: string): string {
  const path = resolve(WORKDIR, pathStr);
  const rel = relative(WORKDIR, path);
  if (rel.startsWith('..')) {
    throw new Error(`Path escapes workspace: ${pathStr}`);
  }
  return path;
}

function runBash(command: string): string {
  const dangerous = ['rm -rf /', 'sudo', 'shutdown', 'reboot', '> /dev/'];
  if (dangerous.some(item => command.includes(item))) {
    return 'Error: Dangerous command blocked';
  }

  try {
    const result = execSync(command, {
      cwd: WORKDIR,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const output = (result.stdout + result.stderr).trim();
    return output ? output.substring(0, 50000) : '(no output)';
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
      lines.push(`... (${lines.length - limit} more lines)`);
    }
    return lines.join('\n').substring(0, 50000);
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

function runWrite(path: string, content: string): string {
  try {
    const filePath = safePath(path);
    mkdirSync(resolve(filePath, '..'), { recursive: true });
    writeFileSync(filePath, content);
    return `Wrote ${content.length} bytes to ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

function runEdit(path: string, oldText: string, newText: string): string {
  try {
    const filePath = safePath(path);
    let content = readFileSync(filePath, 'utf-8');

    if (!content.includes(oldText)) {
      return `Error: Text not found in ${path}`;
    }

    content = content.replace(oldText, newText);
    writeFileSync(filePath, content);

    return `Edited ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

const TOOL_HANDLERS: Record<string, (params: any) => string> = {
  bash: (kw) => runBash(kw.command),
  read_file: (kw) => runRead(kw.path, kw.limit),
  write_file: (kw) => runWrite(kw.path, kw.content),
  edit_file: (kw) => runEdit(kw.path, kw.old_text, kw.new_text),
  load_skill: (kw) => SKILL_REGISTRY.loadFullText(kw.name),
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
    description: 'Write content to a file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Replace exact text in file once.',
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
    name: 'load_skill',
    description: 'Load the full body of a named skill into the current context.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  }
];

// ============================================================================
// AGENT LOOP
// ============================================================================

function extractText(content: any): string {
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      texts.push(block.text);
    }
  }
  return texts.join('\n').trim();
}

async function agentLoop(messages: Array<{ role: string; content: any }>) {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM,
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
        output = handler ? handler(block.input) : `Unknown tool: ${block.name}`;
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
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const history: Array<{ role: string; content: any }> = [];

  console.log(`\n\x1b[36mZ-Agent Loop v0.0.1 - Chapter 5: Skills\x1b[0m`);
  console.log(`Model: ${MODEL}`);
  console.log(`Workspace: ${WORKDIR}`);
  console.log(`Skills Directory: ${SKILLS_DIR}`);
  console.log(`Tools: bash, read_file, write_file, edit_file, load_skill`);
  console.log(`Type 'exit' or 'q' to quit\n`);

  rl.on('close', () => {
    process.exit(0);
  });

  while (true) {
    const query = await new Promise<string>((resolve) => {
      rl.question('\x1b[36ms05 >> \x1b[0m', (answer) => {
        resolve(answer);
      });
    });

    if (query.trim().toLowerCase() === 'q' ||
        query.trim().toLowerCase() === 'exit' ||
        query.trim() === '') {
      break;
    }

    history.push({ role: 'user', content: query });
    await agentLoop(history);

    const finalText = extractText(history[history.length - 1].content);
    if (finalText) {
      console.log(finalText);
    }
    console.log();
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

if (process.argv[1]?.endsWith('s05-skill-loading.ts')) {
  main().catch(console.error);
}

export { SkillRegistry, agentLoop };
