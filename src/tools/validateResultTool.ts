import type { Database } from "bun:sqlite";
import OpenAI from "openai";
import { z } from "zod";
import type { Tool } from "../agent/types";

const RESULT_TABLE = "the_final_answer";
const DATA_SAMPLE_ROWS = 30;

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
      "(5) date formats are YYYY-MM-DD." +
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
    return `[FAIL] The table "${RESULT_TABLE}" exists but contains no rows. The result cannot be empty.` + 
    'Important: This is a competition task, which means a valid solution definitely exists. An empty result indicates that your current logic or query strategy is incorrect. Do not conclude that there is "no data"; instead, you must restart your reasoning, pivot your approach (e.g., check different joins, filters, or table relationships), and find the path that leads to the data. Only if you have exhausted every possible logical permutation should you consider giving up.';
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
      ? "(no data)"
      : [
          `${dataRows.length} rows:`,
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
        content:[
          "You are an extremely strict data analysis validator. Based on the task question, background knowledge, analysis notebook, column reasoning of the agent, and actual result data,",
          "Judge whether the structure and data of the result table are completely correct.",
          "",
          "Please reply in English, format requirements:",
          "- First line: PASS or FAIL",
          "- Then: Specifically explain the reasons for passing or failing, and the modification suggestions",
          "",
          "## Validation Standards (extremely strict, one by one):",
          "",
          "1. Logical Consistency & Persistence:",
          "   Does the result table logic align perfectly with the original semantics of the question?",
          "   Has the agent drifted or provided an irrelevant answer after long reasoning?",
          "   IMPORTANT: This is a competition task, a solution is guaranteed to exist. If the result is empty, it is a FAIL.",
          "   The agent must be told to pivot its strategy and rethink the logic rather than assuming no data exists.",
          "",
          "2. Absolute Column Necessity (Zero Tolerance):",
          "   Every single column must be indispensable to answering the question.",
          "   Columns not explicitly required by the question are redundant and must be removed.",
          "   This includes IDs, indexes, and foreign keys—unless specifically requested, they must not appear.",
          "   If redundant columns exist, you must FAIL and specify which columns to delete.",
          "",
          "3. Column Completeness:",
          "   Are any critical columns missing that are required to fully satisfy the question?",
          "",
          "4. Date Formatting:",
          "   All date values must strictly follow the YYYY-MM-DD format.",
          "   (While checked at the code level, ensure the data semantics are correct here.)",
          "",
          "5. Detailed Feedback:",
          "  If the result is FAIL, you must provide a point-by-point breakdown of the reasons for failing and clear modification suggestions."
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "## Task Question",
          question,
          "",
          "## Background Knowledge",
          knowledge,
          "",
          "## Analysis Notebook",
          notebook.length > 0 ? notebook : "(no notebook)",
          "",
          "## Column Reasoning of the Agent",
          reasoning,
          "",
          "## Actual Result Table Columns",
          columns.length > 0 ? columns.join(", ") : "(no columns)",
          "",
          "## Number of Rows in the Table",
          String(countRow.cnt),
          "",
          "## Result Data",
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
            `Column "${col}" row ${i + 1} value "${val}" is a date but not in YYYY-MM-DD format`,
          );
          break; // one error per column is enough
        }
      }
    }
  }

  if (errors.length > 0) {
    return `[FAIL] Date format error:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\nPlease convert all dates to YYYY-MM-DD format.`;
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