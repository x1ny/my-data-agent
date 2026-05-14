import { readdirSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  csvToSqlite,
  jsonObjectToSqlite,
  flattenObject,
  type IngestResult,
  createAgent,
  createNotebookTools,
  createAskDocExpertTool,
  createValidateResultTool,
} from "./agent";
import path from "node:path";
import { exportTableToCsv, formatIngestResult, summarizeDocument } from "./utils";
import { createSqliteQueryTool } from "./agent/sqliteQueryTool";
import { segmentDocument } from "./segmenter";
import type { DocDocument } from "./agent";
import { JsonDatasetExtractor } from "./utils/extract";

console.time('start');
const inputDir = Bun.env.INPUT_DIR || path.join(__dirname, "../input");
const outputDir = Bun.env.OUTPUT_DIR || path.join(__dirname, "../output");

const tasksArg = Bun.argv.find((arg) => arg.startsWith("--tasks="));
const taskFilter: Set<string> | null = tasksArg
  ? new Set(
      tasksArg
        .split("=")[1]!
        .split(",")
        .map((n) => `task_${parseInt(n.trim(), 10)}`),
    )
  : null;

const entries = readdirSync(inputDir, { withFileTypes: true });

let taskNames = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (taskFilter) {
  taskNames = taskNames.filter((name) => taskFilter.has(name));
  console.log("Filtered tasks:", Array.from(taskFilter));
}

// // Sort by difficulty: easy → medium → hard → extreme
// const DIFFICULTY_ORDER: Record<string, number> = {
//   easy: 0,
//   medium: 1,
//   hard: 2,
//   extreme: 3,
// };

// const taskInfos = await Promise.all(
//   taskNames.map(async (name) => {
//     const meta = (await Bun.file(
//       path.join(inputDir, name, "task.json"),
//     ).json()) as { difficulty: string };
//     return { name, difficulty: meta.difficulty.toLowerCase() };
//   }),
// );

// taskInfos.sort(
//     (a, b) =>
//       (DIFFICULTY_ORDER[a.difficulty] ?? 99) -
//       (DIFFICULTY_ORDER[b.difficulty] ?? 99),
//   );

// taskNames = taskInfos.map((t) => t.name);

// console.log(
//   "Task order:",
//   taskInfos.map((t) => `${t.name}(${t.difficulty})`).join(" → "),
// );

const extractor = new JsonDatasetExtractor({
  flatten: true,
  ignoreImpurity: true,
  promoteMapKeys: true,
});

