#!/usr/bin/env node
/**
 * s07_permission_system.ts - Permission System
 *
 * Every tool call passes through a permission pipeline before execution.
 *
 * Teaching pipeline:
 *   1. deny rules
 *   2. mode check
 *   3. allow rules
 *   4. ask user
 *
 * This version intentionally teaches three modes first:
 *   - default
 *   - plan
 *   - auto
 *
 * That is enough to build a real, understandable permission system without
 * burying readers under every advanced policy branch on day one.
 *
 * Key insight: "Safety is a pipeline, not a boolean."
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, relative } from 'path';

config();

if (process.env.ANTHROPIC_BASE_URL) {
  delete (process.env as any).ANTHROPIC_AUTH_TOKEN;
}

const WORKDIR = process.cwd();
const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
});
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-20250514';

// ============================================================================
// PERMISSION MODES
// ============================================================================

type PermissionMode = 'default' | 'plan' | 'auto';
const MODES: PermissionMode[] = ['default', 'plan', 'auto'];

const READ_ONLY_TOOLS = new Set(['read_file', 'bash_readonly']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'bash']);

// ============================================================================
// FNMATCH-STYLE GLOB MATCHING
// ============================================================================

/**
 * Simple fnmatch-style glob matching.
 * Supports:
 *   * matches any sequence of characters
 *   ? matches any single character
 *   [seq] matches any character in seq
 *   [!seq] matches any character not in seq
 */
function fnmatch(pattern: string, text: string): boolean {
  // Convert glob pattern to RegExp
  let regexStr = '^';
  let i = 0;
  const chars = pattern;

  while (i < chars.length) {
    const c = chars[i];
    if (c === '*') {
      regexStr += '.*';
      i++;
    } else if (c === '?') {
      regexStr += '.';
      i++;
    } else if (c === '[') {
      // Handle character class
      let j = i + 1;
      let negate = false;
      if (j < chars.length && chars[j] === '!') {
        negate = true;
        j++;
      }
      let classChars = '';
      while (j < chars.length && chars[j] !== ']') {
        classChars += chars[j];
        j++;
      }
      if (j < chars.length) {
        // Found closing bracket
        if (negate) {
          regexStr += `[^${classChars}]`;
        } else {
          regexStr += `[${classChars}]`;
        }
        i = j + 1;
      } else {
        // No closing bracket, treat [ as literal
        regexStr += '\\[';
        i++;
      }
    } else {
      // Escape special regex characters
      if ('.^$+{}()|\\/'.indexOf(c) !== -1) {
        regexStr += '\\';
      }
      regexStr += c;
      i++;
    }
  }

  regexStr += '$';
  const regex = new RegExp(regexStr);
  return regex.test(text);
}

// ============================================================================
// BASH SECURITY VALIDATION
// ============================================================================

interface ValidatorFailure {
  name: string;
  pattern: string;
}

class BashSecurityValidator {
  /**
   * Validate bash commands for obviously dangerous patterns.
   *
   * The teaching version deliberately keeps this small and easy to read.
   * First catch a few high-risk patterns, then let the permission pipeline
   * decide whether to deny or ask the user.
   */

