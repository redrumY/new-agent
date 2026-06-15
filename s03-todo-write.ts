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
const PLAN_REMINDER_INTERVAL = 3; // Remind after 3 rounds without update

const client = API_KEY ? new Anthropic({
  apiKey: API_KEY,
  baseURL: BASE_URL
}) : null;

const SYSTEM = `You are a coding agent at ${WORKDIR}.
Use the todo tool for multi-step work.
Keep exactly one step in_progress when a task has multiple steps.
Refresh the plan as work advances. Prefer tools over prose.`;

// ============================================================================
// PLANNING DATA STRUCTURES
// ============================================================================

/**
 * PlanItem - A single item in the session plan
 *
 * @param content - What needs to be done
 * @param status - pending, in_progress, or completed
 * @param activeForm - Present-tense form for display during execution
 */
interface PlanItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

/**
 * PlanningState - The overall planning state
 *
 * @param items - List of plan items
 * @param roundsSinceUpdate - Rounds since last plan update
 */
interface PlanningState {
  items: PlanItem[];
  roundsSinceUpdate: number;
}

// ============================================================================
// TODO MANAGER
// ============================================================================

/**
 * TodoManager - Manages the session plan
 *
 * Responsibilities:
 * - Update and validate the plan
 * - Track rounds since last update
 * - Generate reminders when plan gets stale
 * - Render plan for display
 */
class TodoManager {
  private state: PlanningState;

  constructor() {
    this.state = {
      items: [],
      roundsSinceUpdate: 0
    };
  }

  /**
   * update - Update the plan with new items
   *
   * Validation rules:
   * - Max 12 items (keep plan short)
   * - Exactly one item can be in_progress
   * - All items must have content
   * - Status must be valid
   *
   * @param items - New plan items
   * @returns Rendered plan
   */
  update(items: any[]): string {
    if (items.length > 12) {
      throw new Error('Keep the session plan short (max 12 items)');
    }

    const normalized: PlanItem[] = [];
    let inProgressCount = 0;

    for (let index = 0; index < items.length; index++) {
      const rawItem = items[index];
      const content = String(rawItem.content || '').trim();
      const status = String(rawItem.status || 'pending').toLowerCase();
      const activeForm = String(rawItem.activeForm || '').trim();

      if (!content) {
        throw new Error(`Item ${index}: content required`);
      }

      if (!['pending', 'in_progress', 'completed'].includes(status)) {
        throw new Error(`Item ${index}: invalid status '${status}'`);
      }

      if (status === 'in_progress') {
        inProgressCount++;
      }

      normalized.push({
        content,
        status: status as PlanItem['status'],
        activeForm
      });
    }

    if (inProgressCount > 1) {
      throw new Error('Only one plan item can be in_progress');
    }

    this.state.items = normalized;
    this.state.roundsSinceUpdate = 0;

    return this.render();
  }

  /**
   * noteRoundWithoutUpdate - Track a round without plan update
   */
  noteRoundWithoutUpdate(): void {
    this.state.roundsSinceUpdate++;
  }

  /**
   * reminder - Get reminder if plan is stale
   *
   * @returns Reminder message or null
   */
  reminder(): string | null {
    if (this.state.items.length === 0) {
      return null;
    }

    if (this.state.roundsSinceUpdate < PLAN_REMINDER_INTERVAL) {
      return null;
    }

    return '<reminder>Refresh your current plan before continuing.</reminder>';
  }

  /**
   * render - Render the plan for display
   *
   * @returns Rendered plan string
   */
  render(): string {
    if (this.state.items.length === 0) {
      return 'No session plan yet.';
    }

    const lines: string[] = [];

    for (const item of this.state.items) {
      const marker = {
        pending: '[ ]',
        in_progress: '[~]',
        completed: '[x]'
      }[item.status];

      const line = `${marker} ${item.content}`;

      if (item.status === 'in_progress' && item.activeForm) {
        lines.push(`${marker} ${item.activeForm}`);
      } else {
        lines.push(line);
      }
    }

    return lines.join('\n');
  }
}

// ============================================================================
// TOOL IMPLEMENTATIONS (from s02)
// ============================================================================

function safePath(pathStr: string): string {
  const resolved = resolve(WORKDIR, pathStr);
  const rel = relative(WORKDIR, resolved);
  if (rel.startsWith('..')) {
    throw new Error(`Path escapes workspace: ${pathStr}`);
  }
  return resolved;
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
    return result.trim() || '(no output)';
  } catch (error: any) {
    if (error.message.includes('timeout')) {
      return 'Error: Timeout (120s)';
    }
    return error.message || 'Error: Command failed';
  }
}

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

function runEdit(path: string, oldText: string, newText: string): string {
  try {
    const safe = safePath(path);
    let content = readFileSync(safe, 'utf-8');

    if (!content.includes(oldText)) {
      return `Error: Text not found in ${path}`;
    }

    content = content.replace(oldText, newText);
    writeFileSync(safe, content);

    return `Edited ${path}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// ============================================================================
// TOOL DEFINITIONS (s02 tools + todo_write)
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
        limit: { type: 'number' }
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
    name: 'todo_write',
    description: 'Update the session plan.',
    input_schema: {
      type: 'object',
      properties: {
        todos: {
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
      required: ['todos']
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
  todoManager: TodoManager;
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

function executeToolCalls(
  responseContent: any[],
  todoManager: TodoManager
): Array<{ type: string; tool_use_id: string; content: any }> {
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

      case 'todo_write':
        try {
          output = todoManager.update(input.todos);
          console.log('\x1b[36mPlan updated:\x1b[0m');
          console.log(output);
        } catch (error: any) {
          output = `Error: ${error.message}`;
          console.error(`\x1b[31m${output}\x1b[0m`);
        }
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
// AGENT LOOP (with plan reminder)
// ============================================================================

async function runOneTurn(state: LoopState): Promise<boolean> {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  // Add reminder if plan is stale
  const reminder = state.todoManager.reminder();
  const systemWithReminder = reminder
    ? `${SYSTEM}\n\n${reminder}`
    : SYSTEM;

  const response = await client.messages.create({
    model: MODEL,
    system: systemWithReminder,
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

  const results = executeToolCalls(response.content, state.todoManager);

  // Track if todo_write was used
  const todoUpdated = results.some((r: any) =>
    r.content && !r.content.startsWith('Error:') &&
    response.content.some((b: any) =>
      b.type === 'tool_use' && b.name === 'todo_write' && b.id === r.tool_use_id
    )
  );

  if (todoUpdated) {
    // Plan was updated, reset counter
  } else {
    state.todoManager.noteRoundWithoutUpdate();
  }

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
      rl.question('\x1b[36ms03 >> \x1b[0m', (answer) => {
        resolve(answer);
      });
    });
  };

  console.log(`\nZ-Agent Loop v0.0.1 - Chapter 3: TodoWrite`);
  console.log(`Model: ${MODEL}`);
  console.log(`Workspace: ${WORKDIR}`);
  console.log(`Tools: bash, read_file, write_file, edit_file, todo_write`);
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
      transitionReason: null,
      todoManager: new TodoManager()
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

if (process.argv[1] && process.argv[1].endsWith('s03-todo-write.ts')) {
  main().catch(console.error);
}

export { runOneTurn, agentLoop, type LoopState };
