#!/usr/bin/env node
/**
 * s06_context_compact.ts - Context Compact
 *
 * Teaching version:
 * 1. Large tool output persisted to disk
 * 2. Older tool results micro-compacted
 * 3. Full conversation summarization when too large
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, relative } from 'path';

config();
if (process.env.ANTHROPIC_BASE_URL) delete process.env.ANTHROPIC_AUTH_TOKEN;

const WORKDIR = process.cwd();
const client = new Anthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-20250514';

const CONTEXT_LIMIT = 50000;
const KEEP_RECENT_TOOL_RESULTS = 3;
const PERSIST_THRESHOLD = 30000;
const PREVIEW_CHARS = 2000;
const TRANSCRIPT_DIR = resolve(WORKDIR, '.transcripts');
const TOOL_RESULTS_DIR = resolve(WORKDIR, '.task_outputs', 'tool-results');

const SYSTEM = `You are a coding agent at ${WORKDIR}. Keep working step by step, and use compact if the conversation gets too long.`;

interface CompactState {
  has_compacted: boolean;
  last_summary: string;
  recent_files: string[];
}

function createCompactState(): CompactState {
  return { has_compacted: false, last_summary: '', recent_files: [] };
}

function estimateContextSize(messages: any[]): number {
  return JSON.stringify(messages).length;
}

function trackRecentFile(state: CompactState, path: string): void {
  const idx = state.recent_files.indexOf(path);
  if (idx !== -1) state.recent_files.splice(idx, 1);
  state.recent_files.push(path);
  if (state.recent_files.length > 5) state.recent_files = state.recent_files.slice(-5);
}

function safePath(pathStr: string): string {
  const path = resolve(WORKDIR, pathStr);
  const rel = relative(WORKDIR, path);
  if (rel.startsWith('..')) throw new Error(`Path escapes workspace: ${pathStr}`);
  return path;
}

function persistLargeOutput(toolUseId: string, output: string): string {
  if (output.length <= PERSIST_THRESHOLD) return output;

  mkdirSync(TOOL_RESULTS_DIR, { recursive: true });
  const storedPath = resolve(TOOL_RESULTS_DIR, `${toolUseId}.txt`);
  if (!existsSync(storedPath)) writeFileSync(storedPath, output);

  const preview = output.substring(0, PREVIEW_CHARS);
  const relPath = relative(WORKDIR, storedPath);
  return `<persisted-output>\nFull output saved to: ${relPath}\nPreview:\n${preview}\n</persisted-output>`;
}

function collectToolResultBlocks(messages: any[]): any[] {
  const blocks: any[] = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    const content = message.content;
    if (message.role !== 'user' || !Array.isArray(content)) continue;

    for (let blockIndex = 0; blockIndex < content.length; blockIndex++) {
      const block = content[blockIndex];
      if (block && block.type === 'tool_result') {
        blocks.push({ messageIndex, blockIndex, block });
      }
    }
  }
  return blocks;
}

function microCompact(messages: any[]): any[] {
  const toolResults = collectToolResultBlocks(messages);
  if (toolResults.length <= KEEP_RECENT_TOOL_RESULTS) return messages;

  const toCompact = toolResults.slice(0, -KEEP_RECENT_TOOL_RESULTS);
  for (const { block } of toCompact) {
    const content = block.content;
    if (typeof content === 'string' && content.length > 120) {
      block.content = '[Earlier tool result compacted. Re-run the tool if you need full detail.]';
    }
  }
  return messages;
}

function writeTranscript(messages: any[]): string {
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const path = resolve(TRANSCRIPT_DIR, `transcript_${Date.now()}.jsonl`);
  const lines = messages.map(msg => JSON.stringify(msg, (_, v) => typeof v === 'string' ? v : v));
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

async function summarizeHistory(messages: any[]): Promise<string> {
  const conversation = JSON.stringify(messages, (_, v) => typeof v === 'string' ? v : v).substring(0, 80000);
  const prompt = `Summarize this coding-agent conversation so work can continue.
Preserve:
1. The current goal
2. Important findings and decisions
3. Files read or changed
4. Remaining work
5. User constraints and preferences
Be compact but concrete.

${conversation}`;

  const response = await client.messages.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000
  });

  return (response.content[0] as any).text.trim();
}

async function compactHistory(messages: any[], state: CompactState, focus?: string): Promise<any[]> {
  const transcriptPath = writeTranscript(messages);
  console.log(`[transcript saved: ${transcriptPath}]`);

  let summary = await summarizeHistory(messages);
  if (focus) summary += `\n\nFocus to preserve next: ${focus}`;
  if (state.recent_files.length > 0) {
    const recentLines = state.recent_files.map(p => `- ${p}`).join('\n');
    summary += `\n\nRecent files to reopen if needed:\n${recentLines}`;
  }

  state.has_compacted = true;
  state.last_summary = summary;

  return [{
    role: 'user',
    content: `This conversation was compacted so the agent can continue working.\n\n${summary}`
  }];
}

function runBash(command: string, toolUseId: string): string {
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

    const output = (result as string).trim();
    return persistLargeOutput(toolUseId, output || '(no output)');
  } catch (error: any) {
    if (error.message?.includes('timeout')) return 'Error: Timeout (120s)';
    return `Error: ${error.message || error}`;
  }
}

function runRead(path: string, toolUseId: string, state: CompactState, limit?: number): string {
  try {
    trackRecentFile(state, path);
    const lines = readFileSync(safePath(path), 'utf-8').split('\n');

    let outputLines = lines;
    if (limit && limit < lines.length) {
      outputLines = lines.slice(0, limit);
      outputLines.push(`... (${lines.length - limit} more lines)`);
    }

    const output = outputLines.join('\n');
    return persistLargeOutput(toolUseId, output);
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
    if (!content.includes(oldText)) return `Error: Text not found in ${path}`;
    content = content.replace(oldText, newText);
    writeFileSync(filePath, content);
    return `Edited ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// Tool definitions (same as Python)
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
    description: 'Replace exact text in a file once.',
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
    name: 'compact',
    description: 'Summarize earlier conversation so work can continue in a smaller context.',
    input_schema: {
      type: 'object',
      properties: { focus: { type: 'string' } }
    }
  }
];

function extractText(content: any): string {
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) texts.push(block.text);
  }
  return texts.join('\n').trim();
}

function executeTool(block: any, state: CompactState): string {
  const input = block.input || {};
  if (block.name === 'bash') {
    return runBash(input.command, block.id);
  }
  if (block.name === 'read_file') {
    return runRead(input.path, block.id, state, input.limit);
  }
  if (block.name === 'write_file') {
    return runWrite(input.path, input.content);
  }
  if (block.name === 'edit_file') {
    return runEdit(input.path, input.old_text, input.new_text);
  }
  if (block.name === 'compact') {
    return 'Compacting conversation...';
  }
  return `Unknown tool: ${block.name}`;
}

async function agentLoop(messages: any[], state: CompactState): Promise<void> {
  while (true) {
    // Micro-compact (in-place modification like Python)
    const microCompacted = microCompact(messages);
    messages.splice(0, messages.length, ...microCompacted);

    if (estimateContextSize(messages) > CONTEXT_LIMIT) {
      console.log('[auto compact]');
      const compacted = await compactHistory(messages, state);
      messages.splice(0, messages.length, ...compacted);
    }

    const response = await client.messages.create({
      model: MODEL,
      system: SYSTEM,
      messages: messages as any,
      tools: TOOLS as any,
      max_tokens: 8000
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') return;

    const results: any[] = [];
    let manualCompact = false;
    let compactFocus: string | undefined = undefined;

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const output = executeTool(block, state);

      if (block.name === 'compact') {
        manualCompact = true;
        const input = (block as any).input || {};
        compactFocus = input.focus;
      }

      console.log(`> ${block.name}: ${String(output).substring(0, 200)}`);

      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: String(output)
      });
    }

    messages.push({ role: 'user', content: results });

    if (manualCompact) {
      console.log('[manual compact]');
      const compacted = await compactHistory(messages, state, compactFocus);
      messages.splice(0, messages.length, ...compacted);
    }
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history: any[] = [];
  const compactState = createCompactState();

  console.log(`\n\x1b[36mZ-Agent Loop v0.0.1 - Chapter 6: Context Compact\x1b[0m`);
  console.log(`Model: ${MODEL}`);
  console.log(`Workspace: ${WORKDIR}`);
  console.log(`Tools: bash, read_file, write_file, edit_file, compact`);
  console.log(`Type 'exit' or 'q' to quit\n`);

  rl.on('close', () => process.exit(0));

  while (true) {
    const query = await new Promise<string>((resolve) => {
      rl.question('\x1b[36ms06 >> \x1b[0m', (answer) => resolve(answer));
    });

    if (!query || query.trim().toLowerCase() === 'q' || query.trim().toLowerCase() === 'exit') break;

    history.push({ role: 'user', content: query });
    await agentLoop(history, compactState);

    const finalText = extractText(history[history.length - 1].content);
    if (finalText) console.log(finalText);
    console.log();
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

if (process.argv[1]?.endsWith('s06-context-compact.ts')) {
  main().catch(console.error);
}

export { createCompactState, agentLoop, compactHistory, microCompact, estimateContextSize };
