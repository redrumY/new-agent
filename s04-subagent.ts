#!/usr/bin/env node
/**
 * s04_subagent.ts - Subagent with Context Isolation (Chapter 4)
 *
 * Spawn a child agent with fresh messages=[]. The child works in its own
 * context, sharing the filesystem, then returns only a summary to the parent.
 *
 * Key insight: "Fresh messages=[] gives context isolation. The parent stays clean."
 *
 * Based on the Learn Claude Code s04 reference.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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

const SYSTEM = `You are a coding agent at ${WORKDIR}. Use the task tool to delegate exploration or subtasks.`;
const SUBAGENT_SYSTEM = `You are a coding subagent at ${WORKDIR}. Complete the given task, then summarize your findings.`;

// ============================================================================
// Tool implementations
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
    const out = r.trim();
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
    let content = readFileSync(fp, 'utf-8');
    if (!content.includes(oldText)) {
      return `Error: Text not found in ${path}`;
    }
    content = content.replace(oldText, newText);
    writeFileSync(fp, content);
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
};

// ============================================================================
// Tool definitions
// ============================================================================

const CHILD_TOOLS = [
  { name: 'bash', description: 'Run a shell command.',
    input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'read_file', description: 'Read file contents.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'integer' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write content to a file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Replace exact text in file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'] } },
];

const PARENT_TOOLS = [
  ...CHILD_TOOLS,
  { name: 'task', description: 'Spawn a subagent with fresh context. It shares the filesystem but not conversation history.',
    input_schema: { type: 'object', properties: { prompt: { type: 'string' }, description: { type: 'string', description: 'Short description of the task' } }, required: ['prompt'] } },
];

// ============================================================================
// Subagent
// ============================================================================

export async function runSubagent(prompt: string): Promise<string> {
  const subMessages: Array<{ role: string; content: any }> = [
    { role: 'user', content: prompt }
  ];

  let response: any = null;

  for (let i = 0; i < 30; i++) {
    response = await client.messages.create({
      model: MODEL,
      system: SUBAGENT_SYSTEM,
      messages: subMessages as any,
      tools: CHILD_TOOLS as any,
      max_tokens: 8000,
    });

    subMessages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      break;
    }

    const results: any[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const handler = TOOL_HANDLERS[block.name];
        const output = handler ? handler(block.input) : `Unknown tool: ${block.name}`;
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: String(output).substring(0, 50000)
        });
      }
    }
    subMessages.push({ role: 'user', content: results });
  }

  // Only the final text returns to the parent
  if (!response) return '(no summary)';
  const texts = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  return texts || '(no summary)';
}

// ============================================================================
// Agent loop
// ============================================================================

export async function agentLoop(messages: Array<{ role: string; content: any }>): Promise<void> {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM,
      messages: messages as any,
      tools: PARENT_TOOLS as any,
      max_tokens: 8000,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      return;
    }

    const results: any[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        let output: string;

        if (block.name === 'task') {
          const desc = block.input.description || 'subtask';
          const prompt = block.input.prompt || '';
          console.log(`> task (${desc}): ${prompt.substring(0, 80)}`);
          output = await runSubagent(prompt);
        } else {
          const handler = TOOL_HANDLERS[block.name];
          output = handler ? handler(block.input) : `Unknown tool: ${block.name}`;
          console.log(`  ${String(output).substring(0, 200)}`);
        }

        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const history: Array<{ role: string; content: any }> = [];

  console.log(`\n\x1b[36mZ-Agent Loop v0.0.1 - Chapter 4: Subagent\x1b[0m`);
  console.log(`Model: ${MODEL}`);
  console.log(`Workspace: ${WORKDIR}`);
  console.log(`Tools: bash, read_file, write_file, edit_file, task`);
  console.log(`Type 'exit' or 'q' to quit\n`);

  // Handle stdin close gracefully (e.g., when using echo | tsx)
  rl.on('close', () => {
    process.exit(0);
  });

  while (true) {
    const query = await new Promise<string>((resolve) => {
      rl.question('\x1b[36ms04 >> \x1b[0m', (answer) => {
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

    const responseContent = history[history.length - 1].content;
    if (Array.isArray(responseContent)) {
      for (const block of responseContent) {
        if (block.type === 'text') {
          console.log(block.text);
        }
      }
    }
    console.log();
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

if (process.argv[1]?.endsWith('s04-subagent.ts')) {
  main().catch(console.error);
}
