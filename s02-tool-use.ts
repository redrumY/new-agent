#!/usr/bin/env node
/**
 * s02_tool_use.ts - Tool Dispatch + Message Normalization (Chapter 2)
 *
 * This chapter adds file operation tools to the agent loop.
 *
 * Key insight from the tutorial: "The loop didn't change at all.
 * I just added tools."
 *
 * New tools in this chapter:
 * - read_file: Read file contents with optional line limit
 * - write_file: Write content to a file
 * - edit_file: Edit file by replacing text
 *
 * Safety improvements:
 * - Path validation (prevent escaping workspace)
 * - Concurrent execution safety classification
 *
 * Based on the Learn Claude Code s02 reference.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, relative } from 'path';

// Load .env file
config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.ANTHROPIC_BASE_URL;
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-20250514';
const WORKDIR = process.cwd();

const client = API_KEY ? new Anthropic({
  apiKey: API_KEY,
  baseURL: BASE_URL
}) : null;

const SYSTEM = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks. Act, don't explain.`;

// ============================================================================
// PATH SAFETY
// ============================================================================

/**
 * safePath - Validate and resolve a path safely
 *
 * Prevents path traversal attacks by ensuring the resolved path
 * is within the workspace directory.
 *
 * @param pathStr - The path to validate
 * @returns Resolved absolute path
 * @throws Error if path escapes workspace
 */
function safePath(pathStr: string): string {
  const resolved = resolve(WORKDIR, pathStr);
  const rel = relative(WORKDIR, resolved);

  // If path starts with '..', it escapes workspace
  if (rel.startsWith('..')) {
    throw new Error(`Path escapes workspace: ${pathStr}`);
  }

  return resolved;
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

/**
 * runBash - Execute a bash command safely
 */
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
    return result.trim() || '(no output)';
  } catch (error: any) {
    if (error.message.includes('timeout')) {
      return 'Error: Timeout (120s)';
    }
    return error.message || 'Error: Command failed';
  }
}

/**
 * runRead - Read file contents with optional line limit
 *
 * @param path - File path (relative to workspace)
 * @param limit - Optional line limit
 * @returns File contents or error message
 */
