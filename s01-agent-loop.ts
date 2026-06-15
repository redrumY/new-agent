#!/usr/bin/env node
/**
 * s01_agent_loop.ts - The Agent Loop (Chapter 1)
 *
 * This is Chapter 1 of the Learn Claude Code tutorial, adapted to TypeScript.
 *
 * The Agent Loop - the smallest useful coding-agent pattern:
 *
 *   user message
 *     -> model reply
 *     -> if tool_use: execute tools
 *     -> write tool_result back to messages
 *     -> continue
 *
 * This chapter implements:
 * - Basic agent loop with turn tracking
 * - Single tool: bash (for shell commands)
 * - Safe command execution with dangerous command blocking
 * - Timeout protection (120s)
 *
 * Based on the Learn Claude Code s01 reference.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { execSync } from 'child_process';

// Load .env file
config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.ANTHROPIC_BASE_URL;
const MODEL = process.env.MODEL_ID || 'claude-sonnet-4-20250514';
const CWD = process.cwd();

const client = API_KEY ? new Anthropic({
  apiKey: API_KEY,
  baseURL: BASE_URL
}) : null;

const SYSTEM = `You are a coding agent at ${CWD}. Use bash to inspect and change the workspace. Act first, then report clearly.`;

/**
 * Tool Definitions
 *
 * Chapter 1: Only the bash tool
 * - Allows the agent to execute shell commands
 * - Dangerous commands are blocked for safety
 */
const TOOLS = [
  {
    name: 'bash',
    description: 'Run a shell command in the current workspace.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' }
      },
      required: ['command']
    }
  }
];

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/**
 * LoopState - tracks the agent loop state
 *
 * @param messages - Conversation history
 * @param turnCount - Current turn number (starts at 1)
 * @param transitionReason - Why the loop continued (null if stopped)
 */
interface LoopState {
  messages: Array<{ role: string; content: any }>;
  turnCount: number;
  transitionReason: string | null;
}

// ============================================================================
// TOOL IMPLEMENTATION
// ============================================================================

/**
 * runBash - Execute a bash command safely
 *
 * Safety measures:
 * - Blocks dangerous commands (rm -rf /, sudo, shutdown, reboot)
 * - 120 second timeout
 * - Captures both stdout and stderr
 *
 * @param command - The shell command to execute
 * @returns Command output or error message
 */
function runBash(command: string): string {
  // Dangerous commands to block
  const dangerous = ['rm -rf /', 'sudo', 'shutdown', 'reboot', '> /dev/'];
  if (dangerous.some(item => command.includes(item))) {
    return 'Error: Dangerous command blocked';
  }

  try {
    const output = execSync(command, {
      cwd: CWD,
      encoding: 'utf-8',
      timeout: 120000, // 120s
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim() || '(no output)';
  } catch (error: any) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const output = (err.stdout || '') + (err.stderr || '');
    if (error.message.includes('timeout')) {
      return 'Error: Timeout (120s)';
    }
    if (error.message.includes('not found')) {
      return 'Error: Command not found';
    }
    return output.trim() || error.message;
  }
}

/**
 * extractText - Extract text content from message blocks
 *
 * @param content - Message content array
 * @returns Joined text content
 */
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

/**
 * executeToolCalls - Execute tool calls from model response
 *
 * @param responseContent - The response content blocks
 * @returns Array of tool results
 */
function executeToolCalls(responseContent: any[]): Array<{ type: string; tool_use_id: string; content: any }> {
  const results: Array<{ type: string; tool_use_id: string; content: any }> = [];

  for (const block of responseContent) {
    if (block.type !== 'tool_use') continue;

    const toolName = block.name;
    const toolUseId = block.id;

    if (toolName === 'bash') {
      const command = block.input.command;
      console.log(`\x1b[33m$ ${command}\x1b[0m`);
      const output = runBash(command);
      console.log(output.substring(0, 200));
      if (output.length > 200) {
        console.log('...');
      }

      results.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: output
      });
    }
  }

  return results;
}

// ============================================================================
// AGENT LOOP
// ============================================================================

/**
 * runOneTurn - Execute one turn of the agent loop
 *
 * Process:
 * 1. Call Claude API with current messages
 * 2. Add assistant response to messages
 * 3. Check if model wants to use tools
 * 4. If yes: execute tools and add results
 * 5. Return true to continue, false to stop
 *
 * @param state - Current loop state
 * @returns true if loop should continue, false to stop
 */
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

  // Add assistant response to messages
  state.messages.push({
    role: 'assistant',
    content: response.content
  });

  // Check if model wants to use tools
  const stopReason = response.stop_reason;

  if (stopReason !== 'tool_use') {
    state.transitionReason = null;
    return false; // Stop the loop
  }

  // Execute tools
  const results = executeToolCalls(response.content);

  if (results.length === 0) {
    state.transitionReason = null;
    return false; // Stop the loop
  }

  // Add tool results to messages
  state.messages.push({
    role: 'user',
    content: results
  });

  state.turnCount += 1;
  state.transitionReason = 'tool_result';
  return true; // Continue the loop
}

/**
 * agentLoop - Keep running until no more tool calls
 *
 * This is the core agent loop:
 * - Call runOneTurn
 * - If it returns true, continue
 * - If it returns false, stop
 *
 * @param state - Initial loop state
 */
async function agentLoop(state: LoopState): Promise<void> {
  while (await runOneTurn(state)) {
    // Continue looping
    console.log(`\n--- Turn ${state.turnCount} ---\n`);
  }
}

// ============================================================================
// MAIN REPL
// ============================================================================

/**
 * main - Interactive REPL for testing the agent loop
 */
async function main() {
  if (!client) {
    console.error('\x1b[31mError: ANTHROPIC_API_KEY not set\x1b[0m');
    console.error('Create a .env file with: ANTHROPIC_API_KEY=your_key_here');
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const history: Array<{ role: string; content: any }> = [];

  const query = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('\x1b[36ms01 >> \x1b[0m', (answer) => {
        resolve(answer);
      });
    });
  };

  console.log(`\nZ-Agent Loop v0.0.1 - Chapter 1: Agent Loop`);
  console.log(`Model: ${MODEL}`);
  console.log(`Workspace: ${CWD}`);
  console.log(`Type 'exit' or 'q' to quit\n`);

  while (true) {
    const input = await query();

    if (input.toLowerCase().trim() === 'q' ||
        input.toLowerCase().trim() === 'exit' ||
        input.trim() === '') {
      break;
    }

    // Start new agent loop with this query
    history.push({ role: 'user', content: input });

    const state: LoopState = {
      messages: [...history],
      turnCount: 1,
      transitionReason: null
    };

    await agentLoop(state);

    // Update history with the final state
    history.length = 0;
    history.push(...state.messages);

    // Print final response
    const lastMessage = state.messages[state.messages.length - 1];
    const finalText = extractText(lastMessage.content);
    if (finalText) {
      console.log(`\n${finalText}\n`);
    }
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('s01-agent-loop.ts')) {
  main().catch(console.error);
}

// Export for testing
export { runOneTurn, agentLoop, type LoopState };
