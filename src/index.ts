import { writeFileSync, unlinkSync, readdir, readdirSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { csvToSqlite, jsonObjectToSqlite, flattenObject, type IngestResult, createAgent } from "./agent";
import path from "node:path";
import { formatIngestResult } from "./utils";
import { createSqliteQueryTool } from "./agent/sqliteQueryTool";

const inputDir = Bun.env.INPUT_DIR || path.join(__dirname, '../input');
const outputDir = Bun.env.OUTPUT_DIR || path.join(__dirname, '../output');

const entries = readdirSync(inputDir, { withFileTypes: true });
    
    // 过滤掉文件，只保留文件夹名称
const taskNames = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
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

    prompt('')
    // console.log()
  } catch (error) {
    console.error("处理任务失败:", taskName, error);
  } finally {
    db?.close();
  }
}
// const db = new Database(":memory:");

// const result = await csvToSqlite(db,path.join(__dirname, './budget.csv'), {
//   tableName: 'budget',
// });



// const rows = db.query(`SELECT * FROM budget LIMIT 1`).all();
// console.log(rows);


// const patient = await Bun.file(path.join(__dirname, './Patient.json')).json();
// const patientResult = await jsonObjectToSqlite(db, patient.records, {
//   tableName: 'patient',
// });

// // console.log(patientResult);

// const patientRows = db.query(`SELECT * FROM patient LIMIT 1`).all();
// console.log(patientRows);

