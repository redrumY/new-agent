#!/usr/bin/env node
/**
 * s08_hook_system.ts - Hook System
 *
 * Hooks are extension points around the main loop.
 * They let readers add behavior without rewriting the loop itself.
 *
 * Teaching version:
 *   - SessionStart
 *   - PreToolUse
 *   - PostToolUse
 *
 * Teaching exit-code contract:
 *   - 0 -> continue
 *   - 1 -> block
 *   - 2 -> inject a message
 *
 * This is intentionally simpler than a production system. The goal here is to
 * teach the extension pattern clearly before introducing event-specific edge
 * cases.
 *
 * Key insight: "Extend the agent without touching the loop."
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
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
// HOOK EVENTS AND CONSTANTS
// ============================================================================

type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart';
const HOOK_EVENTS: HookEvent[] = ['PreToolUse', 'PostToolUse', 'SessionStart'];
const HOOK_TIMEOUT = 30; // seconds

// Workspace trust marker. Hooks only run if this file exists (or SDK mode).
const TRUST_MARKER = resolve(WORKDIR, '.claude', '.claude_trusted');

// ============================================================================
// HOOK MANAGER
// ============================================================================

interface HookDefinition {
  matcher?: string;
  command: string;
}

interface HookConfig {
  hooks: {
    PreToolUse?: HookDefinition[];
    PostToolUse?: HookDefinition[];
    SessionStart?: HookDefinition[];
  };
}

interface HookResult {
  blocked: boolean;
  messages: string[];
  block_reason?: string;
  permission_override?: string;
}

interface HookContext {
  tool_name: string;
  tool_input: Record<string, any>;
  tool_output?: string;
}

class HookManager {
  /**
   * Load and execute hooks from .hooks.json configuration.
   *
   * The hook manager does three simple jobs:
   * - load hook definitions
   * - run matching commands for an event
   * - aggregate block / message results for the caller
   */

  private hooks: Record<HookEvent, HookDefinition[]> = {
    PreToolUse: [],
    PostToolUse: [],
    SessionStart: []
  };
  private readonly sdkMode: boolean;

  constructor(configPath: string | null = null, sdkMode: boolean = false) {
    this.sdkMode = sdkMode;
    const path = configPath || resolve(WORKDIR, '.hooks.json');

    if (existsSync(path)) {
      try {
        const configText = readFileSync(path, 'utf-8');
        const config: HookConfig = JSON.parse(configText);

        for (const event of HOOK_EVENTS) {
          this.hooks[event] = config.hooks?.[event] || [];
        }
        console.log(`[Hooks loaded from ${path}]`);
      } catch (error: any) {
        console.log(`[Hook config error: ${error.message}]`);
      }
    }
  }

  private _checkWorkspaceTrust(): boolean {
    /**
     * Check whether the current workspace is trusted.
     *
     * The teaching version uses a simple trust marker file.
     * In SDK mode, trust is treated as implicit.
     */
    if (this.sdkMode) {
      return true;
    }
    return existsSync(TRUST_MARKER);
  }

  runHooks(event: HookEvent, context: HookContext | null = null): HookResult {
    /**
     * Execute all hooks for an event.
     *
     * Returns: {"blocked": bool, "messages": string[]}
     *   - blocked: True if any hook returned exit code 1
     *   - messages: stderr content from exit-code-2 hooks (to inject)
     */

    const result: HookResult = {
      blocked: false,
      messages: []
    };

    // Trust gate: refuse to run hooks in untrusted workspaces
    if (!this._checkWorkspaceTrust()) {
      return result;
    }

    const hooks = this.hooks[event] || [];

    for (const hookDef of hooks) {
      // Check matcher (tool name filter for PreToolUse/PostToolUse)
      const matcher = hookDef.matcher;
      if (matcher && context) {
        const toolName = context.tool_name;
        if (matcher !== '*' && matcher !== toolName) {
          continue;
        }
      }

      const command = hookDef.command;
      if (!command) {
        continue;
      }

      // Build environment with hook context
      const env = { ...process.env };
      if (context) {
        env.HOOK_EVENT = event;
        env.HOOK_TOOL_NAME = context.tool_name || '';
        env.HOOK_TOOL_INPUT = JSON.stringify(context.tool_input || {}).substring(0, 10000);
        if ('tool_output' in context) {
          env.HOOK_TOOL_OUTPUT = String(context.tool_output || '').substring(0, 10000);
        }
      }

      try {
        const r = execSync(command, {
          cwd: WORKDIR,
          env: env as any,
          encoding: 'utf-8',
          timeout: HOOK_TIMEOUT * 1000,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // returncode 0: Continue silently
        const stdout = (r as string).trim();
        if (stdout) {
          console.log(`  [hook:${event}] ${stdout.substring(0, 100)}`);
        }

        // Optional structured stdout: small extension point that
        // keeps the teaching contract simple.
        try {
          const hookOutput = JSON.parse(stdout);
          if (hookOutput.updatedInput && context) {
            context.tool_input = hookOutput.updatedInput;
          }
          if (hookOutput.additionalContext) {
            result.messages.push(hookOutput.additionalContext);
          }
          if (hookOutput.permissionDecision) {
            result.permission_override = hookOutput.permissionDecision;
          }
        } catch {
          // stdout was not JSON -- normal for simple hooks
        }

      } catch (error: any) {
        // Check if it's a timeout error
        if (error.errno === 'ETIMEDOUT' || error.signal === 'SIGTERM' || error.signal === 'SIGKILL') {
          console.log(`  [hook:${event}] Timeout (${HOOK_TIMEOUT}s)`);
          continue;
        }

        // For other errors, check the status code via error.status
        const status = (error as any).status;

        if (status === 1) {
          // Block execution
          result.blocked = true;
          result.block_reason = error.stderr?.trim() || 'Blocked by hook';
          console.log(`  [hook:${event}] BLOCKED: ${result.block_reason.substring(0, 200)}`);
        } else if (status === 2) {
          // Inject message
          const msg = error.stderr?.trim();
          if (msg) {
            result.messages.push(msg);
            console.log(`  [hook:${event}] INJECT: ${msg.substring(0, 200)}`);
          }
        } else {
          console.log(`  [hook:${event}] Error: ${error.message || error}`);
        }
      }
    }

    return result;
  }
}

// ============================================================================
// TOOL IMPLEMENTATIONS (same as s02)
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

const TOOL_HANDLERS: Record<string, (params: any) => string> = {
  bash: (kw) => runBash(kw.command),
  read_file: (kw) => runRead(kw.path, kw.limit),
  write_file: (kw) => runWrite(kw.path, kw.content),
  edit_file: (kw) => runEdit(kw.path, kw.old_text, kw.new_text),
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
  }
];

