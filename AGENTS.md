# my-data-agent

基于 Bun + TypeScript + LangGraph + OpenAI SDK 的 ReAct Agent 框架。

## 构建与检查

```bash
bun install          # 安装依赖
bun run start        # 运行测试入口
bun run typecheck    # 类型检查
```

## 项目结构

```
src/
├── index.ts              # 测试/体验入口
└── agent/
    ├── index.ts           # 对外导出（createAgent + 全部类型）
    ├── createAgent.ts     # 核心工厂，组装 registry → graph → compile
    ├── graph.ts           # LangGraph StateGraph 拓扑（llmNode ⇄ toolNode）
    ├── state.ts           # Annotation.Root：messages, steps, iteration, loopActive
    ├── llmNode.ts         # ReAct 决策节点：调 OpenAI，产出 AIMessage
    ├── toolNode.ts        # 工具执行节点：执行工具，产出 ToolMessage + observation
    ├── shouldContinue.ts  # 路由判断：loopActive && iteration < maxIterations
    ├── registry.ts        # 工具注册表：Map<name, Tool> + zod → OpenAI tool defs
    └── types.ts           # Tool, AgentStep, CreateAgentConfig, AgentRuntime 等
```

## 关键规则

- **zod v3**：zod-to-json-schema 不兼容 zod v4
- **环境变量**：`OPENAI_MODEL`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`
- **Skill 按需加载**：Agent 模块的详细设计模式、用法、API 在 `.opencode/skills/agent-framework/SKILL.md`，需要时由 Agent 自动加载