  private readonly VALIDATORS: Array<[string, RegExp]> = [
    ['shell_metachar', /[;&|`$]/],
    ['sudo', /\bsudo\b/],
    ['rm_rf', /\brm\s+(-[a-zA-Z]*)?r/],
    ['cmd_substitution', /\$\(/],
    ['ifs_injection', /\bIFS\s*=/],
  ];

  validate(command: string): ValidatorFailure[] {
    /**
     * Check a bash command against all validators.
     *
     * Returns list of (validator_name, matched_pattern) tuples for failures.
     * An empty list means the command passed all validators.
     */
    const failures: ValidatorFailure[] = [];
    for (const [name, pattern] of this.VALIDATORS) {
      if (pattern.test(command)) {
        failures.push({ name, pattern: pattern.source });
      }
    }
    return failures;
  }

  isSafe(command: string): boolean {
    /** Convenience: returns True only if no validators triggered. */
    return this.validate(command).length === 0;
  }

  describeFailures(command: string): string {
    /** Human-readable summary of validation failures. */
    const failures = this.validate(command);
    if (failures.length === 0) {
      return 'No issues detected';
    }
    const parts = failures.map(f => `${f.name} (pattern: ${f.pattern})`);
    return 'Security flags: ' + parts.join(', ');
  }
}

// ============================================================================
// WORKSPACE TRUST
// ============================================================================

function isWorkspaceTrusted(workspace: string = WORKDIR): boolean {
  /**
   * Check if a workspace has been explicitly marked as trusted.
   *
   * The teaching version uses a simple marker file. A more complete system
   * can layer richer trust flows on top of the same idea.
   */
  const ws = workspace || WORKDIR;
  const trustMarker = resolve(ws, '.claude', '.claude_trusted');
  return existsSync(trustMarker);
}

// Singleton validator instance used by the permission pipeline
const bashValidator = new BashSecurityValidator();

// ============================================================================
// PERMISSION RULES
// ============================================================================

interface PermissionRule {
  tool?: string;
  path?: string;
  content?: string;
  behavior: 'allow' | 'deny' | 'ask';
}

/**
 * Rules are checked in order: first match wins.
 * Format: {"tool": "<tool_name_or_*>", "path": "<glob_or_*>", "behavior": "allow|deny|ask"}
 */
const DEFAULT_RULES: PermissionRule[] = [
  // Always deny dangerous patterns
  { tool: 'bash', content: 'rm -rf /', behavior: 'deny' },
  { tool: 'bash', content: 'sudo *', behavior: 'deny' },
  // Allow reading anything
  { tool: 'read_file', path: '*', behavior: 'allow' },
];

// ============================================================================
// PERMISSION MANAGER
// ============================================================================

interface PermissionDecision {
  behavior: 'allow' | 'deny' | 'ask';
  reason: string;
}

class PermissionManager {

  mode: PermissionMode;
  rules: PermissionRule[];
  consecutiveDenials: number = 0;
  private readonly maxConsecutiveDenials = 3;

  constructor(mode: PermissionMode = 'default', rules: PermissionRule[] | null = null) {
    if (!MODES.includes(mode)) {
      throw new Error(`Unknown mode: ${mode}. Choose from ${MODES.join(', ')}`);
    }
    this.mode = mode;
    this.rules = rules ? [...rules] : [...DEFAULT_RULES];
  }

  check(toolName: string, toolInput: Record<string, any>): PermissionDecision {
    /**
     * Returns: {"behavior": "allow"|"deny"|"ask", "reason": str}
     */

    // Step 0: Bash security validation (before deny rules)
    // Teaching version checks early for clarity.
    if (toolName === 'bash') {
      const command = toolInput.command || '';
      const failures = bashValidator.validate(command);
      if (failures.length > 0) {
        // Severe patterns (sudo, rm_rf) get immediate deny
        const severe = new Set(['sudo', 'rm_rf']);
        const severeHits = failures.filter(f => severe.has(f.name));
        if (severeHits.length > 0) {
          const desc = bashValidator.describeFailures(command);
          return { behavior: 'deny', reason: `Bash validator: ${desc}` };
        }
        // Other patterns escalate to ask (user can still approve)
        const desc = bashValidator.describeFailures(command);
        return { behavior: 'ask', reason: `Bash validator flagged: ${desc}` };
      }
    }

    // Step 1: Deny rules (bypass-immune, checked first always)
    for (const rule of this.rules) {
      if (rule.behavior !== 'deny') continue;
      if (this._matches(rule, toolName, toolInput)) {
        return { behavior: 'deny', reason: `Blocked by deny rule: ${JSON.stringify(rule)}` };
      }
    }

    // Step 2: Mode-based decisions
    if (this.mode === 'plan') {
      // Plan mode: deny all write operations, allow reads
      if (WRITE_TOOLS.has(toolName)) {
        return { behavior: 'deny', reason: 'Plan mode: write operations are blocked' };
      }
      return { behavior: 'allow', reason: 'Plan mode: read-only allowed' };
    }

    if (this.mode === 'auto') {
      // Auto mode: auto-allow read-only tools, ask for writes
      if (READ_ONLY_TOOLS.has(toolName) || toolName === 'read_file') {
        return { behavior: 'allow', reason: 'Auto mode: read-only tool auto-approved' };
      }
      // Teaching: fall through to allow rules, then ask
    }

    // Step 3: Allow rules
    for (const rule of this.rules) {
      if (rule.behavior !== 'allow') continue;
      if (this._matches(rule, toolName, toolInput)) {
        this.consecutiveDenials = 0;
        return { behavior: 'allow', reason: `Matched allow rule: ${JSON.stringify(rule)}` };
      }
    }

    // Step 4: Ask user (default behavior for unmatched tools)
    return { behavior: 'ask', reason: `No rule matched for ${toolName}, asking user` };
  }

  async askUser(toolName: string, toolInput: Record<string, any>): Promise<boolean> {
    /** Interactive approval prompt. Returns True if approved. */
    const preview = JSON.stringify(toolInput).substring(0, 200);
    console.log(`\n  [Permission] ${toolName}: ${preview}`);

    const answer = await new Promise<string>((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('  Allow? (y/n/always): ', (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (answer === 'always') {
      // Add permanent allow rule for this tool
      this.rules.push({ tool: toolName, path: '*', behavior: 'allow' });
      this.consecutiveDenials = 0;
      return true;
    }
    if (answer === 'y' || answer === 'yes') {
      this.consecutiveDenials = 0;
      return true;
    }

    // Track denials for circuit breaker
    this.consecutiveDenials++;
    if (this.consecutiveDenials >= this.maxConsecutiveDenials) {
      console.log(`  [${this.consecutiveDenials} consecutive denials -- consider switching to plan mode]`);
    }
    return false;
  }

  private _matches(rule: PermissionRule, toolName: string, toolInput: Record<string, any>): boolean {
    /** Check if a rule matches the tool call. */

    // Tool name match
    if (rule.tool && rule.tool !== '*') {
      if (rule.tool !== toolName) {
        return false;
      }
    }

    // Path pattern match
    if (rule.path && rule.path !== '*') {
      const path = toolInput.path || '';
      if (!fnmatch(rule.path, path)) {
        return false;
      }
    }

    // Content pattern match (for bash commands)
    if (rule.content) {
      const command = toolInput.command || '';
      if (!fnmatch(rule.content, command)) {
        return false;
      }
    }

    return true;
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
      const originalLength = lines.length;
      lines.length = limit;
      lines.push(`... (${originalLength - limit} more)`);
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

const SYSTEM = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks.
The user controls permissions. Some tool calls may be denied.`;

// ============================================================================
// AGENT LOOP
// ============================================================================

async function agentLoop(messages: Array<{ role: string; content: any }>, perms: PermissionManager): Promise<void> {
  /**
   * The permission-aware agent loop.
   *
   * For each tool call:
   *   1. LLM requests tool use
   *   2. Permission pipeline checks: deny_rules -> mode -> allow_rules -> ask
   *   3. If allowed: execute tool, return result
   *   4. If denied: return rejection message to LLM
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

      // -- Permission check --
      const decision = perms.check(block.name, block.input || {});

      let output: string;

      if (decision.behavior === 'deny') {
        output = `Permission denied: ${decision.reason}`;
        console.log(`  [DENIED] ${block.name}: ${decision.reason}`);
      } else if (decision.behavior === 'ask') {
        const allowed = await perms.askUser(block.name, block.input || {});
        if (allowed) {
          const handler = TOOL_HANDLERS[block.name];
          output = handler ? handler(block.input || {}) : `Unknown: ${block.name}`;
          console.log(`> ${block.name}: ${String(output).substring(0, 200)}`);
        } else {
          output = `Permission denied by user for ${block.name}`;
          console.log(`  [USER DENIED] ${block.name}`);
        }
      } else {
        // allow
        const handler = TOOL_HANDLERS[block.name];
        output = handler ? handler(block.input || {}) : `Unknown: ${block.name}`;
        console.log(`> ${block.name}: ${String(output).substring(0, 200)}`);
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
  // Choose permission mode at startup
  console.log('Permission modes: default, plan, auto');
  const modeInput = await new Promise<string>((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('Mode (default): ', (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() || 'default');
    });
  });

  const finalMode: PermissionMode = MODES.includes(modeInput as PermissionMode) ? (modeInput as PermissionMode) : 'default';
  const perms = new PermissionManager(finalMode);
  console.log(`[Permission mode: ${finalMode}]`);

  const history: Array<{ role: string; content: any }> = [];

  // Create readline interface once (matches Python's input() pattern)
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('close', () => process.exit(0));

  while (true) {
    const query = await new Promise<string>((resolve) => {
      rl.question('\x1b[36ms07 >> \x1b[0m', (ans) => {
        resolve(ans);
      });
    });

    if (!query || query.trim().toLowerCase() === 'q' || query.trim().toLowerCase() === 'exit') {
      break;
    }

    // /mode command to switch modes at runtime
    if (query.startsWith('/mode')) {
      const parts = query.split(/\s+/);
      if (parts.length === 2 && MODES.includes(parts[1] as PermissionMode)) {
        perms.mode = parts[1] as PermissionMode;
        console.log(`[Switched to ${parts[1]} mode]`);
      } else {
        console.log(`Usage: /mode <${MODES.join('|')}>`);
      }
      continue;
    }

    // /rules command to show current rules
    if (query.trim() === '/rules') {
      perms.rules.forEach((rule, i) => {
        console.log(`  ${i}: ${JSON.stringify(rule)}`);
      });
      continue;
    }

    history.push({ role: 'user', content: query });
    await agentLoop(history, perms);

    const responseContent = history[history.length - 1].content;
    if (Array.isArray(responseContent)) {
      for (const block of responseContent) {
        if ((block as any).text) {
          console.log((block as any).text);
        }
      }
    }
    console.log();
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

if (process.argv[1]?.endsWith('s07-permission-system.ts')) {
  main().catch(console.error);
}

export { PermissionManager, BashSecurityValidator, PermissionMode, PermissionRule };
