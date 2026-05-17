import { readdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { createAgent } from "./agent";
import {
  createSqliteQueryTool,
  createNotebookTools,
  createAskDocExpertTool,
  createValidateResultTool,
} from "./tools";
import path from "node:path";
import { exportTableToCsv } from "./utils";
import {
  csvToSqlite,
  jsonObjectToSqlite,
  flattenObject,
  formatIngestResult,
  JsonDatasetExtractor,
  type IngestResult,
} from "./ingest";
import { segmentDocument, summarizeDocument, type DocDocument } from "./doc";
import { Glob } from "bun";

console.time("start");
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
//   (a, b) =>
//     (DIFFICULTY_ORDER[a.difficulty] ?? 99) -
//     (DIFFICULTY_ORDER[b.difficulty] ?? 99),
// );

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

    const documents: DocDocument[] = [];

    {
      const docPatterns = [
        "**/*.txt",
        "**/*.md",
        "**/*.markdown",
        "**/*.html",
        "**/*.htm",
        "**/*.xml",
        "**/*.rst",
      ];
      const docFiles: string[] = [];
      for (const pattern of docPatterns) {
        const glob = new Glob(pattern);
        for await (const f of glob.scan(context_dir)) {
          docFiles.push(f);
        }
      }
      if (docFiles.length > 0) {
        console.log("存在文档文件:", docFiles);
        for (const docFile of docFiles) {
          if (docFile == "knowledge.md") {
            continue;
          }

          const filePath = path.join(context_dir, docFile);
          const file = await Bun.file(filePath).text();
          const docName = path.basename(docFile);
          const summaryResult = await summarizeDocument(file);
          const segments = await segmentDocument(file, {
            chunkSize: 60000,
            overlap: 2000,
            verbose: true,
          });
          documents.push({
            name: docName,
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
    }

    {
      const csvGlob = new Glob("**/*.csv");
      const csvFiles: string[] = [];
      for await (const f of csvGlob.scan(context_dir)) {
        csvFiles.push(f);
      }
      if (csvFiles.length > 0) {
        console.log("存在csv文件:", csvFiles);
        for (const csvFile of csvFiles) {
          const csvName = path.basename(csvFile);
          const result = await csvToSqlite(
            db,
            path.join(context_dir, csvFile),
            {
              tableName: csvName.split(".")[0] || csvName,
            },
          );
          ingest_results.push(result);
        }
      }
    }

    {
      const jsonGlob = new Glob("**/*.json");
      const jsonFiles: string[] = [];
      for await (const f of jsonGlob.scan(context_dir)) {
        jsonFiles.push(f);
      }
      if (jsonFiles.length > 0) {
        console.log("存在json文件:", jsonFiles);
        for (const jsonFile of jsonFiles) {
          const jsonData = await Bun.file(
            path.join(context_dir, jsonFile),
          ).json();
          if (jsonData.records && jsonData.table) {
            const result = await jsonObjectToSqlite(db, jsonData.records, {
              tableName: jsonData.table,
            });
            ingest_results.push(result);
          } else {
            const result = extractor.extract(jsonData);
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
    }

    {
      const dbPatterns = ["**/*.db", "**/*.sqlite"];
      const dbFiles: string[] = [];
      for (const pattern of dbPatterns) {
        const glob = new Glob(pattern);
        for await (const f of glob.scan(context_dir)) {
          dbFiles.push(f);
        }
      }
      if (dbFiles.length > 0) {
        console.log("存在db文件:", dbFiles);
        for (const dbFile of dbFiles) {
          let sourceDb: Database | undefined;
          try {
            sourceDb = new Database(path.join(context_dir, dbFile), {
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
                const tablePrefix = path
                  .basename(dbFile)
                  .replace(/\.(db|sqlite)$/, "");
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
    }

    const systemPrompt = `
    You are a senior data analysis expert, exceptionally skilled in rigorous reasoning and analysis, uncovering and recording key insights and logical processes, and utilizing SQL queries and data analysis tools to answer user questions.

    current date is 2025/05/10

    ${ingest_results.length > 0 ? "This is the database table structure:" : "There is no database table structure.Only use the ask_doc_expert tool to find the relevant information."}
    ${ingest_results.map((result) => formatIngestResult(result)).join("\n")}

    This is the background knowledge:
    ${knowledge}

    This is the summary and type of the provided related documents:
    ${documents.map((document) => `Summary: ${document.summary}, Type: ${document.documentType}`).join("\n")}

    The tools you can use are:

    query_sqlite，This tool can let you query the data in the database.
    write_notebook，This tool can let you write the content into the notebook, please write your step planning, analysis process, important knowledge points, in a concise statement.
    read_notebook，This tool can let you read the content from the notebook.
    ${documents.length > 0 ? "ask_doc_expert，This tool can let you ask the document expert a question, the expert will read and search the provided documents to answer your question." : ""}
    validate_result，This tool can let you validate the structure of the result table. You need to input the reasoning for each column's necessity (you must complete it every time, do not omit). The tool will return whether it passes or fails, and if it fails, it will give you specific modification suggestions. Please call this tool repeatedly after writing the result table until it returns PASS.
    answer, use to answer the question

    The question you need to answer is: ${task_json.question}

    [IMPORTANT!!!]
    Please write the final answer into the the_final_answer table, this table currently does not exist, please combine the specific documents, questions, and perform deep analysis to determine the structure of this table, and write the final answer into it.
    The columns of the result should only include the necessary columns required by the question! Not more and not less!
    `;

    console.log(systemPrompt);

    const { readNotebook, writeNotebook } = createNotebookTools();

    const tools: any[] = [
      createSqliteQueryTool(db),
      readNotebook,
      writeNotebook,
    ];

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
      "Please start analyzing the problem and provide the analysis result. Please write your preliminary plan into the notebook first.",
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
console.timeEnd("start");
