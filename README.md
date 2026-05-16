# my-data-agent

基于 **Bun + TypeScript + LangGraph + OpenAI SDK** 构建的 ReAct Agent 数据分析框架。

## 架构

```
用户输入 → LangGraph StateGraph → ReAct 循环 → 最终答案
                │
                ├── llmNode     (LLM 决策：思考 + 决定调用哪个工具)
                ├── shouldContinue (路由：loopActive && iteration < maxIterations)
                └── toolNode    (执行工具：获取实际数据)
```

一次完整的 ReAct 循环：
1. `llmNode` 接收消息历史，调用 OpenAI，返回 `AIMessage`（含 tool_calls 或最终答案）
2. `shouldContinue` 根据 `loopActive` 和 `iteration` 决定进入 `toolNode` 还是 `END`
3. `toolNode` 执行 LLM 指定的工具，产出 `ToolMessage` 并回填 `observation`，然后回到 `llmNode`

核心工厂函数 `createAgent` 负责组装 `ToolRegistry → StateGraph → CompiledGraph`，通过 `configurable` 注入配置（`systemPrompt`、`maxIterations`、`temperature`、`onStep`），调用返回 `{ finalAnswer, steps }`。

### State 字段

| 字段 | 类型 | Reducer | 用途 |
|------|------|---------|------|
| `messages` | `BaseMessage[]` | `messagesStateReducer`（追加+去重） | 完整对话历史 |
| `steps` | `AgentStep[]` | replace | 每步 thought / action / observation |
| `iteration` | `number` | replace | 当前迭代次数 |
| `loopActive` | `boolean` | replace | 是否继续 ReAct 循环 |

### 数据流

| 步骤 | 节点 | 输入 | 输出 |
|------|------|------|------|
| 1 | `llmNode` | `[SystemMsg, HumanMsg, ...历史]` | `AIMessage(tool_calls)` 或最终答案 |
| 2 | `shouldContinue` | state | `"toolNode"` 或 `END` |
| 3 | `toolNode` | `AIMessage(tool_calls)` | `ToolMessage[]` + observation 回填 |

---

## 项目结构

```
src/
├── openai.d.ts                  # 全局 OpenAI 类型增强（enable_thinking）
├── index.ts                     # 主入口：任务循环，数据入库，Agent 编排
│
├── agent/                       # Agent 运行时框架（纯引擎，无业务工具）
│   ├── index.ts                 # barrel export：createAgent + 核心类型
│   ├── types.ts                 # Tool, AgentStep, CreateAgentConfig, AgentRuntime, AgentResult
│   ├── createAgent.ts           # 工厂函数：registry → graph → compile → invoke
│   ├── graph.ts                 # LangGraph StateGraph 拓扑定义（llmNode ⇄ toolNode）
│   ├── state.ts                 # Annotation.Root：messages, steps, iteration, loopActive
│   ├── registry.ts              # ToolRegistry：Map<name, Tool> + zod → OpenAI tool defs
│   ├── llmNode.ts               # ReAct 决策节点：LangChain → OpenAI 消息转换，调 LLM，产出 AIMessage
│   ├── toolNode.ts              # 工具执行节点：执行工具，产出 ToolMessage + observation
│   └── shouldContinue.ts        # 路由判断：loopActive && iteration < maxIterations
│
├── tools/                       # Agent 运行时工具实现（依赖 agent/ + doc/）
│   ├── index.ts                 # barrel export：所有 createXxxTool 工厂函数
│   ├── sqliteQueryTool.ts       # SQL 查询工具：支持 SELECT/INSERT/CREATE/DROP，自动格式化结果为表格
│   ├── notebookTool.ts          # 内存笔记本工具：read_notebook / write_notebook（overwrite/append）
│   ├── createDocumentTools.ts   # 文档工具组：read_document（按索引读取）/ search_document（正则搜索）
│   ├── askDocExpertTool.ts      # 文档专家工具：封装 invokeDocExpertAgent 子 Agent 为 Tool
│   └── validateResultTool.ts    # 结果验证工具：检查 the_final_answer 表结构，调用 LLM 校验
│
├── ingest/                      # 数据入库管线（CSV / JSON / SQLite → SQLite 表）
│   ├── index.ts                 # barrel export
│   ├── types.ts                 # DataRow, ColumnMeta, IngestResult, IngestOptions, FlattenOptions
│   ├── csvToSqlite.ts           # CSV 文件 → SQLite 表（csv-parse 解析 + rowsToSqlite 入库）
│   ├── jsonObjectToSqlite.ts    # JSON 对象数组 → SQLite 表（扁平化 + schema 合并 + 入库）
│   ├── flattenObject.ts         # 嵌套对象扁平化工具（可配置分隔符、深度、数组策略）
│   ├── rowsToSqlite.ts          # 核心入库引擎：类型推断 → 建表 → 批量事务写入
│   ├── formatIngestResult.ts    # IngestResult → Markdown 表格字符串（用于 system prompt）
│   ├── extract.ts               # JsonDatasetExtractor：从任意 JSON 中自动发现并提取 Dataset
│   └── extract.test.ts          # JsonDatasetExtractor 单元测试
│
├── doc/                         # 文档智能（分段、摘要、子 Agent 问答）
│   ├── index.ts                 # barrel export
│   ├── types.ts                 # SummarizeResult, DocSegment, DocDocument, DocExpertParams 等
│   ├── summarizeDocument.ts     # LLM 文档摘要：返回 summary + documentType
│   ├── invokeDocExpertAgent.ts  # 文档专家子 Agent：用 createAgent 封装文档问答流程
│   ├── test.ts                  # 文档链路集成测试
│   └── segmenter/               # 文档分段器
│       ├── index.ts             # segmentDocument 主入口：split → extract → map → merge
│       ├── types.ts             # Segment, Chunk, SegmenterOptions
│       ├── splitter.ts          # 文档切块（固定大小 + overlap + 尾块合并）
│       ├── extractor.ts         # LLM 段落提取：从文本块中识别段落边界和摘要
│       ├── positionMapper.ts    # 位置映射：将 LLM 输出的段落映射回源文档索引
│       └── merger.ts            # 段落合并：合并相邻或重叠的段落
│
└── utils/                       # 无归属通用工具
    ├── index.ts                 # barrel export
    └── exportTableToCsv.ts      # SQLite 表 → CSV 文件导出
```

