# Z-Agent Week 1: 核心 Loop 与 Build 基础设计规范 (Spec)

## 1. 概述 (Overview)
本规范定义了 Z-Agent 在第一周（Week 1）的核心功能：一个具备“规划-审批-执行”能力的混合 Agent 循环系统，以及用于代码扫描的基础 Build 模式。

## 2. 核心架构 (Architecture)
采用“双阶段请求”模型：
1. **Phase 1: Build & Plan (规划阶段)**:
   - Agent 处于只读模式。
   - 目标：扫描代码，输出 `TaskQueue`。
   - 结果：通过 `StreamData` 推送 `AGENT_PLAN` 元数据并截断响应。
2. **Phase 2: Approved Execution (执行阶段)**:
   - 前端携带 `approvedTaskIds` 发起请求。
   - 目标：顺序执行已批准的任务。
   - 结果：调用 `writeFile` 等修改工具，流式返回执行进度。

## 3. 核心组件 (Components)

### 3.1 `packages/agent-core` (核心逻辑)
- **`loop.ts`**: 封装 `ToolLoopAgent`。
  - 实现 `onStepFinish` 拦截器：检测 `TaskQueue` 生成。
  - 实现 `stopWhen` 熔断：防止未授权的危险操作。
- **`build.ts`**: 定义 Build 模式的系统指令（System Instructions），限制其仅能扫描和规划。
- **`plan.ts`**: 定义任务调度逻辑，确保按顺序执行原子工具。

### 3.2 `packages/tools` (工具定义)
- **`file.ts`**: 提供 `readFile` (SAFE), `writeFile` (MODERATE) 工具。
- **`search.ts`**: 提供 `searchFiles` (SAFE) 工具，支持 Glob 模式。
- **`schemas.ts`**: 使用 Zod 定义所有工具的输入参数校验。

### 3.3 `packages/shared` (共享类型)
- 扩展 `types.ts` 以包含：
  - `AgentAction`: `GENERATE_PLAN` | `EXECUTE_PLAN`。
  - `MetadataEvent`: 后端向前端推送的自定义事件类型。

## 4. 接口协议 (Protocol)

### 4.1 数据流 (StreamData Events)
- `type: 'AGENT_PLAN'`: 包含 `tasks` 数组。
- `type: 'STEP_FINISH'`: 包含 `taskId` 和执行结果。

### 4.2 API 路由负载
- **请求**: `{ messages: Message[], data: { action: string, approvedTaskIds?: string[] } }`。

## 5. 验收标准 (Success Criteria)
1. Agent 能够准确识别项目中的 React 组件（通过 `searchFiles`）。
2. Agent 在生成修改计划后，必须停下来显示审批 UI，不得自动修改文件。
3. 用户点击“确认”后，Agent 能够执行 `writeFile` 并反馈成功。