const SYSTEM = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks.`;

// ============================================================================
// AGENT LOOP
// ============================================================================

async function agentLoop(messages: Array<{ role: string; content: any }>, hooks: HookManager): Promise<void> {
  /**
   * The hook-aware agent loop.
   *
   * The teaching version keeps only the clearest integration points:
   * SessionStart, PreToolUse, execute tool, PostToolUse.
   */

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

      const toolInput = { ...(block.input || {}) };
      const ctx: HookContext = { tool_name: block.name, tool_input: toolInput };

      // -- PreToolUse hooks --
      const preResult = hooks.runHooks('PreToolUse', ctx);

      // Inject hook messages into results
      for (const msg of preResult.messages) {
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `[Hook message]: ${msg}`
        });
      }

      if (preResult.blocked) {
        const reason = preResult.block_reason || 'Blocked by hook';
        const output = `Tool blocked by PreToolUse hook: ${reason}`;
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output
        });
        continue;
      }

      // -- Execute tool --
      const handler = TOOL_HANDLERS[block.name];
      let output: string;
      try {
        output = handler ? handler(toolInput) : `Unknown: ${block.name}`;
      } catch (error: any) {
        output = `Error: ${error.message}`;
      }
      console.log(`> ${block.name}: ${String(output).substring(0, 200)}`);

      // -- PostToolUse hooks --
      ctx.tool_output = output;
      const postResult = hooks.runHooks('PostToolUse', ctx);

      // Inject post-hook messages
      for (const msg of postResult.messages) {
        output += `\n[Hook note]: ${msg}`;
      }

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
  const hooks = new HookManager();

  // Fire SessionStart hooks
  hooks.runHooks('SessionStart', { tool_name: '', tool_input: {} });

  const history: Array<{ role: string; content: any }> = [];

  // Create readline interface once (matches Python's input() pattern)
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('close', () => process.exit(0));

  while (true) {
    const query = await new Promise<string>((resolve) => {
      rl.question('\x1b[36ms08 >> \x1b[0m', (ans) => {
        resolve(ans);
      });
    });

    if (!query || query.trim().toLowerCase() === 'q' || query.trim().toLowerCase() === 'exit') {
      break;
    }

    history.push({ role: 'user', content: query });
    await agentLoop(history, hooks);

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

if (process.argv[1]?.endsWith('s08-hook-system.ts')) {
  main().catch(console.error);
}

export { HookManager, HookEvent, HookDefinition, HookContext, HookResult };