### 模块依赖方向

```
index.ts
  ├── agent/           (纯引擎，不依赖其他业务模块)
  ├── tools/           (依赖 agent/ + doc/)
  │     └── doc/
  ├── ingest/          (依赖 bun:sqlite + csv-parse)
  ├── doc/             (依赖 agent/ + tools/ + segmenter/)
  │     └── doc/segmenter/  (独立子模块)
  └── utils/           (无依赖)
```

没有循环依赖。

---

## 安装与运行

### 安装依赖

```bash
bun install
```

### 环境变量

```bash
cp .env.example .env
# 编辑 .env 填入 API Key
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MODEL_NAME` | LLM 模型名 | `gpt-4o-mini` |
| `MODEL_API_KEY` | API Key | （必填） |
| `MODEL_API_URL` | API 地址 | `https://api.openai.com/v1` |
| `INPUT_DIR` | 输入数据目录 | `./input` |
| `OUTPUT_DIR` | 输出结果目录 | `./output` |

### 输入数据格式

```
input/
└── task_xxx/
    ├── task.json          # { task_id, difficulty, question }
    └── context/
        ├── knowledge.md   # 背景知识
        ├── *.csv          # CSV 数据文件（自动入库）
        ├── *.json         # JSON 数据文件（自动提取 + 入库）
        ├── *.db / *.sqlite # SQLite 文件（自动导入所有表）
        └── *.txt / *.md / *.html 等  # 文档文件（自动分段 + 摘要）
```

### 启动

```bash
bun run start

# 按任务编号过滤
bun run start -- --tasks=1,3,5
```

### 类型检查

```bash
bun run typecheck
```

---

## 技术栈

| 技术 | 用途 |
|------|------|
| **Bun** | 运行时 + 包管理 + 原生 TypeScript |
| **TypeScript** | 类型安全，配合 Zod 实现端到端类型安全 |
| **@langchain/langgraph** | StateGraph + Annotation 状态管理 |
| **@langchain/core** | BaseMessage 体系（HumanMessage / AIMessage / ToolMessage） |
| **openai** (v6) | OpenAI chat completions API |
| **zod** (v3) | Schema 校验 + 类型推导 |
| **zod-to-json-schema** | Zod → OpenAI function calling JSON Schema |
| **csv-parse** | CSV 解析 |

---

## 设计原则

1. **按能力域分组**：`agent/`（运行时引擎）、`tools/`（工具）、`ingest/`（数据管道）、`doc/`（文档智能）各自独立，边界清晰
2. **TypeScript 项目中的方案 B**：使用 `Annotation.Root` 手动定义 state（而非 `MessagesAnnotation`），获得完整扩展自由度
3. **配置与状态分离**：通过 `RunnableConfig.configurable` 注入配置（systemPrompt、maxIterations、temperature、onStep、registry），不污染 State
4. **透明可控**：手动实现 LLM 调用和 toolNode，避免 LangChain 内置抽象的黑盒行为，每步可观测（AgentStep + onStep 回调）
5. **扎实的工程设计**：纯 ESM、verbatimModuleSyntax、严格 TypeScript 配置

---

## 类型安全

`Tool` 接口使用泛型从 Zod schema 自动推导 execute 参数类型：

```typescript
import { createAgent } from "./agent";
import { z } from "zod";

const agent = createAgent({
  tools: [
    {
      name: "calculator",
      description: "执行数学计算",
      schema: z.object({
        expression: z.string().describe("数学表达式"),
      }),
      // execute 的 { expression } 自动推导为 string
      execute: async ({ expression }) => String(eval(expression)),
    },
  ],
  systemPrompt: "你是一个数据分析助手。",
});
```

> 更多设计细节见 [DESIGN.md](./DESIGN.md)。