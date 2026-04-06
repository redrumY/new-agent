# Z-Agent

Learn Agent Development with Plan/Build Architecture

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Configure your API key
echo "ANTHROPIC_API_KEY=sk-ant-xxxxx" > apps/web/.env

# Start development server
pnpm dev
```

Visit `http://localhost:3000` to see the app.

## 📁 Project Structure

```
z-agent/
├── apps/
│   └── web/                    # Next.js frontend
│       ├── app/                # Next.js App Router
│       │   ├── page.tsx        # Homepage
│       │   ├── chat/           # Chat interface
│       │   │   ├── page.tsx
│       │   │   └── api/chat/route.ts
│       ├── components/         # UI components
│       └── lib/                # Utilities
├── packages/
│   ├── agent-core/             # Core Agent Loop logic
│   ├── tools/                  # Tool definitions
│   └── shared/                 # Shared types
```

## 🎯 Learning Goals

This project is designed to help you learn:

1. **Agent Loop**: The fundamental Think → Act → Observe cycle
2. **Plan/Build Architecture**: Code scanning and task queue generation
3. **Tool Permissions**: Risk-based tool approval system
4. **MCP Integration**: Future support for Model Context Protocol

## 📚 Next Steps

- [ ] Day 1-2: Implement basic Agent Loop
- [ ] Day 3-6: Build mode with code scanning
- [ ] Day 7-9: Plan mode with task execution
- [ ] Day 10-11: Tool permission control
- [ ] Day 12-14: Testing and refinement

## 🔧 Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **AI**: Vercel AI SDK, Anthropic Claude
- **Language**: TypeScript
- **Package Manager**: pnpm (workspace)
