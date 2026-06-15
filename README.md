# Z-Agent - Learn Claude Code (TypeScript Version)

基于 Python 项目 [learn-claude-code](https://github.com/anthropics/learn-claude-code) 的 TypeScript 移植版本。

## 📚 章节结构

```
.
├── s01-agent-loop.ts      ← 第1章：Agent Loop 基础
├── s02-tool-use.ts        ← 第2章：添加文件操作工具
├── s03-todo-write.ts      ← 第3章：添加 TodoWrite 规划
├── s04-subagent.ts        ← 第4章：添加子代理（上下文隔离）
├── s05-skill-loading.ts   ← 第5章：技能加载（按需知识）
├── s06-context-compact.ts ← 第6章：上下文压缩
├── s07-permission-system.ts ← 第7章：权限系统
├── s08-hook-system.ts     ← 第8章：Hook 系统
├── s09-memory-system.ts   ← 第9章：记忆系统
└── s-full-agent.ts        ← 完整参考 Agent
```

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

创建 `.env` 文件：

```env
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
MODEL_ID=claude-sonnet-4-20250514
```

### 3. 运行章节

```bash
# 第1章：Agent Loop 基础（只有 bash 工具）
pnpm s01

# 第2章：添加文件操作工具
pnpm s02

# 第3章：添加 TodoWrite 规划
pnpm s03

# 第4章：添加子代理（上下文隔离）
pnpm s04

# 第5章：技能加载（按需知识）
pnpm s05

# 第6章：上下文压缩
pnpm s06

# 第7章：权限系统
pnpm s07

# 第8章：Hook 系统
pnpm s08

# 第9章：记忆系统
pnpm s09
```

## 📖 章节内容

### S01: Agent Loop（第1章）

**核心概念**：最简单的 Agent Loop 模式

```
用户消息
  ↓
Claude 响应
  ↓
需要工具？→ 执行工具 → 结果传回 Claude → 继续
  ↓ 否
结束
```

**功能**：
- ✅ Agent Loop 核心循环
- ✅ bash 工具（执行 shell 命令）
- ✅ 危险命令拦截
- ✅ 超时保护（120秒）

**测试**：
```
s01 >> 列出当前目录的文件
s01 >> 这个项目是做什么的？
s01 >> exit
```

---

### S02: Tool Use（第2章）

**核心概念**：工具分发系统

关键洞察：*"循环没有改变，我只是添加了工具。"*

**新增工具**：
- `read_file(path, limit?)` - 读取文件
- `write_file(path, content)` - 写入文件
- `edit_file(path, old_text, new_text)` - 编辑文件
- `search_web(query, limit?)` - **联网搜索**（新增）

**安全改进**：
- 路径验证（防止路径穿越攻击）
- 并发安全分类

**测试**：
```
s02 >> 读取 README.md 的内容
s02 >> 创建一个新文件 test.txt，内容为 "Hello World"
s02 >> 读取 test.txt
s02 >> 搜索 "TypeScript agent tutorial"
s02 >> exit
```

---

### S03: TodoWrite（第3章）

**核心概念**：会话规划系统

关键洞察：*"把当前计划保存在模型外部。"*

**新功能**：
- `todo_write` 工具（管理会话计划）
- PlanItem 数据结构
- TodoManager 类
- 自动计划提醒

**规划规则**：
- 最多 12 个项目
- 只能有一个项目处于 `in_progress` 状态
- 3 轮未更新后自动提醒

**测试**：
```
s03 >> 我需要完成一个多步骤任务：1. 读取文件 2. 修改文件 3. 保存文件
s03 >> 使用 todo_write 工具创建计划
s03 >> exit
```

---

### S04: Subagent（第4章）

**核心概念**：上下文隔离

关键洞察：*"Fresh messages=[] gives context isolation. The parent stays clean."*

**新功能**：
- `task` 工具（派生子代理）
- runSubagent 函数（独立上下文执行）
- 工具过滤（父代理有 task，子代理没有）
- 只返回摘要（子代理详细上下文被丢弃）

**架构**：
```
Parent agent                     Subagent
+------------------+             +------------------+
| messages=[...]   |             | messages=[]      |  <-- fresh
|                  |  dispatch   |                  |
| tool: task       | ---------->| while tool_use:  |
|   prompt="..."   |            |   call tools     |
|   description="" |            |   append results |
|                  |  summary   |                  |
|   result = "..." | <--------- | return last text |
+------------------+             +------------------+
```

**测试**：
```
s04 >> 使用 task 工具探索当前目录结构
s04 >> 用 task 工具创建一个测试文件并写入内容
s04 >> exit
```

---

### S05: Skill Loading（第5章）

**核心概念**：按需知识加载

关键洞察：*"保持提示词小巧，同时给予模型可重用的任务特定指导。"*

**新功能**：
- `load_skill` 工具（按名称加载完整技能内容）
- SkillRegistry 类（管理技能发现和加载）
- SkillManifest 和 SkillDocument 数据结构
- 两层技能模型（目录 + 完整内容）

**架构**：
```
Two-Layer Skill Model:
┌─────────────────────────────────────────┐
│ Layer 1: Cheap Catalog (in system prompt) │
│ - example-skill: Description here...      │
└─────────────────────────────────────────┘
                    ↓ Model requests skill
┌─────────────────────────────────────────┐
│ Layer 2: Full Skill Body (on demand)      │
│ <skill name="example-skill">              │
│ ## Detailed instructions...               │
│ ...                                       │
│ </skill>                                  │
└─────────────────────────────────────────┘
```

**技能文件结构**：
```
skills/
└── example-skill/
    └── SKILL.md
        ---
        name: example-skill
        description: Skill description
        ---
        ## Skill body starts here
        ...
```

**测试**：
```
s05 >> 有哪些可用的技能？
s05 >> 加载 example-skill 技能
s05 >> 使用这个技能的指导来完成某个任务
s05 >> exit
```

---

### S06: Context Compact（第6章）

**核心概念**：上下文压缩

关键洞察：*"当对话太长时，压缩上下文以便代理可以继续工作。"*

**新功能**：
- `compact` 工具（手动触发上下文压缩）
- 自动压缩（当上下文超过限制时）
- 大型工具输出持久化（超过 30000 字符）
- 微型压缩（旧工具结果压缩为占位符）
- 历史摘要（保留重要信息：目标、决策、文件、剩余工作）

**压缩层级**：
1. **大型输出持久化**：超过 `PERSIST_THRESHOLD` (30000) 字符的工具输出会被保存到磁盘（`.task_outputs/tool-results/`）
2. **微型压缩**：只保留最近的 `KEEP_RECENT_TOOL_RESULTS` (3) 个工具结果，其他的被替换为占位符
3. **完整压缩**：整个对话被摘要，代理从摘要继续（`.transcripts/transcript_<timestamp>.jsonl`）

**架构**：
```
Context Size Estimation → Micro-compact → Auto-compact → Manual-compact
         ↓                      ↓               ↓               ↓
    > 50000 chars         Keep last 3      Summarize      Focus on topic
```

**常量配置**：
- `CONTEXT_LIMIT = 50000` - 触发自动压缩的上下文大小
- `KEEP_RECENT_TOOL_RESULTS = 3` - 保留最近的工具结果数量
- `PERSIST_THRESHOLD = 30000` - 工具输出持久化阈值
- `PREVIEW_CHARS = 2000` - 持久化输出的预览字符数

**测试**：
```
s06 >> 列出当前目录的所有文件
s06 >> 读取 package.json 的内容
s06 >> 读取 README.md 的内容
s06 >> 使用 compact 工具压缩对话
s06 >> exit
```

---

### S07: Permission System（第7章）

**核心概念**：权限系统

关键洞察：*"安全是一个管道，而不是布尔值。"*

**新功能**：
- `PermissionManager` 类（权限决策管道）
- 权限模式（default, plan, auto）
- Bash 安全验证（危险模式检测）
- 权限规则（allow, deny, ask）
- 工作区信任标记
- 用户交互式批准

**权限管道**：
```
Tool Call → Bash Security → Deny Rules → Mode Check → Allow Rules → Ask User
              Validation
```

**模式说明**：
- `default`：默认行为，根据规则决策
- `plan`：只读模式，阻止所有写操作
- `auto`：自动允许只读工具，询问写操作

**命令**：
- `/mode <mode>` - 切换权限模式
- `/rules` - 显示当前权限规则

**测试**：
```
s07 >> 选择 default 模式
s07 >> 尝试读取文件
s07 >> 尝试写入文件（会被询问）
s07 >> 使用 /mode plan 切换到只读模式
s07 >> 尝试写入文件（会被拒绝）
s07 >> exit
```

---

### S08: Hook System（第8章）

**核心概念**：Hook 系统

关键洞察：*"在不接触循环的情况下扩展代理。"*

**新功能**：
- `HookManager` 类（加载和执行 hooks）
- Hook 事件（SessionStart, PreToolUse, PostToolUse）
- Hook 配置（.hooks.json）
- 工作区信任门禁
- Hook 退出码约定（0=继续, 1=阻止, 2=注入消息）

**Hook 集成点**：
```
SessionStart → Agent Loop
                    ↓
               PreToolUse → Execute Tool → PostToolUse
                    ↓                           ↓
               Block/Inject              Inject messages
```

**Hook 配置示例**：
```json
{
  "hooks": {
    "SessionStart": [
      {
        "command": "echo 'Session started'"
      }
    ],
    "PreToolUse": [
      {
        "matcher": "bash",
        "command": "echo 'About to run bash command'"
      }
    ]
  }
}
```

**测试**：
```
# 创建 .hooks.json 配置文件
# 创建 .claude/.claude_trusted 信任标记
s08 >> 列出当前目录的文件
s08 >> 读取 package.json
s08 >> exit
```

---

### S09: Memory System（第9章）

**核心概念**：记忆系统

关键洞察：*"记忆只存储跨会话信息，这些信息仍然值得回忆，并且不容易从当前代码库重新推导。"*

**新功能**：
- `MemoryManager` 类（跨会话持久化记忆）
- `save_memory` 工具（保存记忆到磁盘）
- 记忆类型（user, feedback, project, reference）
- `DreamConsolidator` 类（可选的记忆整合）
- MEMORY.md 索引文件

**何时使用记忆**：
- **user**：用户偏好（"我喜欢使用 tabs"）
- **feedback**：用户纠正（"不要这样做"）
- **project**：非显而易见的项目约定
- **reference**：外部资源指针（文档链接、仪表板）

**何时不使用记忆**：
- 容易从代码推导的信息
- 临时任务状态
- 秘密或凭证

**存储布局**：
```
.memory/
├── MEMORY.md           # 索引文件（200行限制）
├── prefer_tabs.md      # 用户偏好
├── review_style.md     # 项目约定
└── incident_board.md   # 外部资源
```

**命令**：
- `/memories` - 列出当前保存的记忆

**测试**：
```
s09 >> 使用 save_memory 保存用户偏好
s09 >> 使用 save_memory 保存项目约定
s09 >> 使用 /memories 查看保存的记忆
s09 >> 退出后重新运行，验证记忆已加载
s09 >> exit
```

---

## 🔄 与 Python 版本的对比

| 特性 | Python 版本 | TypeScript 版本 | 状态 |
|------|------------|-----------------|------|
| 第1章：Agent Loop | ✅ | ✅ | 完成 |
| 第2章：Tool Use | ✅ | ✅ | 完成 |
| 第3章：TodoWrite | ✅ | ✅ | 完成 |
| 第4章：Subagent | ✅ | ✅ | 完成 |
| 第5章：Skill Loading | ✅ | ✅ | 完成 |
| 第6章：Context Compact | ✅ | ✅ | 完成 |

---

## 🛠️ 开发

### 运行测试

```bash
# 测试单个章节
pnpm s01
pnpm s02
pnpm s03
pnpm s04
pnpm s05

# 或使用 tsx 直接运行
tsx s01-agent-loop.ts
tsx s05-skill-loading.ts

# 运行上下文压缩测试
tsx s06-context-compact.ts

# 运行权限系统测试
tsx s07-permission-system.ts

# 运行 Hook 系统测试
tsx s08-hook-system.ts

# 运行记忆系统测试
tsx s09-memory-system.ts
```

### TDD 模式

本项目严格遵循 TDD 原则：

1. **RED** - 先写失败的测试
2. **GREEN** - 编写代码让测试通过
3. **REFACTOR** - 重构改进

每个章节都是：
- ✅ 可独立运行
- ✅ 可独立测试
- ✅ 与前一个章节对比清晰

---

## 📂 项目结构

```
typescript-claude-code-agent/
├── s01-agent-loop.ts          # 第1章
├── s02-tool-use.ts            # 第2章
├── s03-todo-write.ts          # 第3章
├── s04-subagent.ts            # 第4章
├── s05-skill-loading.ts       # 第5章
├── s06-context-compact.ts     # 第6章
├── s07-permission-system.ts   # 第7章
├── s08-hook-system.ts         # 第8章
├── s09-memory-system.ts       # 第9章
├── s-full-agent.ts            # 完整参考 Agent
├── skills/                    # 可被 load_skill 加载的技能目录
├── .env.example               # 环境变量示例
├── package.json               # 项目配置
└── README.md                  # 项目说明
```

---

## 🎯 下一步

- [x] 第4章：Subagent（子代理）
- [x] 第5章：Skill Loading（技能加载）
- [x] 第6章：Context Compact（上下文压缩）
- [x] 第7章：Permission System（权限系统）
- [x] 第8章：Hook System（Hook 系统）
- [x] 第9章：Memory System（记忆系统）

---

## 📝 参考资料

- [Python 原版项目](https://github.com/anthropics/learn-claude-code)
- [Anthropic API 文档](https://docs.anthropic.com/)
- [Claude Code](https://claude.ai/code)

---

## 📄 License

MIT
