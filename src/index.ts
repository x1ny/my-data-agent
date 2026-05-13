import { writeFileSync, unlinkSync, readdir, readdirSync, existsSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { csvToSqlite, jsonObjectToSqlite, flattenObject, type IngestResult, createAgent } from "./agent";
import path from "node:path";
import { exportTableToCsv, formatIngestResult } from "./utils";
import { createSqliteQueryTool } from "./agent/sqliteQueryTool";

const inputDir = Bun.env.INPUT_DIR || path.join(__dirname, '../input');
const outputDir = Bun.env.OUTPUT_DIR || path.join(__dirname, '../output');

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
for (const taskName of taskNames) {
  let db: Database | undefined;

  try {

    const task_json = await Bun.file(path.join(inputDir, taskName, 'task.json')).json() as {
      task_id: string;
      difficulty: string;
      question: string;
    };

    console.log("开始处理任务:", taskName);
    console.log("任务ID:", task_json.task_id);
    console.log("任务难度:", task_json.difficulty);
    console.log("任务问题:", task_json.question);

    db = new Database(':memory:');

    const context_dir = path.join(inputDir, taskName, 'context');

    const knowledge = await Bun.file(path.join(context_dir, 'knowledge.md')).text();

    const ingest_results: IngestResult[] = [];

    if (existsSync(path.join(context_dir, 'csv'))) {
      const csv_files = readdirSync( path.join(context_dir, 'csv'), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.csv'))
      console.log('存在csv文件:', csv_files.map(entry => entry.name))
      for (const csv_file of csv_files) {
        const result = await csvToSqlite(db, path.join(context_dir, 'csv', csv_file.name), {
          tableName: csv_file.name.split('.')[0] || csv_file.name,
        });
        ingest_results.push(result);
      }
    }

    if (existsSync(path.join(context_dir, 'json'))) {
      const json_files = readdirSync( path.join(context_dir, 'json'), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      console.log('存在json文件:', json_files.map(entry => entry.name))
      for (const json_file of json_files) {
        const json_data = await Bun.file(path.join(context_dir, 'json', json_file.name)).json();
        if (json_data.records && json_data.table) {
          const result = await jsonObjectToSqlite(db, json_data.records, {
            tableName: json_data.table,
          });
          ingest_results.push(result);
        }
      }
    }

    const systemPrompt = `
    你是一个资深的数据分析专家，擅长使用SQL查询和数据分析工具来回答用户的问题。请用中文回答。

    
    这是数据库的表结构：
    ${ingest_results.map(result => formatIngestResult(result)).join('\n')}

    这是背景知识：
    ${knowledge}

    你可以使用的工具是: query_sqlite，这个工具可以让你查询数据库中的数据。

    你需要回答的问题是: ${task_json.question}

    【注意!!!】
    请将最终答案写入the_final_answer表里， 这张表目前不存在，请结合具体的文档、问题进行深度分析之后，确定这张表的结构，并写入最终答案。
    结果的列要仅仅包含问题所需的必要列！不能多也不能少！
    `;

    console.log(systemPrompt);

    const agent = createAgent({
      tools: [
        createSqliteQueryTool(db),
      ],
      systemPrompt: systemPrompt,
      maxIterations: 10,
      temperature: 0,
      onStep: (step) => {
        console.log(step);
      },
    })

    const result = await agent.invoke('请开始分析问题，并给出分析结果。');
    console.log(result.finalAnswer);

    //打印出db的表名
    // console.log(db.query(`SELECT name FROM sqlite_master WHERE type='table'`).all());
    // for (const result of ingest_results) {
    //   console.log(formatIngestResult(result));
    // }

    console.log("--------------------------------");

    //查看the_final_answer表的具体数据
    exportTableToCsv(db, 'the_final_answer', path.join(outputDir, taskName, 'prediction.csv'));
    // console.log()
  } catch (error) {
    console.error("处理任务失败:", taskName, error);
  } finally {
    db?.close();
  }
}
