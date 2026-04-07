# Z-Agent Week 1: 核心 Loop 与 Build 基础实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Z-Agent 的核心循环框架、只读 Build 模式以及基础文件操作工具。

**Architecture:** 双阶段模式（只读规划 -> 授权执行）。后端基于 ToolLoopAgent，前端解析元数据。

---

### Task 1: 基础工具集实现 (packages/tools)

**Files:**
- Create: `packages/tools/src/schemas.ts`
- Create: `packages/tools/src/file.ts`
- Create: `packages/tools/src/search.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: 定义工具输入 Schema**
  使用 Zod 定义 `readFile`, `writeFile`, `searchFiles` 的入参校验。
- [ ] **Step 2: 实现文件操作工具**
  实现 `readFile` 和 `writeFile`。
- [ ] **Step 3: 实现代码搜索工具**
  实现基于 `glob` 的文件查找。
- [ ] **Step 4: 导出工具定义**
  确保每个工具包含 `riskLevel` 和 `requireApproval` 属性。

### Task 2: 核心 Loop 控制器 (packages/agent-core)

**Files:**
- Modify: `packages/agent-core/src/loop.ts`
- Modify: `packages/agent-core/src/index.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: 扩展共享类型**
  添加 `AgentAction` 和任务确认所需的事件类型。
- [ ] **Step 2: 实现 Loop 拦截器逻辑**
  在 `loop.ts` 中实例化 `ToolLoopAgent`，并在 `onStepFinish` 中检测 `TaskQueue` 生成。
- [ ] **Step 3: 实现“全量预审”中断逻辑**
  配置 `stopWhen` 条件，当检测到需要授权的任务时，挂起循环。

### Task 3: Build & Plan 模式接入 (packages/agent-core)

**Files:**
- Create: `packages/agent-core/src/build.ts`
- Create: `packages/agent-core/src/plan.ts`

- [ ] **Step 1: 编写 Build 模式系统指令**
  引导 LLM 专注于扫描并输出 `TaskQueue`。
- [ ] **Step 2: 实现计划调度逻辑**
  在 `plan.ts` 中实现如何将生成的 `TaskQueue` 映射到具体的工具执行。

### Task 4: API 路由与前端 UI 对接 (apps/web)

**Files:**
- Modify: `apps/web/app/chat/api/chat/route.ts`
- Modify: `apps/web/app/chat/page.tsx`

- [ ] **Step 1: 升级 API 路由**
  根据 `data.action` 调用 `Build` 或 `Plan` 阶段。
- [ ] **Step 2: 实现任务确认界面 (Mock)**
  解析 `StreamData` 元数据并在前端渲染待执行任务清单。
- [ ] **Step 3: 实现“批准执行”提交**
  确保点击“确认”后发起带有 `approvedTaskIds` 的二次请求。
