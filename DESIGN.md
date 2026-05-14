# my-data-agent 设计文档

> 基于 **Bun + TypeScript** 运行时，使用 **LangGraph** 作为图编排引擎，**OpenAI SDK** 作为 LLM 调用库，遵循 **ReAct** 模式构建的通用 Agent 基础框架。

---

## 目录

1. [概述](#1-概述)
2. [技术选型与依赖](#2-技术选型与依赖)
3. [项目结构](#3-项目结构)
4. [架构设计](#4-架构设计)
5. [逐层设计详解](#5-逐层设计详解)
   - [5.1 公共类型定义](#51-公共类型定义-srctypesindexts)
   - [5.2 工具注册表](#52-工具注册表-srctoolsregistryts)
   - [5.3 LangGraph 状态定义](#53-langgraph-状态定义-srcagentstatets)
   - [5.4 节点：LLM 决策节点](#54-节点llm-决策节点-srcnodesllmnodets)
   - [5.5 节点：工具执行节点](#55-节点工具执行节点-srcnodestoolnodets)
   - [5.6 节点：路由判断](#56-节点路由判断-srcnodesshouldcontinuets)
   - [5.7 图组装](#57-图组装-srcagentgraphts)
   - [5.8 工厂函数 createAgent](#58-工厂函数-createagent-srcagentcreateagentts)
   - [5.9 对外导出](#59-对外导出-srcagentindexts)
   - [5.10 测试入口](#510-测试入口-srcindexts)
6. [配置文件](#6-配置文件)
7. [数据流总览](#7-数据流总览)
8. [使用示例](#8-使用示例)
9. [启动与运行](#9-启动与运行)

---

## 1. 概述

本项目的核心目标是提供一个 **`createAgent` 工厂函数**，用户可以：

- 自定义 **工具列表**（使用 Zod schema 定义参数）
- 自定义 **系统提示词**
- 控制 **最大迭代次数**、**温度**等参数
- 通过 **回调函数** 观察 Agent 每一步的决策过程

Agent 内部遵循 **ReAct**（Reasoning + Acting）模式：LLM 在循环中交替进行**思考决策**和**工具调用**，直到产出最终答案或达到最大迭代次数。

整体数据流：

```
用户输入 → LangGraph 状态图 → ReAct 循环 → 最终答案
                │
                ├── llmNode（LLM 决策：思考 + 决定调用哪个工具）
                ├── shouldContinue（路由：是否继续循环？）
                └── toolNode（执行工具：获取实际数据）
```

---

## 2. 技术选型与依赖

| 技术 | 用途 | 理由 |
|------|------|------|
| **Bun** | 运行时 + 包管理 | 原生支持 TypeScript，启动快，零配置 |
| **TypeScript** | 类型安全 | 强类型推导，配合 Zod 实现端到端类型安全 |
| **@langchain/langgraph** | 图编排引擎 | 提供 `StateGraph` 和 `Annotation`，管理 Agent 状态流转和节点执行 |
| **openai** (v6) | LLM 调用 | 原生 OpenAI SDK，直接调用 chat completions API |
| **zod** (v3) | Schema 校验 | 定义工具参数的 schema，编译期推导输入类型 |
| **zod-to-json-schema** | Schema 转换 | 将 Zod schema 转换为 OpenAI function calling 要求的 JSON Schema |

### 为什么不用 LangChain 的 Tool 抽象？

LangChain 内置了 `DynamicStructuredTool` 和 `ToolNode`，但使用这些对框架内部行为不够透明（例如 tool_calls 的格式转换不可见、step 记录不方便）。我们**手动实现** toolNode 和 LLM 调用的每一步，获得完全的观察力和控制力。

### 为什么手动处理消息转换而非用 `MessagesAnnotation` 内置方案？

LangGraph 的 `MessagesAnnotation` 是预设好的 Annotation 模板，但我们需要自定义字段（`steps`、`iteration`、`loopActive`），因此采用 `Annotation.Root` 手动定义所有字段，仅对 `messages` 字段复用 LangGraph 的 `messagesStateReducer`。

### `messagesStateReducer` 的作用

LangGraph 图中有多个节点，每个节点都可能返回部分 state 更新。对于 `messages` 字段：
- 旧 state 中已累积了若干条消息（例如 `[HumanMsg, AIMsg, ToolMsg]`）
- 当前节点产出了新的消息（例如 `[new AIMsg]`）
- `messagesStateReducer` 自动把新消息**追加**到消息列表末尾，并根据 `id` 去重

这避免了每个节点手动做 `{ messages: [...oldMessages, ...newMessages] }` 的冗余代码。

### 为什么用 `RunnableConfig.configurable` 传参而非 State？

`systemPrompt`、`maxIterations`、`temperature`、`onStep`、`registry` 这些参数在 Agent 生命周期中是不变的配置，不是运行时的可变状态。将它们放在 `configurable` 中：
- **不污染 State**，State 只保留真正需要跨节点流转的动态数据
- **每个节点都能通过 `config` 参数访问**，无需在 state 中传递
- **语义清晰**：哪些是配置，哪些是状态

---

## 3. 项目结构

```
my-data-agent/
├── src/
│   ├── index.ts                  # 测试/体验入口（含示例：天气查询）
│   ├── agent/
│   │   ├── index.ts              # 对外导出：createAgent + 全部类型
│   │   ├── createAgent.ts        # 核心工厂函数：组装 registry → graph → compile
│   │   ├── graph.ts              # LangGraph StateGraph 拓扑定义
│   │   └── state.ts              # Agent 状态定义 (Annotation.Root)
│   ├── nodes/
│   │   ├── llmNode.ts            # ReAct 决策节点：调 LLM，产出 AIMessage + steps
│   │   ├── toolNode.ts           # 工具执行节点：执行工具，产出 ToolMessage + observation
│   │   └── shouldContinue.ts     # 路由判断：控制 ReAct 循环
│   ├── tools/
│   │   └── registry.ts           # 工具注册表：name → Tool 映射 + OpenAI tool defs 生成
│   └── types/
│       └── index.ts              # 公共类型：Tool, AgentStep, CreateAgentConfig 等
├── .env                          # 环境变量（不提交到 git）
├── .env.example                  # 环境变量模板
├── package.json
├── tsconfig.json
└── .gitignore
```

模块依赖关系（简化为向下依赖）：

```
src/index.ts
  └── src/agent/index.ts
        └── src/agent/createAgent.ts
              ├── src/agent/graph.ts
              │     ├── src/agent/state.ts
              │     ├── src/nodes/llmNode.ts     → src/tools/registry.ts
              │     ├── src/nodes/toolNode.ts    → src/tools/registry.ts
              │     └── src/nodes/shouldContinue.ts
              └── src/tools/registry.ts
                    └── src/types/index.ts (类型依赖)
```

---

## 4. 架构设计

### ReAct 循环

```
                  START
                    │
                    ▼
              ┌──────────┐
         ┌───▶│  llmNode │  LLM 接收历史消息，输出:
         │    │          │  · AI 文本 (最终答案) → 循环结束
         │    └────┬─────┘  · tool_calls (调用工具) → 继续循环
         │         │
         │    ┌────▼──────┐
         │    │shouldCont │  判断:
         │    │  inue     │  · loopActive=false → END
         │    └────┬──────┘  · iteration≥max → END
         │         │         · 否则 → toolNode
         │    ┌────▼──────┐
         │    │  toolNode │  执行工具，产出 ToolMessage
         │    │           │  记录 observation 到 steps
         │    └────┬──────┘
         │         │
         └─────────┘
                    │
              loopActive=false
                    ▼
                   END
```

### State 字段设计

| 字段 | 类型 | Reducer | 用途 |
|------|------|---------|------|
| `messages` | `BaseMessage[]` | `messagesStateReducer`（追加+去重） | 完整对话历史 |
| `steps` | `AgentStep[]` | replace（替换） | Agent 每一步的 thought/action/observation 记录 |
| `iteration` | `number` | replace（替换） | 当前迭代次数 |
| `loopActive` | `boolean` | replace（替换） | 控制是否继续 ReAct 循环 |

### 配置注入方式

采用 **`RunnableConfig.configurable`** 向所有节点注入配置（而非存入 state）：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `systemPrompt` | `string` | 系统提示词，每次 llmNode 调用时放在 messages 最前面 |
| `maxIterations` | `number` | 最大 ReAct 循环次数，默认 10 |
| `temperature` | `number` | LLM 温度，默认 0 |
| `onStep` | `(step: AgentStep) => void` | 每步回调，可观察中间过程 |
| `registry` | `ToolRegistry` | 工具注册表实例 |

---

## 5. 逐层设计详解

### 5.1 公共类型定义 (`src/types/index.ts`)

**设计思路：**

`Tool` 接口是整个框架中用户最直接的接触面。核心设计选择是 **泛型 Tool 接口**：

- 使用 `z.infer<TSchema>` 自动从 Zod schema 推导 `execute` 的参数类型
- 用户无需手动写类型断言，编译期即可获得完整类型安全
- 运行时，LLM 返回的 JSON arguments 被 `JSON.parse` 后自然匹配执行函数的参数

`AgentStep` 记录 ReAct 每一步的完整信息：
- `thought`：LLM 的文本思考
- `action`：LLM 决定调用的工具及参数（可选，最终回答时无 action）
- `observation`：工具执行的结果（由 toolNode 回填）

```typescript
import type { z } from "zod";

export interface Tool<TSchema extends z.ZodSchema = z.ZodSchema> {
  name: string;
  description: string;
  schema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<string>;
}

export interface AgentStep {
  iteration: number;
  thought: string;
  action?: {
    tool: string;
    input: Record<string, unknown>;
  };
  observation?: string;
}

export interface CreateAgentConfig {
  tools: Tool[];
  systemPrompt: string;
  maxIterations?: number;
  temperature?: number;
  onStep?: (step: AgentStep) => void;
}

export interface AgentResult {
  finalAnswer: string;
  steps: AgentStep[];
}

export interface AgentRuntime {
  invoke: (userMessage: string) => Promise<AgentResult>;
}
```

> **注意**：`model`、`apiKey`、`baseURL` 不在配置中，统一从环境变量 `MODEL_NAME`、`MODEL_API_KEY`、`MODEL_API_URL` 读取。

---

### 5.2 工具注册表 (`src/tools/registry.ts`)

**设计思路：**

`ToolRegistry` 是工具与其名称之间的桥接层。它承担三个职责：

1. **注册**：将 `Tool` 实例存入 `Map<string, Tool>`
2. **查找**：按名称获取工具实现，供 toolNode 使用
3. **生成 OpenAI tool definitions**：将 Zod schema 转换为 OpenAI function calling 需要的 `{ type: "function", function: { name, description, parameters } }` 格式

`zod-to-json-schema` 库在这里发挥关键作用——它将 Zod 的 schema 声明转换为 JSON Schema 标准格式，OpenAI API 直接接受这个格式作为 function 的 `parameters`。

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "../types";

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getToolDefs(): object[] {
    return [...this.tools.values()].map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema),
      },
    }));
  }
}
```

---

### 5.3 LangGraph 状态定义 (`src/agent/state.ts`)

**设计思路：**

采用 `Annotation.Root` 手动定义状态结构（方案 B），而非使用 LangGraph 的 `MessagesAnnotation`（方案 A）。

原因：我们需要 `steps`、`iteration`、`loopActive` 等自定义字段，`MessagesAnnotation` 不提供这些扩展点。`Annotation.Root` 让我们完全控制每个字段的 reducer 行为。

**Reducer 策略：**
- `messages` → `messagesStateReducer`：LangGraph 内置，自动追加新消息并根据 id 去重
- `steps`、`iteration`、`loopActive` → 直接替换（`(_, next) => next`）：每个节点返回最新值覆盖旧值

```typescript
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { AgentStep } from "../types";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  steps: Annotation<AgentStep[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  iteration: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),

  loopActive: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
});
```

---

### 5.4 节点：LLM 决策节点 (`src/nodes/llmNode.ts`)

**设计思路：**

llmNode 是整个 ReAct 心脏，每次被调用时执行以下流程：

1. **构建消息列表**：SystemMessage（来自 configurable） + state.messages（对话历史）
2. **LangChain → OpenAI 消息格式转换**：LangChain 内部使用 `BaseMessage` 体系（HumanMessage / AIMessage / ToolMessage），OpenAI API 期望 `{ role, content }` 格式。手动实现转换器处理四种消息类型，特别注意 AIMessage 中的 `tool_calls` 需要从 LangChain 格式（`{ id, name, args }`）转为 OpenAI 格式（`{ id, type: "function", function: { name, arguments } }`）
3. **调用 OpenAI**：传入 tool definitions（从 registry 生成）、temperature 等参数
4. **解析响应**：
   - 检查 `message.tool_calls`：若有，标记 `loopActive = true`（LLM 想调用工具）
   - 若无，标记 `loopActive = false`（LLM 给出了最终答案）
5. **构建 AgentStep**：记录 thought 和 action（若有）
6. **触发回调**：如果配置了 `onStep`，在此处调用
7. **返回 State 更新**：`{ messages: [AIMessage], steps, iteration, loopActive }`

**关键细节：**
- SystemMessage **不持久化到 state.messages**，只在 llmNode 内部临时拼接——节省 token，避免污染消息历史
- OpenAI v6 的 `tool_calls` 是联合类型（`ChatCompletionNamedToolChoiceMessageToolCall | ChatCompletionMessageCustomToolCall`），需要运行时用 `"function" in tc` 做类型窄化
- AIMessage 构造时需要将 OpenAI 格式的 tool_calls 转回 LangChain 格式

```typescript
import OpenAI from "openai";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { AgentStep } from "../types";
import type { ToolRegistry } from "../tools/registry";

const openai = new OpenAI({
  apiKey: process.env["MODEL_API_KEY"],
  baseURL: process.env["MODEL_API_URL"],
});

const MODEL = process.env["MODEL_NAME"] || "gpt-4o-mini";

function getContentText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

export async function llmNode(
  state: any,
  config?: RunnableConfig,
) {
  const systemPrompt = config?.configurable?.systemPrompt as string;
  const temperature = (config?.configurable?.temperature as number) ?? 0;
  const onStep = config?.configurable?.onStep as
    | ((step: AgentStep) => void)
    | undefined;
  const registry = config?.configurable?.registry as ToolRegistry;

  const toolDefs = registry.getToolDefs();

  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of state.messages) {
    const type = msg.getType();
    const content = getContentText(msg.content);

    switch (type) {
      case "human":
        openaiMessages.push({ role: "user", content });
        break;
      case "ai": {
        const entry: any = { role: "assistant", content };
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          entry.tool_calls = msg.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          }));
        }
        openaiMessages.push(entry);
        break;
      }
      case "tool":
        openaiMessages.push({
          role: "tool",
          content,
          tool_call_id: msg.tool_call_id,
        });
        break;
    }
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: openaiMessages,
    tools: toolDefs.length > 0 ? (toolDefs as any) : undefined,
    temperature,
  });

  const choice = response.choices[0];
  if (!choice) {
    throw new Error("No response from LLM");
  }

  const message = choice.message;
  const iteration = state.iteration + 1;

  const step: AgentStep = {
    iteration,
    thought: message.content || "",
  };

  if (message.tool_calls && message.tool_calls.length > 0) {
    const tc = message.tool_calls[0]!;
    const func = "function" in tc ? tc.function : undefined;
    if (func) {
      step.action = {
        tool: func.name,
        input: JSON.parse(func.arguments),
      };
    }
  }

  const aiMessage = new AIMessage({
    content: message.content || "",
    tool_calls:
      message.tool_calls?.flatMap((tc) => {
        if (!("function" in tc)) return [];
        return [
          {
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        ];
      }) ?? [],
  });

  const loopActive = !!(message.tool_calls && message.tool_calls.length > 0);

  const newSteps = [...state.steps, step];

  if (onStep) {
    onStep(step);
  }

  return {
    messages: [aiMessage],
    steps: newSteps,
    iteration,
    loopActive,
  };
}
```

---

### 5.5 节点：工具执行节点 (`src/nodes/toolNode.ts`)

**设计思路：**

toolNode 负责"执行"LLM 决定调用的工具。流程：

1. **获取最后一条 AIMessage**：从 state.messages 取出 llmNode 刚刚产出的消息
2. **解析 tool_calls**：提取每个 tool_call 的 name 和 args
3. **查找工具**：从 ToolRegistry 按名称查找工具实现
4. **执行工具**：调用 `tool.execute(args)`，捕获结果或错误
5. **构建 ToolMessage**：将执行结果包装为 LangChain 的 ToolMessage，关联到对应的 `tool_call_id`
6. **回填 observation**：将结果写入最后一个 AgentStep 的 `observation` 字段

**关键细节：**
- toolNode **不修改 `loopActive`**——它执行完工具后，loopActive 仍为 true。下一次 llmNode 被调用时，LLM 会看到这些 ToolMessage，然后决定是继续调工具还是给最终答案
- `tool_call_id` 关联 ToolMessage 和 AIMessage 的 tool_call，确保 LLM 知道每条结果是哪个工具调用产生的

```typescript
import { ToolMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ToolRegistry } from "../tools/registry";

export async function toolNode(
  state: any,
  config?: RunnableConfig,
) {
  const registry = config?.configurable?.registry as ToolRegistry;

  const messages = state.messages as AIMessage[];
  const lastMessage = messages[messages.length - 1] as AIMessage | undefined;

  if (!lastMessage || !Array.isArray(lastMessage.tool_calls) || lastMessage.tool_calls.length === 0) {
    return { messages: [] };
  }

  const toolMessages: ToolMessage[] = [];
  let observation = "";

  for (const toolCall of lastMessage.tool_calls) {
    const tool = registry.get(toolCall.name);
    if (!tool) {
      toolMessages.push(
        new ToolMessage({
          content: `Error: Tool "${toolCall.name}" not found`,
          tool_call_id: toolCall.id ?? "",
        }),
      );
      continue;
    }

    try {
      const result = await tool.execute(toolCall.args);
      observation += (observation ? "\n" : "") + result;
      toolMessages.push(
        new ToolMessage({
          content: result,
          tool_call_id: toolCall.id ?? "",
        }),
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      observation += (observation ? "\n" : "") + `Error: ${errMsg}`;
      toolMessages.push(
        new ToolMessage({
          content: `Error: ${errMsg}`,
          tool_call_id: toolCall.id ?? "",
        }),
      );
    }
  }

  const steps = [...state.steps];
  if (steps.length > 0) {
    steps[steps.length - 1] = {
      ...steps[steps.length - 1],
      observation,
    };
  }

  return {
    messages: toolMessages,
    steps,
  };
}
```

---

### 5.6 节点：路由判断 (`src/nodes/shouldContinue.ts`)

**设计思路：**

shouldContinue 是 LangGraph 的**条件边函数**，决定 llmNode 执行后是进入 toolNode 还是终止。判断逻辑：

- 如果 `loopActive === true` 且 `iteration < maxIterations` → 返回 `"toolNode"`（继续循环）
- 否则 → 返回 `END`（LangGraph 内置的终止符号）

`maxIterations` 从 `config.configurable` 读取，不从 state 读取（因为它是配置而非状态）。

```typescript
import { END } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

export function shouldContinue(
  state: any,
  config?: RunnableConfig,
): string {
  const maxIterations =
    (config?.configurable?.maxIterations as number) ?? 10;

  if (state.loopActive && state.iteration < maxIterations) {
    return "toolNode";
  }
  return END;
}
```

---

### 5.7 图组装 (`src/agent/graph.ts`)

**设计思路：**

`buildGraph` 构建 LangGraph 的 `StateGraph`，定义整个 ReAct 循环的拓扑：

```
START → llmNode → [条件分支] → toolNode → llmNode（循环）
                    ↓
                   END
```

- `addEdge("__start__", "llmNode")`：入口边，从开始直连 LLM 节点
- `addConditionalEdges("llmNode", shouldContinue, { toolNode: "toolNode" })`：条件边，根据 shouldContinue 返回值路由到 toolNode，若返回 `END` 则终止
- `addEdge("toolNode", "llmNode")`：普通边，工具执行完毕后回到 LLM 节点，形成循环

```typescript
import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { llmNode } from "../nodes/llmNode";
import { toolNode } from "../nodes/toolNode";
import { shouldContinue } from "../nodes/shouldContinue";
import type { ToolRegistry } from "../tools/registry";

export function buildGraph(registry: ToolRegistry) {
  const graph = new StateGraph(AgentState)
    .addNode("llmNode", llmNode)
    .addNode("toolNode", toolNode)
    .addEdge("__start__", "llmNode")
    .addConditionalEdges("llmNode", shouldContinue, {
      toolNode: "toolNode",
    })
    .addEdge("toolNode", "llmNode");

  return graph;
}
```

---

### 5.8 工厂函数 createAgent (`src/agent/createAgent.ts`)

**设计思路：**

`createAgent` 是整个框架的入口，负责：

1. **创建工具注册表**：将 config.tools 逐个注册到 ToolRegistry
2. **构建并编译图**：调用 `buildGraph(registry)` 获取 `StateGraph`，再 `.compile()` 得到可执行的 `CompiledStateGraph`
3. **封装 invoke 函数**：
   - 接收用户消息，构造 `HumanMessage`
   - 调用 `compiledGraph.invoke(input, { configurable })`，将 `systemPrompt`、`maxIterations`、`temperature`、`onStep`、`registry` 通过 configurable 注入所有节点
   - 解析最终 state，提取 `finalAnswer`（最后一条消息的 content）和 `steps`

```typescript
import { HumanMessage } from "@langchain/core/messages";
import { ToolRegistry } from "../tools/registry";
import { buildGraph } from "./graph";
import type { CreateAgentConfig, AgentRuntime } from "../types";

export function createAgent(config: CreateAgentConfig): AgentRuntime {
  const registry = new ToolRegistry();
  for (const tool of config.tools) {
    registry.register(tool);
  }

  const graph = buildGraph(registry);
  const compiledGraph = graph.compile();

  const invoke: AgentRuntime["invoke"] = async (userMessage) => {
    const result = await compiledGraph.invoke(
      { messages: [new HumanMessage(userMessage)] },
      {
        configurable: {
          systemPrompt: config.systemPrompt,
          maxIterations: config.maxIterations ?? 10,
          temperature: config.temperature ?? 0,
          onStep: config.onStep,
          registry,
        },
      },
    );

    const messages = result.messages;
    const lastMessage = messages[messages.length - 1];

    let finalAnswer = "";
    if (lastMessage) {
      finalAnswer =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
    }

    return {
      finalAnswer,
      steps: result.steps ?? [],
    };
  };

  return { invoke };
}
```

---

### 5.9 对外导出 (`src/agent/index.ts`)

**设计思路：**

集中导出所有公开 API。`export type` 用于类型导出，符合 `verbatimModuleSyntax` 要求。

```typescript
export { createAgent } from "./createAgent";
export type { CreateAgentConfig, AgentRuntime, AgentResult, AgentStep, Tool } from "../types";
```

---

### 5.10 测试入口 (`src/index.ts`)

**设计思路：**

提供了一个完整的可运行示例：
- 定义了一个 `get_weather` 工具，使用 Zod schema 定义参数类型
- 配置了 `onStep` 回调，在每一步时打印决策过程
- 调用 `agent.invoke("上海今天天气怎么样？")` 触发完整的 ReAct 流程

```typescript
import { createAgent } from "./agent";
import { z } from "zod";

const agent = createAgent({
  tools: [
    {
      name: "get_weather",
      description: "获取指定城市的天气信息",
      schema: z.object({
        city: z.string().describe("城市名称，如 '上海'、'北京'"),
      }),
      execute: async ({ city }) => {
        return `${city}的天气：晴天，温度 25°C，湿度 45%`;
      },
    },
  ],
  systemPrompt: "你是一个有用的助手，可以使用工具来回答用户的问题。请用中文回答。",
  maxIterations: 5,
  onStep: (step) => {
    console.log(
      `[Step ${step.iteration}]`,
      step.thought,
      step.action ? ` -> ${step.action.tool}(${JSON.stringify(step.action.input)})` : "",
    );
    if (step.observation) {
      console.log(`  Observation:`, step.observation);
    }
  },
});

const result = await agent.invoke("上海今天天气怎么样？");
console.log("\n最终答案:", result.finalAnswer);
```

---

## 6. 配置文件

### package.json

```json
{
  "name": "my-data-agent",
  "module": "src/index.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "bun run src/index.ts",
    "typecheck": "bun run node_modules/typescript/bin/tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^6.0.3"
  },
  "dependencies": {
    "@langchain/core": "^1.1.46",
    "@langchain/langgraph": "^1.3.0",
    "openai": "^6.37.0",
    "zod": "3",
    "zod-to-json-schema": "^3.25.2"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "types": ["bun"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  }
}
```

### .env.example

```
MODEL_NAME=gpt-4o-mini
MODEL_API_KEY=sk-your-key-here
MODEL_API_URL=https://api.openai.com/v1
```

---

## 7. 数据流总览

以下是一次完整的 `agent.invoke("上海今天天气怎么样？")` 调用中的数据流：

```
┌─────────────────────────────────────────────────────────┐
│ 1. 用户调用 agent.invoke("上海今天天气怎么样？")          │
│    └→ compiledGraph.invoke({                              │
│         messages: [HumanMessage("上海今天天气怎么样？")]   │
│       }, { configurable: { systemPrompt, registry, ... } })│
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ 2. llmNode（第 1 轮）                                    │
│    输入: messages = [HumanMessage]                       │
│    流程:                                                 │
│      · 构建 [SystemMessage + HumanMessage] → OpenAI       │
│      · OpenAI 返回: tool_calls=[{ get_weather, city:"上海" }]│
│      · 产出: AIMessage(tool_calls=[get_weather])         │
│      · 设置: loopActive = true                           │
│      · 记录: step[1] = { thought: "...", action: {...} } │
│    输出 state 更新:                                       │
│      messages: [HumanMsg, AIMsg(tool_calls)]             │
│      steps: [step1]                                      │
│      iteration: 1                                        │
│      loopActive: true                                    │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ 3. shouldContinue                                        │
│    · loopActive = true, iteration(1) < maxIterations(5)  │
│    → 返回 "toolNode"                                     │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ 4. toolNode                                              │
│    · 读取最后一条 AIMessage 的 tool_calls                 │
│    · 查找 registry.get("get_weather")                    │
│    · 调用 execute({ city: "上海" }) → "上海天气：晴天..."   │
│    · 产出: ToolMessage("上海天气：晴天...", tool_call_id)  │
│    · 回填: step[1].observation = "上海天气：晴天..."       │
│    输出 state 更新:                                       │
│      messages: [HumanMsg, AIMsg, ToolMsg]                │
│      steps: [step1 with observation]                     │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ 5. llmNode（第 2 轮）                                    │
│    输入: messages = [HumanMsg, AIMsg, ToolMsg]           │
│    流程:                                                 │
│      · 构建 [SystemMsg, HumanMsg, AIMsg, ToolMsg] → OpenAI│
│      · OpenAI 返回: content = "上海今天天气晴朗..." (无 tool_calls)│
│      · 产出: AIMessage("上海今天天气晴朗...")             │
│      · 设置: loopActive = false                          │
│      · 记录: step[2] = { thought: "上海今天天气...", 无 action } │
│    输出 state 更新:                                       │
│      messages: [HumanMsg, AIMsg(tool), ToolMsg, AIMsg]    │
│      steps: [step1, step2]                               │
│      iteration: 2                                        │
│      loopActive: false                                   │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ 6. shouldContinue                                        │
│    · loopActive = false                                  │
│    → 返回 END                                            │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ 7. createAgent 解析结果                                   │
│    · finalAnswer = "上海今天天气晴朗，温度 25°C..."       │
│    · steps = [step1, step2]                              │
│    → 返回 { finalAnswer, steps }                         │
└─────────────────────────────────────────────────────────┘
```

---

## 8. 使用示例

### 基本用法

```typescript
import { createAgent } from "./agent";
import { z } from "zod";

const agent = createAgent({
  tools: [
    {
      name: "calculator",
      description: "执行数学计算",
      schema: z.object({
        expression: z.string().describe("数学表达式，如 '2+3*4'"),
      }),
      execute: async ({ expression }) => {
        // 安全起见，简单计算用 eval 或自定义解析
        return String(eval(expression));
      },
    },
    {
      name: "search_database",
      description: "从数据库查询数据",
      schema: z.object({
        query: z.string().describe("SQL 查询语句"),
      }),
      execute: async ({ query }) => {
        // 实际使用中替换为真实的数据库查询
        return `查询结果: [{"id": 1, "name": "Alice"}]`;
      },
    },
  ],
  systemPrompt: "你是一个数据分析助手，可以使用计算器和数据库工具。",
  maxIterations: 10,
  temperature: 0,
  onStep: (step) => {
    if (step.action) {
      console.log(`[Step ${step.iteration}] 调用 ${step.action.tool}:`, step.action.input);
    } else {
      console.log(`[Step ${step.iteration}] 回答:`, step.thought);
    }
  },
});

const { finalAnswer, steps } = await agent.invoke("查询所有用户的平均年龄");
console.log("答案:", finalAnswer);
console.log("共执行了", steps.length, "步");

// 查看每一步的详情
for (const step of steps) {
  console.log(`--- Step ${step.iteration} ---`);
  console.log("  Thought:", step.thought);
  if (step.action) {
    console.log("  Action:", step.action.tool, step.action.input);
  }
  if (step.observation) {
    console.log("  Observation:", step.observation);
  }
}
```

---

## 9. 启动与运行

### 安装依赖

```bash
bun install
```

### 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入真实的 MODEL_API_KEY
```

### 运行测试

```bash
bun run start
```

### 类型检查

```bash
bun run typecheck
```

---

## 设计总结

| 设计要点 | 实现方式 |
|----------|----------|
| **ReAct 循环** | LangGraph StateGraph（llmNode → shouldContinue → toolNode → llmNode） |
| **工具定义** | 泛型 `Tool<TSchema>` 接口，Zod schema 驱动类型推导和 OpenAI tool definition 生成 |
| **工具管理** | `ToolRegistry`（Map 存储 + zod-to-json-schema 转换） |
| **状态管理** | `Annotation.Root` + `messagesStateReducer`（手动定义 + 自动追加去重） |
| **配置注入** | `RunnableConfig.configurable`（不污染 State） |
| **消息格式桥接** | 手动实现 LangChain BaseMessage ↔ OpenAI MessageParam 转换器 |
| **过程可观测** | `AgentStep` 记录每轮 thought/action/observation + `onStep` 回调 |
| **环境隔离** | model/apiKey/baseURL 全部从环境变量读取，不在代码中硬编码 |