//执行器 与操作系统交互 将底层报错捕获并返回为字符串
function runRead(path: string, limit?: number): string {
  try {
    const safe = safePath(path);
    let text = readFileSync(safe, 'utf-8');

    if (limit) {
      const lines = text.split('\n');
      if (limit < lines.length) {
        text = lines.slice(0, limit).join('\n') +
               `\n... (${lines.length - limit} more lines)`;
      }
    }

    return text.substring(0, 50000);
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

/**
 * runWrite - Write content to a file
 *
 * Creates parent directories if they don't exist.
 *
 * @param path - File path (relative to workspace)
 * @param content - Content to write
 * @returns Success message or error
 */
function runWrite(path: string, content: string): string {
  try {
    const safe = safePath(path);
    mkdirSync(resolve(safe, '..'), { recursive: true });
    writeFileSync(safe, content);
    return `Wrote ${content.length} bytes to ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

/**
 * runEdit - Edit file by replacing text
 *
 * @param path - File path (relative to workspace)
 * @param oldText - Text to replace
 * @param newText - Replacement text
 * @returns Success message or error
 */
function runEdit(path: string, oldText: string, newText: string): string {
  try {
    const safe = safePath(path);
    let content = readFileSync(safe, 'utf-8');

    if (!content.includes(oldText)) {
      return `Error: Text not found in ${path}`;
    }

    // Replace first occurrence only
    content = content.replace(oldText, newText);
    writeFileSync(safe, content);

    return `Edited ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

/**
 * runSearch - Search the web and return results
 *
 * Note: This is a simplified implementation that returns search URLs.
 * In production, you would integrate with a real search API.
 *
 * @param query - Search query string
 * @param limit - Optional result limit (default 5)
 * @returns Search results or error message
 */
function runSearch(query: string, limit: number = 5): string {
  try {
    // Encode query for URL
    const encodedQuery = encodeURIComponent(query);

    // Generate search URLs for common search engines
    const searchEngines = [
      { name: 'Google', url: `https://www.google.com/search?q=${encodedQuery}` },
      { name: 'Bing', url: `https://www.bing.com/search?q=${encodedQuery}` },
      { name: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${encodedQuery}` }
    ];

    let results = `Search results for "${query}":\n\n`;

    for (const engine of searchEngines.slice(0, limit)) {
      results += `${engine.name}: ${engine.url}\n`;
    }

    results += `\nNote: This is a simplified search tool that generates search URLs. `;
    results += `For actual search results, integrate with a search API like Google Custom Search or Bing Search API.`;

    return results;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// ============================================================================
// CONCURRENCY SAFETY
// ============================================================================

/**
 * Read-only tools can safely run in parallel.
 * Mutating tools must be serialized.
 */
const CONCURRENCY_SAFE = new Set(['read_file']);
const CONCURRENCY_UNSAFE = new Set(['write_file', 'edit_file', 'bash']);

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const TOOLS = [
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
        limit: {
          type: 'number',
          description: 'Optional line limit'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file.',
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
    description: 'Edit file by replacing text.',
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
    name: 'search_web',
    description: 'Search the web for information.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string'
        },
        limit: {
          type: 'number',
          description: 'Number of search results to return (default 3)'
        }
      },
      required: ['query']
    }
  }
];

// ============================================================================
// DATA STRUCTURES
// ============================================================================

interface LoopState {
  messages: Array<{ role: string; content: any }>;
  turnCount: number;
  transitionReason: string | null;
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

function extractText(content: any): string {
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      texts.push(block.text);
    }
  }
  return texts.join('\n').trim();
}

function executeToolCalls(responseContent: any[]): Array<{ type: string; tool_use_id: string; content: any }> {
  const results: Array<{ type: string; tool_use_id: string; content: any }> = [];

  for (const block of responseContent) {
    if (block.type !== 'tool_use') continue;

    const toolName = block.name;
    const toolUseId = block.id;
    const input = block.input;

    let output: string;

    switch (toolName) {
      case 'bash':
        console.log(`\x1b[33m$ ${input.command}\x1b[0m`);
        output = runBash(input.command);
        console.log(output.substring(0, 200));
        if (output.length > 200) console.log('...');
        break;

      case 'read_file':
        output = runRead(input.path, input.limit);
        break;

      case 'write_file':
        output = runWrite(input.path, input.content);
        console.log(`\x1b[32m${output}\x1b[0m`);
        break;

      case 'edit_file':
        output = runEdit(input.path, input.old_text, input.new_text);
        console.log(`\x1b[32m${output}\x1b[0m`);
        break;

      case 'search_web':
        console.log(`\x1b[36m🔍 Searching: ${input.query}\x1b[0m`);
        output = runSearch(input.query, input.limit || 3);
        console.log(`\x1b[36m${output.split('\n').slice(0, 3).join('\n')}\x1b[0m`);
        if (output.length > 200) console.log('...');
        break;

      default:
        output = `Error: Unknown tool '${toolName}'`;
    }

    results.push({
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: output
    });
  }

  return results;
}

// ============================================================================
// AGENT LOOP (unchanged from s01!)
// ============================================================================

async function runOneTurn(state: LoopState): Promise<boolean> {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const response = await client.messages.create({
    model: MODEL,
    system: SYSTEM,
    messages: state.messages as any,
    tools: TOOLS as any,
    max_tokens: 8000
  });

  state.messages.push({
    role: 'assistant',
    content: response.content
  });

  if (response.stop_reason !== 'tool_use') {
    state.transitionReason = null;
    return false;
  }

  const results = executeToolCalls(response.content);
  if (results.length === 0) {
    state.transitionReason = null;
    return false;
  }

  state.messages.push({
    role: 'user',
    content: results
  });

  state.turnCount += 1;
  state.transitionReason = 'tool_result';
  return true;
}

async function agentLoop(state: LoopState): Promise<void> {
  while (await runOneTurn(state)) {
    console.log(`\n--- Turn ${state.turnCount} ---\n`);
  }
}

// ============================================================================
// MAIN REPL
// ============================================================================

async function main() {
  if (!client) {
    console.error('\x1b[31mError: ANTHROPIC_API_KEY not set\x1b[0m');
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const history: Array<{ role: string; content: any }> = [];

  const query = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('\x1b[36ms02 >> \x1b[0m', (answer) => {
        resolve(answer);
      });
    });
  };

  console.log(`\nZ-Agent Loop v0.0.1 - Chapter 2: Tool Use`);
  console.log(`Model: ${MODEL}`);
  console.log(`Workspace: ${WORKDIR}`);
  console.log(`Tools: bash, read_file, write_file, edit_file, search_web`);
  console.log(`Type 'exit' or 'q' to quit\n`);

  while (true) {
    const input = await query();

    if (input.toLowerCase().trim() === 'q' ||
        input.toLowerCase().trim() === 'exit' ||
        input.trim() === '') {
      break;
    }

    history.push({ role: 'user', content: input });

    const state: LoopState = {
      messages: [...history],
      turnCount: 1,
      transitionReason: null
    };

    await agentLoop(state);

    history.length = 0;
    history.push(...state.messages);

    const lastMessage = state.messages[state.messages.length - 1];
    const finalText = extractText(lastMessage.content);
    if (finalText) {
      console.log(`\n${finalText}\n`);
    }
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

if (process.argv[1] && process.argv[1].endsWith('s02-tool-use.ts')) {
  main().catch(console.error);
}

export { runOneTurn, agentLoop, type LoopState };
