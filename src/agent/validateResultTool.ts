import type { Database } from "bun:sqlite";
import OpenAI from "openai";
import { z } from "zod";
import type { Tool } from "./types";

const RESULT_TABLE = "the_final_answer";
const DATA_SAMPLE_ROWS = 30;

declare module "openai" {
  namespace OpenAI {
    namespace Chat {
      interface ChatCompletionCreateParamsNonStreaming {
        enable_thinking?: boolean;
      }
      interface ChatCompletionCreateParamsStreaming {
        enable_thinking?: boolean;
      }
    }
  }
}

export function createValidateResultTool(
  db: Database,
  knowledge: string,
  question: string,
  readNotebook: Tool,
): Tool {
  return {
    name: "validate_result",
    description:
      "Validate the result table structure and data. Provide a complete and detailed reasoning that explains " +
      "why each column in the result table is necessary for answering the question. " +
      "This tool will check: (1) the result table exists and has data, " +
      "(2) all columns are absolutely necessary (even IDs are rejected if not required), " +
      "(3) no required columns are missing, (4) the result logic aligns with the original question, " +
      "(5) date formats are YYYY-MM-DD. " +
      "IMPORTANT: Each call is independent — you must include ALL your reasoning every time, do not reference previous calls.",
    schema: z.object({
      reasoning: z
        .string()
        .describe(
          "Complete reasoning for each column in the result table: column name, why it is needed, " +
            "and how it directly answers the question. Include ALL columns every time.",
        ),
    }),
    execute: async ({ reasoning }) => {
      return validate(db, knowledge, question, reasoning, readNotebook);
    },
  };
}

async function validate(
  db: Database,
  knowledge: string,
  question: string,
  reasoning: string,
  readNotebook: Tool,
): Promise<string> {
  // 1. Check table existence and content
  const tableCheck = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(RESULT_TABLE) as { name: string } | undefined;

  if (!tableCheck) {
    return `[FAIL] The table "${RESULT_TABLE}" does not exist. Please create it first.`;
  }

  const countRow = db
    .query(`SELECT COUNT(*) as cnt FROM "${RESULT_TABLE}"`)
    .get() as { cnt: number } | undefined;

  if (!countRow || countRow.cnt === 0) {
    return `[FAIL] The table "${RESULT_TABLE}" exists but contains no rows. The result cannot be empty.`;
  }

  // 2. Get actual columns
  const columns = (
    db
      .query(`PRAGMA table_info("${RESULT_TABLE}")`)
      .all() as { name: string }[]
  ).map((c) => c.name);

  // 3. Get sample data rows
  const dataRows = db
    .query(`SELECT * FROM "${RESULT_TABLE}" LIMIT ?`)
    .all(DATA_SAMPLE_ROWS) as Record<string, unknown>[];

  // 4. Physical date format check
  const dateError = checkDateFormats(columns, dataRows);
  if (dateError) {
    return dateError;
  }

  // 5. Read notebook
  const notebook = await readNotebook.execute({});

  // 6. Serialize data for LLM
  const dataText =
    dataRows.length === 0
      ? "(无数据)"
      : [
          `前 ${dataRows.length} 行:`,
          columns.join(" | "),
          dataRows
            .map((r) => columns.map((c) => String(r[c] ?? "NULL")).join(" | "))
            .join("\n"),
        ].join("\n");

  // 7. Call LLM for validation
  const openai = new OpenAI({
    apiKey: process.env["MODEL_API_KEY"],
    baseURL: process.env["MODEL_API_URL"],
  });

  const model = process.env["MODEL_NAME"] || "gpt-4o-mini";

const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: [
          "你是一个极其严格的数据分析验证器。根据任务问题、背景知识、分析笔记、智能体的列推理和实际结果数据，",
          "判断结果表的结构和数据是否完全正确。",
          "",
          "请用中文回复，格式要求：",
          "- 第一行：PASS 或 FAIL",
          "- 之后：具体说明通过/不通过的理由，以及修改建议",
          "",
          "## 验证标准（极其严格，逐一对照）：",
          "",
          "1. 逻辑一致性：结果表的逻辑是否完全匹配问题的原本语义？",
          "   有没有在长时间分析后偏离主题、答非所问？",
          "   数据内容是否直接回答了问题？",
          "",
          "2. 列的绝对必要性（零容忍）：",
          "   每一个列都必须是回答问题所必需的。",
          "   问题没有明确要求的列，一律视为冗余列，必须删除。",
          "   包括 id、序号、外键等，除非问题明确要求，否则不能出现。",
          "   如果存在冗余列，必须 FAIL，并明确指出哪些列需要删除。",
          "",
          "3. 列的完整性：",
          "   是否缺少了回答问题所必需的关键列？",
          "",
          "4. 日期格式：",
          "   所有日期值必须统一为 YYYY-MM-DD 格式。",
          "   （此检查已在代码层面执行，这里只需关注数据语义是否正确）",
          "",
          "5. 必须逐条列出通过或未通过的具体原因和修改建议。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "## 任务问题",
          question,
          "",
          "## 背景知识",
          knowledge,
          "",
          "## 分析笔记",
          notebook.length > 0 ? notebook : "(空)",
          "",
          "## 智能体的列推理",
          reasoning,
          "",
          "## 实际的结果表列",
          columns.length > 0 ? columns.join(", ") : "(无列)",
          "",
          "## 表中的行数",
          String(countRow.cnt),
          "",
          "## 结果数据",
          dataText,
        ].join("\n"),
      },
    ],
    temperature: 0,
    enable_thinking: false,
  });

  const text = response.choices[0]?.message?.content || "";

  return text
  const firstLine = text.trim().split("\n")[0]?.trim().toUpperCase() || "";
  const passed = firstLine.startsWith("PASS");

  if (!passed) {
    return `[FAIL] ${text}`;
  }

  return `[PASS] ${text}`;
}

function checkDateFormats(
  columns: string[],
  dataRows: Record<string, unknown>[],
): string | null {
  const errors: string[] = [];

  for (const col of columns) {
    for (let i = 0; i < dataRows.length; i++) {
      const val = String(dataRows[i]![col] ?? "").trim();
      if (val === "" || val === "NULL") continue;

      if (looksLikeDate(val)) {
        if (!isYYYYMMDD(val)) {
          errors.push(
            `列 "${col}" 第 ${i + 1} 行的值 "${val}" 是日期但不是 YYYY-MM-DD 格式`,
          );
          break; // one error per column is enough
        }
      }
    }
  }

  if (errors.length > 0) {
    return `[FAIL] 日期格式错误:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\n请将所有日期统一为 YYYY-MM-DD 格式。`;
  }

  return null;
}

function looksLikeDate(val: string): boolean {
  return (
    (val.includes("-") || val.includes("/")) &&
    val.length >= 8 &&
    !isNaN(Date.parse(val))
  );
}

function isYYYYMMDD(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(val);
}