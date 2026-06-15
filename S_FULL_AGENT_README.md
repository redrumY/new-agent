# s_full_agent.ts - Full Reference Agent

## Overview

This is the capstone implementation combining every mechanism from the Learn Claude Code tutorial sessions s01-s11. It's a comprehensive TypeScript adaptation of the original Python `s_full.py` reference agent.

## Features Implemented

### Core Systems (s01-s03)
- **Agent Loop (s01)**: Basic conversation loop with turn tracking
- **Tool Dispatch (s02)**: Pattern for executing tools and returning results
- **Todo Management (s03)**: Task tracking with validation and nag reminders

### Agent Capabilities (s04-s05)
- **Subagent System (s04)**: Spawn isolated agents for exploration and work
- **Skill Loading (s05)**: Dynamic skill loading from `skills/` directory

### Context Management (s06)
- **Micro-compact**: Clears old tool results (keeps last 3)
- **Auto-compact**: Triggers at 100k tokens with summarization
- **Manual compress**: User-triggered compression

### Task System (s07)
- Persistent file-based tasks in `.tasks/` directory
- Task creation, updates, listing, and dependency management
- Task claiming and status tracking

### Background Operations (s08)
- Background command execution with notifications
- Status checking and result retrieval
- Automatic notification draining before LLM calls

### Team & Messaging (s09)
- Message bus for inter-agent communication
- Inbox management
- Broadcast messaging

### Advanced Protocols (s10)
- Shutdown request/response protocol
- Plan approval workflow
- Request ID tracking

### Automation (s11)
- Auto-claiming of unblocked tasks
- Idle phase with polling
- Automatic work resumption

## Tool List

The agent includes 18 tools:

1. **bash** - Run shell commands
2. **read_file** - Read file contents (with optional limit)
3. **write_file** - Write content to files
4. **edit_file** - Replace exact text in files
5. **TodoWrite** - Update todo list
6. **task** - Spawn subagent for exploration/work
7. **load_skill** - Load specialized knowledge
8. **compress** - Manual context compression
9. **background_run** - Run commands in background
10. **check_background** - Check background task status
11. **task_create** - Create persistent tasks
12. **task_get** - Get task details
13. **task_update** - Update task status/dependencies
14. **task_list** - List all tasks
15. **send_message** - Send messages to teammates
16. **read_inbox** - Read lead's inbox
17. **broadcast** - Broadcast to all teammates
18. **idle** - Enter idle state
19. **claim_task** - Claim a task from the board

## REPL Commands

- `/compact` - Manually trigger context compression
- `/tasks` - List all persistent tasks
- `/inbox` - Show lead's inbox contents
- `q` or `exit` - Quit the agent

## Directory Structure

The agent creates/manages these directories:

```
.workdir/
├── .team/
│   ├── inbox/          # Message inboxes for each agent
│   └── config.json     # Team configuration
├── .tasks/             # Persistent task files (task_*.json)
├── .transcripts/       # Compressed conversation transcripts
└── skills/             # Skill definitions (SKILL.md files)
```

## Usage

Run the agent:

```bash
cd /path/to/typescript-claude-code-agent
npm run full-agent
```

Or directly:

```bash
tsx s-full-agent.ts
```

## Configuration

Requires environment variables (typically in `.env`):

- `ANTHROPIC_API_KEY` - Claude API key
- `ANTHROPIC_BASE_URL` - Optional: custom API base URL
- `MODEL_ID` - Model to use (defaults to claude-sonnet-4-20250514)

## Key Differences from Python Version

1. **Type Safety**: Full TypeScript type definitions for all data structures
2. **Async/Await**: All file operations and API calls use async patterns
3. **Error Handling**: Comprehensive try-catch blocks with proper error messages
4. **Node.js APIs**: Uses `fs/promises` for file operations instead of Python's `pathlib`
5. **Process Management**: Background tasks use Node.js `execSync` with proper timeout handling

## Architecture Notes

### Compression Pipeline
Before each LLM call:
1. Microcompact clears old tool results
2. Token count check triggers auto-compact if needed
3. Background notifications are drained
4. Inbox messages are injected

### Agent Loop
1. User message → LLM call → Tool execution → Results → Repeat
2. Stops when LLM responds without tool_use
3. Handles manual compress by restarting loop

### Todo Nagging
- Tracks rounds without TodoWrite
- Reminds every 3 rounds if open todos exist
- Reset when TodoWrite is used

## Implementation Details

### Safe Path Handling
All file operations use `safePath()` to ensure paths don't escape the workspace directory.

### Dangerous Command Blocking
Blocks commands containing: `rm -rf /`, `sudo`, `shutdown`, `reboot`, `> /dev/`

### Token Estimation
Uses simple character count / 4 approximation (matches typical tokenization).

### Skill Format
Skills are Markdown files with YAML frontmatter:
```markdown
---
name: skill-name
description: What this skill does
---

Skill content goes here...
```

## Future Enhancements

The TypeScript version provides a foundation for:
- Full teammate implementation (currently placeholder)
- Enhanced error recovery
- Performance monitoring
- Custom tool plugins
- Multi-model support

## Related Files

- Based on: the Learn Claude Code `s_full.py` reference agent
- Related session scripts: `s01-agent-loop.ts` through `s09-memory-system.ts`