for (const taskName of taskNames) {
  let db: Database | undefined;

  try {
    const task_json = (await Bun.file(
      path.join(inputDir, taskName, "task.json"),
    ).json()) as {
      task_id: string;
      difficulty: string;
      question: string;
    };

    console.log("开始处理任务:", taskName);
    console.log("任务ID:", task_json.task_id);
    console.log("任务难度:", task_json.difficulty);
    console.log("任务问题:", task_json.question);

    db = new Database(":memory:");

    const context_dir = path.join(inputDir, taskName, "context");

    const knowledge = await Bun.file(
      path.join(context_dir, "knowledge.md"),
    ).text();

    const ingest_results: IngestResult[] = [];

    const documents: DocDocument[] = []
    if (existsSync(path.join(context_dir, "doc"))) {
      const doc_files = readdirSync(path.join(context_dir, "doc"), {
        withFileTypes: true,
      }).filter((entry) => entry.isFile());
      console.log(
        "存在文档文件:",
        doc_files.map((entry) => entry.name),
      );
      for (const doc_file of doc_files) {
        const file = await Bun.file(path.join(context_dir, "doc", doc_file.name)).text();
        const summaryResult = await summarizeDocument(file);
        const segments = await segmentDocument(file, {
          chunkSize: 60000,
          overlap: 2000,
          verbose: true,
        });
documents.push({
          name: doc_file.name,
          summary: summaryResult.summary,
          documentType: summaryResult.documentType,
          content: file,
          segments: segments.map((seg) => ({
            summary: seg.summary,
            start: seg.startIndex,
            end: seg.endIndex,
          })),
        });
      }
    }
   
    if (existsSync(path.join(context_dir, "csv"))) {
      const csv_files = readdirSync(path.join(context_dir, "csv"), {
        withFileTypes: true,
      }).filter((entry) => entry.isFile() && entry.name.endsWith(".csv"));
      console.log(
        "存在csv文件:",
        csv_files.map((entry) => entry.name),
      );
      for (const csv_file of csv_files) {
        const result = await csvToSqlite(
          db,
          path.join(context_dir, "csv", csv_file.name),
          {
            tableName: csv_file.name.split(".")[0] || csv_file.name,
          },
        );
        ingest_results.push(result);
      }
    }

    if (existsSync(path.join(context_dir, "json"))) {
      const json_files = readdirSync(path.join(context_dir, "json"), {
        withFileTypes: true,
      }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
      console.log(
        "存在json文件:",
        json_files.map((entry) => entry.name),
      );
      for (const json_file of json_files) {
        const json_data = await Bun.file(
          path.join(context_dir, "json", json_file.name),
        ).json();
        if (json_data.records && json_data.table) {
          const result = await jsonObjectToSqlite(db, json_data.records, {
            tableName: json_data.table,
          });
          ingest_results.push(result);
        } else {
          const result = extractor.extract(json_data);
          if (result.length == 0) {
            continue;
          }
          for (const dataset of result) {
            const result = await jsonObjectToSqlite(db, dataset.rows, {
              tableName: dataset.name,
            });
            ingest_results.push(result);
          }
        }
      }
    }


    if (existsSync(path.join(context_dir, "db"))) {
      const db_files = readdirSync(path.join(context_dir, "db"), {
        withFileTypes: true,
      }).filter((entry) => entry.isFile() && entry.name.endsWith(".db"));
      console.log(
        "存在db文件:",
        db_files.map((entry) => entry.name),
      );
      for (const db_file of db_files) {
        let sourceDb: Database | undefined;
        try {
          sourceDb = new Database(path.join(context_dir, "db", db_file.name), {
            readonly: true,
          });
          const tables = sourceDb
            .query(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .all() as { name: string }[];
          for (const table of tables) {
            const rows = sourceDb
              .query(`SELECT * FROM "${table.name}"`)
              .all() as Record<string, unknown>[];
            if (rows.length > 0) {
              const tablePrefix = db_file.name.replace(/\.db$/, "");
              const result = await jsonObjectToSqlite(db, rows, {
                tableName: `${tablePrefix}_${table.name}`,
              });
              ingest_results.push(result);
            }
          }
        } finally {
          sourceDb?.close();
        }
      }
    }

    const systemPrompt = `
    你是一个资深的数据分析专家，擅长使用SQL查询和数据分析工具来回答用户的问题。

    ${ingest_results.length > 0 ? "这是数据库的表结构：" : ""}
    ${ingest_results.map((result) => formatIngestResult(result)).join("\n")}

    这是背景知识：
    ${knowledge}

    这是提供的相关文档的摘要和类型：
    ${documents.map((document) => `摘要: ${document.summary}, 类型: ${document.documentType}`).join("\n")}

    你可以使用的工具是:

    query_sqlite，这个工具可以让你查询数据库中的数据。
    write_notebook，这个工具可以让你写入notebook中的内容, 请把你的步骤规划、分析过程、重要知识点，以简洁的语句写入进去。
    read_notebook，这个工具可以让你读取notebook中的内容。
    ${documents.length > 0 ? "ask_doc_expert，这个工具可以让你向文档专家提问，专家会阅读和搜索提供的文档来回答你的问题。" : ""}
    validate_result，这个工具可以让你验证结果表的结构是否正确。你需要传入对每个列的必要性推理（每次都要完整传入，不要省略）。工具会返回验证通过或不通过，不通过时会给你具体的修改建议。请在写入结果表后反复调用这个工具，直到返回PASS为止。

    你需要回答的问题是: ${task_json.question}

    【注意!!!】
    请将最终答案写入the_final_answer表里， 这张表目前不存在，请结合具体的文档、问题进行深度分析之后，确定这张表的结构，并写入最终答案。
    结果的列要仅仅包含问题所需的必要列！不能多也不能少！
    `;

    console.log(systemPrompt);

    const { readNotebook, writeNotebook } = createNotebookTools();

    const tools: any[] = [createSqliteQueryTool(db), readNotebook, writeNotebook];

    if (documents.length > 0) {
      tools.push(createAskDocExpertTool(documents, knowledge));
    }

    const validateResultTool = createValidateResultTool(
      db,
      knowledge,
      task_json.question,
      readNotebook,
    );
    tools.push(validateResultTool);

    const agent = createAgent({
      tools,
      systemPrompt: systemPrompt,
      maxIterations: 100,
      temperature: 0,
      onStep: (step) => {
        console.log(step);
      },
    });

    const result = await agent.invoke(
      "请开始分析问题，并给出分析结果。请先在notebook写入你的初步规划。",
    );
    console.log(await readNotebook.execute({}));
    console.log(result.finalAnswer);

    //打印出db的表名
    // console.log(db.query(`SELECT name FROM sqlite_master WHERE type='table'`).all());
    // for (const result of ingest_results) {
    //   console.log(formatIngestResult(result));
    // }

    console.log("--------------------------------");

    //查看the_final_answer表的具体数据
    exportTableToCsv(
      db,
      "the_final_answer",
      path.join(outputDir, taskName, "prediction.csv"),
    );
    // console.log()
  } catch (error) {
    console.error("处理任务失败:", taskName, error);
  } finally {
    db?.close();
  }
}
console.timeEnd('start');